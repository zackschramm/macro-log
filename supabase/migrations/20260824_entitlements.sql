-- Entitlement gate: server-side source of truth for Pro access.
-- SAFE TO RUN ANY TIME (additive only — no app behavior changes until the
-- ai-proxy v3 enforcement deploy, which happens only after App Review approval).
--
-- Run in Supabase SQL editor. Idempotent.

create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_pro boolean not null default false,
  -- 'revenuecat' = webhook-driven; 'manual' = founder/demo allowlist rows
  source text not null default 'revenuecat',
  -- RevenueCat entitlement expiry; null for manual rows = never expires
  expires_at timestamptz,
  product_id text,
  environment text,           -- SANDBOX | PRODUCTION (from RC events)
  updated_at timestamptz not null default now()
);

comment on table public.entitlements is
  'Server-side Pro entitlement per user. Written by the revenuecat-webhook edge function and by manual demo-account rows. Read by ai-proxy (shadow first, enforcing after launch).';

-- RLS: no client access at all. Only service-role (edge functions) touch it.
alter table public.entitlements enable row level security;
-- (no policies on purpose: anon/authenticated get nothing)

create index if not exists entitlements_expires_idx on public.entitlements (expires_at);

-- Helper the proxy calls: is this user Pro right now?
-- SECURITY DEFINER so it can read the table without policies.
create or replace function public.has_pro_entitlement(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select is_pro
       and (expires_at is null or expires_at > now())
     from public.entitlements
     where user_id = p_user_id),
    false
  );
$$;

revoke all on function public.has_pro_entitlement(uuid) from public;
grant execute on function public.has_pro_entitlement(uuid) to service_role;

-- ── Demo allowlist rows (create AFTER the review demo accounts exist) ──
-- Replace the UUIDs with the real auth.users ids of the review demo accounts.
-- insert into public.entitlements (user_id, is_pro, source, expires_at)
-- values
--   ('<APPLE-DEMO-ACCOUNT-UUID>', true, 'manual', null)
-- on conflict (user_id) do update
--   set is_pro = true, source = 'manual', expires_at = null, updated_at = now();
