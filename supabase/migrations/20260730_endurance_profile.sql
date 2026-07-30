-- Endurance / triathlon profile fields.
--
-- The sport key itself already lives in profiles.sport (now able to hold
-- tri_sprint / tri_olympic / tri_70_3 / tri_ironman). These columns carry the
-- extra state the endurance engine needs that a single sport label cannot:
-- when the race is, how well trained the athlete's gut is, how much they sweat,
-- and how active they are outside training.
--
-- All nullable with sensible defaults — an existing user who never opens the
-- endurance settings is unaffected.

alter table public.profiles
  add column if not exists race_date date,
  -- null means "infer from race_date"; a value is an explicit override
  add column if not exists training_phase text,
  -- highest carbohydrate rate actually practised in training, g/h.
  -- Hard-caps every race plan; see utils/raceFueling.ts.
  add column if not exists carb_tolerance_g_per_h int,
  add column if not exists sweat_rate_l_per_h numeric(4,2),
  add column if not exists sweat_sodium_mg_per_l int,
  -- non-exercise activity only. Deliberately separate from `activity`, which
  -- is the legacy multiplier that already contains training and must NOT be
  -- combined with per-session energy or training is counted twice.
  add column if not exists neat_level text,
  -- changes defaults, warning verbosity and how much detail the UI exposes
  add column if not exists experience_level text,
  -- target finish time in hours, for race-plan split estimation
  add column if not exists goal_finish_hours numeric(4,2);

-- Guard the enum-ish columns so a typo in the client can't poison the data.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_training_phase_check'
  ) then
    alter table public.profiles add constraint profiles_training_phase_check
      check (training_phase is null or training_phase in
        ('off_season','base','build','peak','taper','race_week'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_neat_level_check'
  ) then
    alter table public.profiles add constraint profiles_neat_level_check
      check (neat_level is null or neat_level in ('sedentary','standing','manual'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_experience_level_check'
  ) then
    alter table public.profiles add constraint profiles_experience_level_check
      check (experience_level is null or experience_level in ('first_timer','experienced'));
  end if;

  -- Physiologically implausible values are far more likely to be unit errors
  -- (lb entered as kg, ml as L) than real, and they propagate into race plans.
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_carb_tolerance_check'
  ) then
    alter table public.profiles add constraint profiles_carb_tolerance_check
      check (carb_tolerance_g_per_h is null
             or (carb_tolerance_g_per_h between 0 and 200));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_sweat_rate_check'
  ) then
    alter table public.profiles add constraint profiles_sweat_rate_check
      check (sweat_rate_l_per_h is null or (sweat_rate_l_per_h between 0 and 4));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_sweat_sodium_check'
  ) then
    alter table public.profiles add constraint profiles_sweat_sodium_check
      check (sweat_sodium_mg_per_l is null
             or (sweat_sodium_mg_per_l between 100 and 3000));
  end if;
end $$;

comment on column public.profiles.carb_tolerance_g_per_h is
  'Highest in-session carbohydrate rate the athlete has actually trained, g/h. Race plans are capped by this — never prescribe a rate that has not been practised.';
comment on column public.profiles.neat_level is
  'Non-exercise activity only. Never combine with the legacy `activity` multiplier when per-session energy is available.';
