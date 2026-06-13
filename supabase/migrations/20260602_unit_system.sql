-- Remember each user's preferred measurement system.
-- Canonical data stays imperial (weight_lbs, height_in, *_in, *_lb); this only
-- controls how values are displayed and entered in the app.
alter table public.profiles
  add column if not exists unit_system text not null default 'imperial'
  check (unit_system in ('imperial', 'metric'));
