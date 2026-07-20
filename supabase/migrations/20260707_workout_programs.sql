create table workout_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  description text,
  goal text not null,
  days_per_week integer not null,
  duration_weeks integer default 12,
  program_data jsonb not null,
  is_active boolean default false,
  current_week integer default 1,
  current_day integer default 1,
  created_at timestamptz default now()
);
alter table workout_programs enable row level security;
create policy "Users own their programs" on workout_programs
  for all using (auth.uid() = user_id);

create table program_completed_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  program_id uuid references workout_programs not null,
  week integer not null,
  day integer not null,
  completed_at timestamptz default now()
);
alter table program_completed_days enable row level security;
create policy "Users own their completed days" on program_completed_days
  for all using (auth.uid() = user_id);
