alter table macro_logs
  add column if not exists fiber_g numeric,
  add column if not exists sugar_g numeric,
  add column if not exists sodium_mg numeric,
  add column if not exists calcium_mg numeric,
  add column if not exists iron_mg numeric,
  add column if not exists vitamin_d_mcg numeric,
  add column if not exists vitamin_c_mg numeric,
  add column if not exists vitamin_b12_mcg numeric,
  add column if not exists magnesium_mg numeric,
  add column if not exists zinc_mg numeric,
  add column if not exists potassium_mg numeric,
  add column if not exists omega3_g numeric;

create table if not exists micronutrient_targets (
  user_id uuid primary key references auth.users,
  fiber_g numeric default 25,
  calcium_mg numeric default 1000,
  iron_mg numeric default 18,
  vitamin_d_mcg numeric default 15,
  vitamin_b12_mcg numeric default 2.4,
  magnesium_mg numeric default 320,
  zinc_mg numeric default 8,
  potassium_mg numeric default 2600,
  omega3_g numeric default 1.1,
  updated_at timestamptz default now()
);

alter table micronutrient_targets enable row level security;

create policy "Users own their targets" on micronutrient_targets
  for all using (auth.uid() = user_id);
