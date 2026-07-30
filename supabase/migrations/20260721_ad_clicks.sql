-- Ad click tracking. The redirect page at fuelog.app/go logs one row per click
-- (timestamp + source/medium/campaign/creative), then forwards to the App Store.
-- Gives real "when and where" per-click data the App Store's own analytics can't.

create table if not exists public.ad_clicks (
  id          bigint generated always as identity primary key,
  clicked_at  timestamptz not null default now(),
  source      text,          -- instagram | tiktok | youtube | reddit | ...
  medium      text,          -- story | feed | reel | bio | ...
  campaign    text,          -- e.g. launch_2026_07
  content     text,          -- which creative: story_hero | square_macros | ...
  referrer    text,          -- document.referrer (where the click came from)
  user_agent  text
);

create index if not exists ad_clicks_time_idx on public.ad_clicks (clicked_at desc);
create index if not exists ad_clicks_source_idx on public.ad_clicks (source, campaign);

-- Anonymous visitors may INSERT a click, but nobody can read the table without
-- the service role — so click data isn't publicly enumerable.
alter table public.ad_clicks enable row level security;

drop policy if exists "ad_clicks_insert_anon" on public.ad_clicks;
create policy "ad_clicks_insert_anon" on public.ad_clicks
  for insert to anon, authenticated with check (true);

-- Aggregated stats for the dashboard. security definer so it can read the
-- (otherwise unreadable) table, but only ever returns COUNTS and a small recent
-- feed — never bulk-exposes the raw rows. Granted to anon so the standalone
-- dashboard file can call it with the public anon key.
create or replace function public.get_ad_click_stats(days integer default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with scoped as (
    select * from public.ad_clicks
    where clicked_at >= now() - make_interval(days => days)
  )
  -- Each breakdown groups by the plain column first (no aggregate in GROUP BY),
  -- then wraps the {label,count} rows in jsonb_agg.
  select jsonb_build_object(
    'total',       (select count(*) from scoped),
    'total_all',   (select count(*) from public.ad_clicks),
    'days',        days,
    'by_day',      coalesce((
                     select jsonb_agg(jsonb_build_object('day', day, 'count', cnt) order by day)
                     from (select to_char(date_trunc('day', clicked_at), 'YYYY-MM-DD') as day, count(*) as cnt
                           from scoped group by 1) d), '[]'::jsonb),
    'by_source',   coalesce((
                     select jsonb_agg(jsonb_build_object('label', label, 'count', cnt) order by cnt desc)
                     from (select coalesce(source, 'unknown') as label, count(*) as cnt
                           from scoped group by 1) s), '[]'::jsonb),
    'by_medium',   coalesce((
                     select jsonb_agg(jsonb_build_object('label', label, 'count', cnt) order by cnt desc)
                     from (select coalesce(medium, 'unknown') as label, count(*) as cnt
                           from scoped group by 1) m), '[]'::jsonb),
    'by_campaign', coalesce((
                     select jsonb_agg(jsonb_build_object('label', label, 'count', cnt) order by cnt desc)
                     from (select coalesce(campaign, 'unknown') as label, count(*) as cnt
                           from scoped group by 1) c), '[]'::jsonb),
    'by_content',  coalesce((
                     select jsonb_agg(jsonb_build_object('label', label, 'count', cnt) order by cnt desc)
                     from (select coalesce(content, 'unknown') as label, count(*) as cnt
                           from scoped group by 1) co), '[]'::jsonb),
    'recent',      coalesce((
                     select jsonb_agg(jsonb_build_object('at', clicked_at, 'source', source, 'medium', medium,
                                                         'campaign', campaign, 'content', content) order by clicked_at desc)
                     from (select * from scoped order by clicked_at desc limit 30) r), '[]'::jsonb)
  );
$$;

revoke all on function public.get_ad_click_stats(integer) from public;
grant execute on function public.get_ad_click_stats(integer) to anon, authenticated;
