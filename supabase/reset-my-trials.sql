-- Reset AI trial counters so you can test the paywall repeatedly.
--
-- Run in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- NOT a migration — it lives outside supabase/migrations/ on purpose so
-- `supabase db push` never runs it.

-- ── 1. Find your user id ────────────────────────────────────────────────────
select id, email, created_at
from auth.users
order by created_at desc
limit 10;

-- ── 2. See what you've used ─────────────────────────────────────────────────
-- select feature, used, last_used
-- from public.ai_trial_usage
-- where user_id = 'PASTE-YOUR-USER-ID'
-- order by last_used desc;

-- ── 3a. Reset EVERYTHING for one account (back to full free trials) ─────────
-- delete from public.ai_trial_usage
-- where user_id = 'PASTE-YOUR-USER-ID';

-- ── 3b. Reset a single feature ──────────────────────────────────────────────
-- delete from public.ai_trial_usage
-- where user_id = 'PASTE-YOUR-USER-ID'
--   and feature = 'food_photo';

-- ── 3c. Jump straight to "one use left", to test the paywall boundary ───────
-- Trial limits: coach 3 · food_photo 3 · food_text 10 · voice_log 5
-- meal_plan 1 · recipe 2 · grocery_list 2 · workout_program 1 · workout_fill 3
-- bloodwork_scan 3 · micronutrients 3 · glucose_insight 3 · inbody_scan 2
-- inbody_segmental 0 (Pro only — always paywalled)
--
-- insert into public.ai_trial_usage (user_id, feature, used)
-- values ('PASTE-YOUR-USER-ID', 'food_photo', 2)
-- on conflict (user_id, feature) do update set used = excluded.used;

-- ── 4. Usage across all users — the cost view ───────────────────────────────
-- Every row here is an AI call someone made without paying. Once you have real
-- users, this is the fastest read on which free features are costing you money.
-- select feature,
--        count(*)      as users,
--        sum(used)     as total_free_calls,
--        round(avg(used), 1) as avg_per_user,
--        max(last_used) as most_recent
-- from public.ai_trial_usage
-- group by feature
-- order by total_free_calls desc;
