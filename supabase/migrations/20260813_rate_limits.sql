-- Per-user fixed-window rate limiting for edge functions that relay to paid
-- third-party APIs (ai-proxy -> Anthropic/USDA). Service-role only: RLS is
-- enabled with no policies, so anon/user keys cannot read or tamper.
create table if not exists public.rate_limits (
  user_id uuid not null,
  bucket text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  primary key (user_id, bucket)
);

alter table public.rate_limits enable row level security;

-- Atomic check-and-increment. Returns true when the caller is within the
-- limit for the current window, false when they have exceeded it. A new
-- window starts the first time a request arrives after the old one expires.
create or replace function public.check_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  insert into rate_limits as rl (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update set
    count = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else rl.count + 1
    end,
    window_start = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else rl.window_start
    end
  returning rl.count <= p_limit into v_allowed;
  return v_allowed;
end;
$$;

revoke execute on function public.check_rate_limit from public, anon, authenticated;
