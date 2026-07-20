create table wearable_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  provider text not null, -- 'whoop' | 'oura' | 'garmin'
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  unique(user_id, provider)
);
alter table wearable_tokens enable row level security;
create policy "Users own their tokens" on wearable_tokens
  for all using (auth.uid() = user_id);
