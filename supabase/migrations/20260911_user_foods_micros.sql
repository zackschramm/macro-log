-- Saved foods keep their micronutrients.
--
-- Until now user_foods held macros + fiber only, so a food first logged from
-- the USDA search wrote a full micronutrient row to macro_logs, but every
-- later log of the same food from "My Foods" wrote nulls. Since athletes log
-- the same twenty foods from My Foods, the Nutrients screen never moved
-- ("micronutrients don't update" — build-165 finding). Column names match
-- macro_logs so a saved food can be spread straight into a log row.
--
-- Note: user_foods already carried a set of short-named micro columns
-- (calcium, iron, sodium, vitamin_c, … numeric default 0) added from the
-- dashboard and never written by the app — every row holds 0. They are left
-- in place (dropping columns on the day of launch is not worth it) and are
-- dead; the app reads and writes only the *_mg/_mcg/_g columns below.
-- Applied to production 2026-09-14 via the SQL editor.
alter table user_foods
  add column if not exists fiber_g numeric,
  add column if not exists calcium_mg numeric,
  add column if not exists iron_mg numeric,
  add column if not exists vitamin_d_mcg numeric,
  add column if not exists vitamin_c_mg numeric,
  add column if not exists vitamin_b12_mcg numeric,
  add column if not exists magnesium_mg numeric,
  add column if not exists zinc_mg numeric,
  add column if not exists potassium_mg numeric,
  add column if not exists sodium_mg numeric,
  add column if not exists omega3_g numeric;

-- Carry the legacy fiber column across once.
update user_foods set fiber_g = fiber where fiber_g is null and fiber is not null;
