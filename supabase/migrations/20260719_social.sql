-- Social feature backend: posts, likes, comments + leaderboard RPC + user search view.
-- SocialScreen.tsx was shipped without these tables ever being migrated (CLAUDE.md known issue #7).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.social_posts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  type        text not null default 'general',
  content     jsonb not null default '{}'::jsonb,   -- { caption, name }
  image_url   text,                                 -- data URI or storage URL
  created_at  timestamptz not null default now()
);

create table if not exists public.post_likes (
  user_id     uuid not null references auth.users (id) on delete cascade,
  post_id     bigint not null references public.social_posts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.post_comments (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  post_id     bigint not null references public.social_posts (id) on delete cascade,
  content     text not null,
  author_name text,
  created_at  timestamptz not null default now()
);

create index if not exists social_posts_created_idx on public.social_posts (created_at desc);
create index if not exists social_posts_user_idx    on public.social_posts (user_id, created_at desc);
create index if not exists post_likes_post_idx      on public.post_likes (post_id);
create index if not exists post_comments_post_idx   on public.post_comments (post_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS: the feed is app-wide — any signed-in user can read; users write/delete
-- only their own rows.
-- ---------------------------------------------------------------------------

alter table public.social_posts  enable row level security;
alter table public.post_likes    enable row level security;
alter table public.post_comments enable row level security;

drop policy if exists "social_posts_select" on public.social_posts;
create policy "social_posts_select" on public.social_posts
  for select to authenticated using (true);

drop policy if exists "social_posts_insert" on public.social_posts;
create policy "social_posts_insert" on public.social_posts
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "social_posts_delete" on public.social_posts;
create policy "social_posts_delete" on public.social_posts
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "post_likes_select" on public.post_likes;
create policy "post_likes_select" on public.post_likes
  for select to authenticated using (true);

drop policy if exists "post_likes_insert" on public.post_likes;
create policy "post_likes_insert" on public.post_likes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "post_likes_delete" on public.post_likes;
create policy "post_likes_delete" on public.post_likes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "post_comments_select" on public.post_comments;
create policy "post_comments_select" on public.post_comments
  for select to authenticated using (true);

drop policy if exists "post_comments_insert" on public.post_comments;
create policy "post_comments_insert" on public.post_comments
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "post_comments_delete" on public.post_comments;
create policy "post_comments_delete" on public.post_comments
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- User search: expose ONLY id + name of other users (profiles RLS stays
-- own-rows-only for everything else).
-- ---------------------------------------------------------------------------

create or replace view public.public_profiles
  with (security_invoker = off) as
  select id, name from public.profiles;

revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Leaderboard: cross-user log counts without opening up macro_logs RLS.
-- Returns top loggers over the past `days` days (name + log count only).
-- ---------------------------------------------------------------------------

create or replace function public.get_leaderboard(days integer default 7)
returns table (user_id uuid, name text, count bigint)
language sql
security definer
set search_path = public
as $$
  select ml.user_id,
         coalesce(p.name, 'Anonymous') as name,
         count(*)::bigint as count
  from public.macro_logs ml
  left join public.profiles p on p.id = ml.user_id
  where ml.created_at >= now() - make_interval(days => days)
  group by ml.user_id, p.name
  order by count desc
  limit 10;
$$;

revoke all on function public.get_leaderboard(integer) from anon, public;
grant execute on function public.get_leaderboard(integer) to authenticated;
