-- Backfill micronutrients stranded in the legacy short-named columns.
--
-- macro_logs carries two generations of micronutrient columns: the originals
-- (`calcium`, `iron`, `magnesium`, …, NOT NULL DEFAULT 0) and the current
-- unit-suffixed ones (`calcium_mg`, `iron_mg`, …, nullable). Every screen now
-- reads the suffixed pair — MineralsScreen's LOGGED_COLUMN map and
-- MicronutrientsScreen's MICRO_SELECT both do.
--
-- Measured on production 2026-09-15, 112 rows:
--     calcium    >0 on 40 rows   calcium_mg    on 42
--     iron       >0 on 35        iron_mg       on 38
--     magnesium  >0 on 40        magnesium_mg  on 41
--   rows where the legacy column has a value and the new one is NULL:  5
--   rows where the two disagree on a value:                            0
--
-- So the two families never contradict each other; five rows simply predate
-- the new columns and are invisible to both micronutrient screens. This fills
-- those in. It only ever writes where the target IS NULL, so it cannot
-- overwrite anything and is safe to re-run.
--
-- It deliberately does NOT drop the legacy columns. They are NOT NULL with a
-- default, so dropping them breaks INSERTs from any build still writing them —
-- and with 1.0 not yet approved, no build has aged out of the wild. Dropping
-- belongs in a release after the writers are gone, not the one before.

begin;

update public.macro_logs set calcium_mg      = calcium     where calcium_mg      is null and coalesce(calcium, 0)     > 0;
update public.macro_logs set iron_mg         = iron        where iron_mg         is null and coalesce(iron, 0)        > 0;
update public.macro_logs set magnesium_mg    = magnesium   where magnesium_mg    is null and coalesce(magnesium, 0)   > 0;
update public.macro_logs set potassium_mg    = potassium   where potassium_mg    is null and coalesce(potassium, 0)   > 0;
update public.macro_logs set zinc_mg         = zinc        where zinc_mg         is null and coalesce(zinc, 0)        > 0;
update public.macro_logs set sodium_mg       = sodium      where sodium_mg       is null and coalesce(sodium, 0)      > 0;
update public.macro_logs set vitamin_c_mg    = vitamin_c   where vitamin_c_mg    is null and coalesce(vitamin_c, 0)   > 0;
update public.macro_logs set vitamin_d_mcg   = vitamin_d   where vitamin_d_mcg   is null and coalesce(vitamin_d, 0)   > 0;
update public.macro_logs set vitamin_b12_mcg = vitamin_b12 where vitamin_b12_mcg is null and coalesce(vitamin_b12, 0) > 0;
update public.macro_logs set omega3_g        = omega3      where omega3_g        is null and coalesce(omega3, 0)      > 0;
update public.macro_logs set fiber_g         = fiber       where fiber_g         is null and coalesce(fiber, 0)       > 0;

commit;

-- Verify (expect every *_orphan to be 0):
--   select count(*) filter (where coalesce(calcium,0)>0   and calcium_mg is null)   as ca_orphan,
--          count(*) filter (where coalesce(iron,0)>0      and iron_mg is null)      as fe_orphan,
--          count(*) filter (where coalesce(magnesium,0)>0 and magnesium_mg is null) as mg_orphan,
--          count(*) filter (where coalesce(potassium,0)>0 and potassium_mg is null) as k_orphan
--   from public.macro_logs;
