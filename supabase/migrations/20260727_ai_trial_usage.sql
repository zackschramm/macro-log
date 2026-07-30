-- Server-side free-trial counters for AI features.
--
-- These counts previously lived in AsyncStorage (fuelog_coach_message_count,
-- fuelog_ai_workout_fill_count, fuelog_bloodwork_scan_count), which meant
-- deleting and reinstalling the app handed the user a fresh set of free uses —
-- an unlimited bypass of the paywall. Tying them to the account closes that.
--
-- It also gives the first real visibility into AI usage per feature, which is
-- what the cost model needs: every row here is an Anthropic call someone made
-- without paying.

create table if not exists public.ai_trial_usage (
  user_id    uuid not null references auth.users(id) on delete cascade,
  feature    text not null,          -- matches AIFeature in utils/proGate.ts
  used       integer not null default 0 check (used >= 0),
  first_used timestamptz not null default now(),
  last_used  timestamptz not null default now(),
  primary key (user_id, feature)
);

create index if not exists ai_trial_usage_feature_idx
  on public.ai_trial_usage (feature, last_used desc);

alter table public.ai_trial_usage enable row level security;

-- Users may read their own counts (the UI shows "2 of 3 free uses left").
drop policy if exists "ai_trial_usage_select_own" on public.ai_trial_usage;
create policy "ai_trial_usage_select_own" on public.ai_trial_usage
  for select to authenticated using (auth.uid() = user_id);

-- No direct INSERT/UPDATE policy on purpose: all writes go through
-- consume_ai_trial() below, so a client can't reset its own counter to zero.

/*
 * Atomically consume one free use and report whether it was allowed.
 *
 * Returns { allowed, used, limit, remaining }. `allowed` is true when the call
 * should proceed. Atomic because a user tapping twice quickly must not get two
 * uses out of one remaining credit.
 *
 * NOTE: this governs the FREE trial only. Pro entitlement is checked client-side
 * against RevenueCat before this is ever called.
 */
create or replace function public.consume_ai_trial(
  p_feature text,
  p_limit   integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_limit < 0 then
    raise exception 'limit must be >= 0';
  end if;

  insert into public.ai_trial_usage (user_id, feature, used)
  values (auth.uid(), p_feature, 0)
  on conflict (user_id, feature) do nothing;

  -- Lock this user's row so concurrent taps can't both pass the check.
  select used into v_used
  from public.ai_trial_usage
  where user_id = auth.uid() and feature = p_feature
  for update;

  if v_used >= p_limit then
    return jsonb_build_object(
      'allowed', false, 'used', v_used, 'limit', p_limit, 'remaining', 0
    );
  end if;

  update public.ai_trial_usage
     set used = used + 1, last_used = now()
   where user_id = auth.uid() and feature = p_feature
  returning used into v_used;

  return jsonb_build_object(
    'allowed', true, 'used', v_used, 'limit', p_limit,
    'remaining', greatest(p_limit - v_used, 0)
  );
end;
$$;

revoke all on function public.consume_ai_trial(text, integer) from public;
grant execute on function public.consume_ai_trial(text, integer) to authenticated;

/*
 * Read remaining trial uses without consuming one — for UI badges like
 * "2 free scans left". Never mutates.
 */
create or replace function public.get_ai_trial_status(p_limit integer default 3)
returns table (feature text, used integer, remaining integer)
language sql
stable
security invoker
set search_path = public
as $$
  select u.feature, u.used, greatest(p_limit - u.used, 0) as remaining
  from public.ai_trial_usage u
  where u.user_id = auth.uid();
$$;

revoke all on function public.get_ai_trial_status(integer) from public;
grant execute on function public.get_ai_trial_status(integer) to authenticated;

/*
 * One-time migration of a device's existing AsyncStorage counts.
 *
 * Existing users have already spent free uses locally. Without this they'd get
 * a fresh allowance on first launch after the update. Takes the HIGHER of the
 * stored and reported values so it can't be used to lower a count.
 */
create or replace function public.seed_ai_trial(
  p_feature text,
  p_used    integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.ai_trial_usage (user_id, feature, used)
  values (auth.uid(), p_feature, greatest(p_used, 0))
  on conflict (user_id, feature)
  do update set used = greatest(public.ai_trial_usage.used, excluded.used);
end;
$$;

revoke all on function public.seed_ai_trial(text, integer) from public;
grant execute on function public.seed_ai_trial(text, integer) to authenticated;
