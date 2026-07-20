create table cycle_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date date not null,
  phase text,
  period_day integer,
  flow_intensity text,
  symptoms text[],
  energy_level integer,
  notes text,
  unique(user_id, date)
);
alter table cycle_logs enable row level security;
create policy "Users own their cycle logs" on cycle_logs
  for all using (auth.uid() = user_id);

create table cycle_settings (
  user_id uuid primary key references auth.users,
  cycle_length_days integer default 28,
  period_length_days integer default 5,
  last_period_start date,
  tracking_enabled boolean default false
);
alter table cycle_settings enable row level security;
create policy "Users own their settings" on cycle_settings
  for all using (auth.uid() = user_id);
