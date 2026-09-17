-- Referrals: move redemption server-side and make the rules enforceable.
--
-- WHAT WAS WRONG (all four found together, 17 Sep 2026):
--
--   1. ReferralScreen shared `https://fuelog.app/?ref=CODE` while App.tsx
--      parsed only `invite/CODE`. No tapped link was ever attributed.
--   2. There was no field to type a code into, which is how most people pass
--      one on. So attribution was impossible by either route.
--   3. The INSERT policy was `auth.uid() = referee_id` and nothing more. That
--      permits self-referral (referrer_id = referee_id = you), an unlimited
--      number of referrers for one account, a referral_code that does not
--      match the referrer it names, and a client-set status of 'converted' —
--      which mints the reward directly once rewards are wired.
--   4. There is no UPDATE policy, so ReferralScreen.markConversions' update
--      was silently denied by RLS. Status could never leave 'signed_up'.
--
-- This migration fixes 3 and 4. The app change fixes 1 and 2.
--
-- Safe to re-run.

begin;

-- ── Clean up anything the old policy let through, before constraining ──────
-- Self-referrals are never legitimate.
delete from public.referrals where referrer_id = referee_id;

-- One referrer per referee: keep the earliest, drop the rest.
delete from public.referrals r
using public.referrals keep
where r.referee_id = keep.referee_id
  and (keep.created_at, keep.id) < (r.created_at, r.id);

-- A code that does not match the referrer it names is not attributable.
update public.referrals r
set referral_code = p.referral_code
from public.profiles p
where p.id = r.referrer_id
  and p.referral_code is not null
  and r.referral_code is distinct from p.referral_code;

-- ── Constraints the application cannot talk its way around ────────────────
alter table public.referrals
  drop constraint if exists referrals_no_self_referral;
alter table public.referrals
  add constraint referrals_no_self_referral check (referrer_id <> referee_id);

create unique index if not exists referrals_referee_id_key
  on public.referrals (referee_id);

-- ── Redemption is server-side only ────────────────────────────────────────
-- The client can no longer write this table at all. Everything goes through
-- redeem_referral, which is the only place the rules can actually hold.
drop policy if exists "Users can insert referrals as referee" on public.referrals;

-- SELECT stays as it was: you see referrals you gave or received.
-- (auth.uid() = referrer_id OR auth.uid() = referee_id)

/**
 * Redeem a friend's code. Returns jsonb so the UI can say what happened
 * rather than showing a generic failure:
 *
 *   {ok:true,  reason:'redeemed',         code}
 *   {ok:false, reason:'not_signed_in'}
 *   {ok:false, reason:'invalid_code'}
 *   {ok:false, reason:'unknown_code'}
 *   {ok:false, reason:'self_referral'}
 *   {ok:false, reason:'already_referred', code}   -- the code they already used
 *
 * SECURITY DEFINER because it writes rows the caller is no longer allowed to
 * write. It takes the referee identity from auth.uid() and never from an
 * argument, so a caller cannot redeem on someone else's behalf. search_path
 * is pinned: a definer function resolving names through a caller-controlled
 * search_path is the classic privilege-escalation route.
 */
create or replace function public.redeem_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_referrer uuid;
  v_existing text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  -- Same bounds as utils/referral.ts isValidCodeShape. Checked again here
  -- because the client is not the authority on anything.
  if length(v_code) < 4 or length(v_code) > 24 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  select referred_by into v_existing from public.profiles where id = v_uid;
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_referred', 'code', v_existing);
  end if;

  select id into v_referrer from public.profiles where referral_code = v_code;
  if v_referrer is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_code');
  end if;
  if v_referrer = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'self_referral');
  end if;

  insert into public.referrals (referrer_id, referee_id, referral_code, status, signed_up_at)
  values (v_referrer, v_uid, v_code, 'signed_up', now())
  on conflict (referee_id) do nothing;

  update public.profiles set referred_by = v_code
  where id = v_uid and referred_by is null;

  return jsonb_build_object('ok', true, 'reason', 'redeemed', 'code', v_code);
end;
$$;

revoke all on function public.redeem_referral(text) from public, anon;
grant execute on function public.redeem_referral(text) to authenticated;

/**
 * Mark a referral converted. Called by the RevenueCat webhook with the
 * service role, NOT by the app.
 *
 * Conversion means "this referee started paying", and only the payment
 * processor knows that. The old code asked the referee's own device, which
 * (a) RLS silently refused and (b) would have let anyone mint the reward by
 * claiming Pro. Left as a function so the webhook has one call to make, and
 * so the reward grant has one obvious place to live when it is wired.
 */
create or replace function public.mark_referral_converted(p_referee uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.referrals;
begin
  update public.referrals
     set status = 'converted', converted_at = now()
   where referee_id = p_referee
     and status <> 'converted'
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_pending_referral');
  end if;

  -- TODO(reward): grant v_row.referrer_id one month of Pro. Until this is a
  -- real RevenueCat promotional entitlement, ReferralScreen must not promise
  -- a reward — see the copy note in that file.
  return jsonb_build_object('ok', true, 'referrer_id', v_row.referrer_id);
end;
$$;

revoke all on function public.mark_referral_converted(uuid) from public, anon, authenticated;
-- service_role only: the webhook calls this, the app never does.
grant execute on function public.mark_referral_converted(uuid) to service_role;

commit;

-- Verify:
--   select public.redeem_referral('NOPE0000');   -- {"ok":false,"reason":"unknown_code"}
--   select count(*) from public.referrals where referrer_id = referee_id;  -- 0
--   select policyname, cmd from pg_policies
--    where tablename='referrals';                -- SELECT only
