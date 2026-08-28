-- Apple refresh tokens, held solely to honor App Review Guideline 5.1.1(v):
-- an app offering Sign in with Apple must revoke the user's Apple tokens when
-- their account is deleted. The authorization code from the sign-in sheet is
-- valid for minutes, so the apple-token-exchange function trades it for a
-- refresh token at sign-in time and parks it here; delete-account spends it.
--
-- Service-role only. No client ever reads or writes this table — RLS is
-- enabled with NO policies, which in Supabase means anon/authenticated get
-- nothing and only the service role (which bypasses RLS) can touch it.

create table if not exists public.apple_refresh_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);

alter table public.apple_refresh_tokens enable row level security;

revoke all on public.apple_refresh_tokens from anon, authenticated;
