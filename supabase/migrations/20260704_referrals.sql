create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid references auth.users not null,
  referee_id uuid references auth.users,
  referral_code text not null,
  status text default 'pending',  -- 'pending' | 'signed_up' | 'converted'
  created_at timestamptz default now(),
  signed_up_at timestamptz,
  converted_at timestamptz
);

alter table referrals enable row level security;

create policy "Users can read their referrals" on referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referee_id);

create policy "Users can insert referrals as referee" on referrals
  for insert with check (auth.uid() = referee_id);

alter table profiles add column if not exists referred_by text;
alter table profiles add column if not exists referral_code text unique;
