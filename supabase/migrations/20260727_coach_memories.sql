-- Persistent Coach memory. buildCoachContext currently reassembles everything
-- from raw logs each call, so the Coach knows what a user ate but never learns
-- who they are. These rows are the durable facts: constraints (injuries,
-- allergies), preferences, behavioural patterns, milestones, and advice already
-- given. Extracted from Coach conversations and editable by the user.

create table if not exists public.coach_memories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- constraint = injury/allergy/restriction (safety-critical, always injected)
  -- preference = likes/dislikes            pattern   = behavioural, data-derived
  -- fact       = PRs, milestones           directive = advice given + outcome
  kind          text not null check (kind in
                  ('preference','constraint','pattern','fact','directive')),

  subject       text not null,                    -- short slug: 'overhead_press'
  content       text not null,                    -- human-readable memory
  confidence    real not null default 0.7 check (confidence >= 0 and confidence <= 1),

  -- stated     = user said it outright (never decays)
  -- inferred   = model deduced it        measured = computed from logs
  -- user_edited= corrected in the UI (treated as ground truth)
  source        text not null default 'inferred' check (source in
                  ('stated','inferred','measured','user_edited')),

  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz not null default now(),  -- reset when re-observed
  expires_at    timestamptz,                         -- null = durable

  -- Contradicting memories supersede rather than overwrite, so there's an audit
  -- trail and a correction can be undone.
  superseded_by uuid references public.coach_memories(id) on delete set null
);

-- Primary read path: active memories for a user, highest-signal first.
create index if not exists coach_memories_active_idx
  on public.coach_memories (user_id, kind, confidence desc, confirmed_at desc)
  where superseded_by is null;

-- Dedupe/upsert path: find an existing memory about the same subject.
create index if not exists coach_memories_subject_idx
  on public.coach_memories (user_id, kind, subject)
  where superseded_by is null;

alter table public.coach_memories enable row level security;

-- Users see and manage only their own memories. No service-role-only access
-- here: the whole point is that this is user-inspectable and user-correctable.
drop policy if exists "coach_memories_select_own" on public.coach_memories;
create policy "coach_memories_select_own" on public.coach_memories
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "coach_memories_insert_own" on public.coach_memories;
create policy "coach_memories_insert_own" on public.coach_memories
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "coach_memories_update_own" on public.coach_memories;
create policy "coach_memories_update_own" on public.coach_memories
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "coach_memories_delete_own" on public.coach_memories;
create policy "coach_memories_delete_own" on public.coach_memories
  for delete to authenticated using (auth.uid() = user_id);

/*
 * Budgeted retrieval for the Coach prompt.
 *
 * Returns ALL active constraints (safety — an allergy must never be truncated
 * out of the prompt) plus the top-N of each other kind ranked by confidence and
 * recency. Caller injects the result as the "WHAT I KNOW ABOUT THIS USER" block.
 */
create or replace function public.get_coach_memories(
  p_preferences integer default 5,
  p_patterns    integer default 3,
  p_facts       integer default 3,
  p_directives  integer default 3
)
returns table (
  id uuid, kind text, subject text, content text,
  confidence real, source text, confirmed_at timestamptz
)
language sql
stable
security invoker              -- RLS applies; users only ever see their own rows
set search_path = public
as $$
  with active as (
    select m.id, m.kind, m.subject, m.content, m.confidence, m.source, m.confirmed_at
    from public.coach_memories m
    where m.user_id = auth.uid()
      and m.superseded_by is null
      and (m.expires_at is null or m.expires_at > now())
  ),
  ranked as (
    select a.*,
           row_number() over (
             partition by a.kind
             order by a.confidence desc, a.confirmed_at desc
           ) as rn
    from active a
  )
  select r.id, r.kind, r.subject, r.content, r.confidence, r.source, r.confirmed_at
  from ranked r
  where r.kind = 'constraint'                              -- never truncated
     or (r.kind = 'preference' and r.rn <= p_preferences)
     or (r.kind = 'pattern'    and r.rn <= p_patterns)
     or (r.kind = 'fact'       and r.rn <= p_facts)
     or (r.kind = 'directive'  and r.rn <= p_directives)
  order by
    case r.kind
      when 'constraint' then 0 when 'preference' then 1
      when 'pattern'    then 2 when 'fact'       then 3
      else 4
    end,
    r.confidence desc,
    r.confirmed_at desc;
$$;

revoke all on function public.get_coach_memories(integer, integer, integer, integer) from public;
grant execute on function public.get_coach_memories(integer, integer, integer, integer) to authenticated;

/*
 * Record a memory, superseding any existing active memory on the same
 * (kind, subject). Keeps the old row for audit rather than deleting it.
 */
create or replace function public.upsert_coach_memory(
  p_kind       text,
  p_subject    text,
  p_content    text,
  p_confidence real default 0.7,
  p_source     text default 'inferred',
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new_id  uuid;
  v_existing public.coach_memories%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_existing
  from public.coach_memories
  where user_id = auth.uid()
    and kind = p_kind
    and subject = p_subject
    and superseded_by is null
  order by confirmed_at desc
  limit 1;

  -- Identical content: just re-confirm and bump confidence. Repeated
  -- observation is evidence, so decay resets and confidence creeps up.
  if found and v_existing.content = p_content then
    update public.coach_memories
       set confirmed_at = now(),
           confidence = least(1.0, greatest(confidence, p_confidence) + 0.05)
     where id = v_existing.id;
    return v_existing.id;
  end if;

  insert into public.coach_memories
    (user_id, kind, subject, content, confidence, source, expires_at)
  values
    (auth.uid(), p_kind, p_subject, p_content, p_confidence, p_source, p_expires_at)
  returning id into v_new_id;

  if found then
    update public.coach_memories
       set superseded_by = v_new_id
     where id = v_existing.id;
  end if;

  return v_new_id;
end;
$$;

revoke all on function public.upsert_coach_memory(text, text, text, real, text, timestamptz) from public;
grant execute on function public.upsert_coach_memory(text, text, text, real, text, timestamptz) to authenticated;
