-- Coach transcript, moved off the device.
--
-- The conversation lived in a single AsyncStorage key ('fuelog_coach_history')
-- with no user in it and no clear on sign-out, which meant two things at once:
--   1. the next account signed in on the same phone inherited the previous
--      user's transcript — free-form text about weight, body fat and bloodwork
--      — and it loaded on tab mount with no auth check; and
--   2. a user's own conversation died with the app. Reinstall, new phone, or a
--      second device and the Coach had amnesia.
--
-- coach_memories (20260728) already holds the durable FACTS extracted from
-- these conversations. This table holds the conversation itself, so the two sit
-- side by side under the same ownership rules.

create table if not exists public.coach_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  role        text not null check (role in ('user','assistant')),
  content     text not null,

  -- Deterministic order. created_at CANNOT serve: both rows of an exchange are
  -- inserted in one statement, so their now() is identical, and Postgres gives
  -- tied keys back in whatever order the index walk finds them — which the
  -- council showed renders every synced exchange answer-before-question.
  -- An identity column is assigned in insertion order, full stop.
  seq         bigint generated always as identity,

  -- Client-generated, stable across retries: the same message re-sent after a
  -- dropped response must not produce a duplicate row.
  client_id   text,

  created_at  timestamptz not null default now()
);

-- The only read path: this user's most recent messages, newest first, in
-- exact insertion order.
create index if not exists coach_messages_recent_idx
  on public.coach_messages (user_id, seq desc);

-- Idempotent inserts for offline replay / retry.
--
-- Deliberately NOT a partial index (no `where client_id is not null`):
-- PostgREST's upsert emits `on conflict (user_id, client_id)` without the
-- predicate, and Postgres refuses to infer a partial unique index from a
-- predicate-less conflict target (42P10) — so a partial index here would make
-- EVERY send error and nothing would ever persist, caught and logged but
-- invisible to the user. A full unique index gives the same semantics anyway:
-- NULLs are distinct by default, so rows without a client_id never conflict,
-- and repeated (user_id, client_id) pairs dedupe exactly as intended.
create unique index if not exists coach_messages_client_id_idx
  on public.coach_messages (user_id, client_id);

alter table public.coach_messages enable row level security;

-- Same ownership model as coach_memories: the user, and only the user.
drop policy if exists "coach_messages_select_own" on public.coach_messages;
create policy "coach_messages_select_own" on public.coach_messages
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "coach_messages_insert_own" on public.coach_messages;
create policy "coach_messages_insert_own" on public.coach_messages
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "coach_messages_delete_own" on public.coach_messages;
create policy "coach_messages_delete_own" on public.coach_messages
  for delete to authenticated using (auth.uid() = user_id);

-- No update policy on purpose: a transcript is an append-only record of what
-- was actually said. Corrections are new messages, not edits.

/*
 * Trim to the most recent N messages for one user.
 *
 * The client keeps a 50-message window; without a server-side trim the table
 * grows without bound for heavy users and every device sync pulls more than it
 * renders. Called after insert, cheap because of coach_messages_recent_idx.
 */
create or replace function public.trim_coach_messages(p_keep int default 200)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.coach_messages
  where user_id = auth.uid()
    and id not in (
      select id from public.coach_messages
      where user_id = auth.uid()
      order by seq desc
      limit greatest(p_keep, 1)
    );
end;
$$;

revoke all on function public.trim_coach_messages(int) from public;
grant execute on function public.trim_coach_messages(int) to authenticated;
