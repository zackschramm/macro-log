-- Build 165 follow-up: the "your selection is saved, press Save & Recalculate"
-- notice lived in ProfileScreen's own state, so switching tabs (which unmounts
-- the screen) or relaunching the app hid it while the stored targets were
-- still computed from the previous selection -- a 624 kcal gap in the reviewed
-- example, with nothing on screen to say so. The flag belongs on the row.
--
-- A tile tap sets it (one column-partial write, no read-modify-write).
-- Save & Recalculate, a weigh-in sync and the stats backfill all clear it,
-- because each writes targets computed from the row's own activity/goal/sport.
alter table public.profiles
  add column if not exists targets_stale boolean not null default false;

comment on column public.profiles.targets_stale is
  'True when activity/goal/sport were changed without recalculating calories/protein/carbs/fat.';
