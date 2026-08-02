/**
 * Daily fuelling for strength and power athletes — archetype B.
 *
 * Covers `powerlifting` and `none` (general fitness), which between them are
 * very likely the plurality of Fuelog's users. General-fitness users sit here
 * deliberately: nutritionally they are low-volume strength athletes.
 *
 * ── WHY THIS IS NOT THE ENDURANCE MODEL WITH NARROWER PARAMETERS ────────────
 *
 * A triathlete's nutrition is driven by glycogen depleted over hours, and that
 * variable swings roughly 4x between a rest day and a long day. A lifter's is
 * driven by total energy sufficiency and by how protein is DISTRIBUTED across
 * the day, and it barely swings at all. The performance-limiting question is
 * whether they ate enough this month, not whether they ate enough at hour four.
 *
 * Giving a powerlifter a 3-12 g/kg carbohydrate curve with a narrower range is
 * still the wrong model, just a quieter one. So:
 *
 *   - the carbohydrate curve is flat (3-7 g/kg) and is a GUIDELINE the day is
 *     checked against, not a protected allocation
 *   - the per-meal protein target is the structural equivalent of the endurance
 *     athlete's g/h fuelling rate: a rate the app tracks against and can be
 *     wrong about in a way the daily total hides
 *   - there is no in-event carbohydrate rate, no gut training and no sweat-rate
 *     field, because a meet is nine maximal attempts with twenty-minute waits
 *
 * ── ALLOCATION ORDER STAYS PROTEIN -> FAT -> CARBS ──────────────────────────
 *
 * `enduranceFueling.ts` flipped the app's allocation to carbohydrate-first.
 * That flip is a statement about which macro limits performance in ENDURANCE,
 * and it is correct there and nowhere else. Here the original engine is right,
 * and this is stated loudly so nobody "generalises" the flip into this file.
 *
 * Basis: Slater & Phillips 2011 (nutrition guidelines for strength sports);
 * ISSN position stand on protein and exercise (Jäger et al. 2017); Areta et al.
 * 2013 and Res et al. 2012 for distribution and pre-sleep protein.
 *
 * NOT IN SCOPE, deliberately: the weight-class overlay that a powerlifter would
 * get on declaring a competition weight. That is archetype E, which is designed
 * but not built — see the seam in `constants/sportArchetypes.ts`. There is no
 * target-weight input in this file and there should not be one until that ships.
 *
 * Runtime imports limited to the other zero-import pure modules in this engine,
 * which keeps the test runner able to load the tree without React Native.
 */

import {
  energyAvailability, applyEnergyAvailabilityFloor,
  type EnergyAvailability,
} from './energyAvailability';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isPos = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;
const r1 = (n: number) => Math.round(n * 10) / 10;

const KCAL = { protein: 4, carbs: 4, fat: 9 } as const;

// ── Block periodization ─────────────────────────────────────────────────────

/**
 * Blocks, not base/build/peak/taper. Same code shape as `PHASE_CHO_SCALE`,
 * different table and a very different calorie story.
 */
export type StrengthBlock =
  | 'accumulation' | 'intensification' | 'realization' | 'deload';

export const STRENGTH_BLOCKS: StrengthBlock[] =
  ['accumulation', 'intensification', 'realization', 'deload'];

export const BLOCK_LABEL: Record<StrengthBlock, string> = {
  accumulation:    'Accumulation',
  intensification: 'Intensification',
  realization:     'Realization',
  deload:          'Deload',
};

/**
 * Scales the SLOPE of the carbohydrate curve, not its floor — same reasoning as
 * the endurance module. Scaling the whole curve would push rest days below the
 * 3 g/kg minimum, which is a health floor rather than a preference.
 */
export const BLOCK_CHO_SCALE: Record<StrengthBlock, number> = {
  accumulation:    1.05,
  intensification: 1.00,
  realization:     1.05,
  deload:          0.90,
};

/**
 * Calorie band relative to maintenance, per block.
 *
 * The one that matters is `realization`: calories are HELD. The classic error
 * going into a meet is cutting calories because training volume dropped, which
 * arrives at the platform under-fuelled and under-recovered on the one day it
 * cannot be fixed.
 */
export const BLOCK_CALORIE_SCALE: Record<StrengthBlock, { min: number; max: number }> = {
  accumulation:    { min: 1.00, max: 1.10 },
  intensification: { min: 1.00, max: 1.00 },
  realization:     { min: 1.00, max: 1.00 },
  deload:          { min: 1.00, max: 1.00 },
};

export const BLOCK_NOTE: Record<StrengthBlock, string> = {
  accumulation:
    'Highest volume of the cycle. Maintenance to +10% calories — this is where ' +
    'the surplus, if there is one, belongs.',
  intensification:
    'Volume down, intensity up. Protein stays high; calories stay at maintenance.',
  realization:
    'Peaking into the meet. Hold calories at maintenance. Volume dropping is not ' +
    'a reason to eat less — cutting here is the classic error and it costs you on ' +
    'the platform.',
  deload:
    'Recovery block. Carbohydrate eases off with the work; protein does not.',
};

const DAY_MS = 86_400_000;

/** Whole days from today to the meet. Negative once the meet has passed. */
export function daysUntilMeet(
  meetDateISO?: string | null,
  todayISO?: string | null
): number | null {
  if (!meetDateISO) return null;
  const meet = Date.parse(`${meetDateISO.slice(0, 10)}T00:00:00Z`);
  const today = todayISO
    ? Date.parse(`${todayISO.slice(0, 10)}T00:00:00Z`)
    : Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(meet) || !Number.isFinite(today)) return null;
  return Math.round((meet - today) / DAY_MS);
}

/**
 * Infer the block from how far out the meet is.
 *
 * Rough but useful, and the same bargain as `phaseFromRaceDate`: a lifter
 * following a real programme overrides it, and one who isn't gets something
 * better than nothing. The valuable case is that it puts a lifter three weeks
 * out into `realization`, where the calorie note fires on its own.
 */
export function blockFromMeetDate(
  meetDateISO?: string | null,
  todayISO?: string | null
): StrengthBlock | null {
  const days = daysUntilMeet(meetDateISO, todayISO);
  if (days === null) return null;
  if (days < -14) return 'accumulation';
  if (days < 0) return 'deload';        // the fortnight after a meet
  if (days <= 21) return 'realization';
  if (days <= 63) return 'intensification';
  return 'accumulation';
}

// ── Carbohydrate ────────────────────────────────────────────────────────────

/**
 * 4-7 g/kg/day is the strength-sport band (Slater & Phillips 2011). Same
 * continuous form as the endurance curve, much flatter slope, much lower
 * ceiling:
 *
 *   rest day          load 0     -> 3.5 g/kg
 *   60 min moderate   load ~0.8  -> 4.2
 *   90 min heavy      load ~1.5  -> 4.8
 *   2 h high-volume   load ~2.0  -> 5.2
 */
export const STRENGTH_CHO_BASE_G_PER_KG = 3.5;
export const STRENGTH_CHO_LOAD_COEFFICIENT = 0.8;
export const STRENGTH_CHO_MIN_G_PER_KG = 3;
export const STRENGTH_CHO_MAX_G_PER_KG = 7;

/** Default block: where a lifter not pointed at a meet spends most of the year. */
export const DEFAULT_STRENGTH_BLOCK: StrengthBlock = 'accumulation';

export function strengthCarbTargetGPerKg(
  load: number,
  block: StrengthBlock = DEFAULT_STRENGTH_BLOCK
): number {
  const l = Number.isFinite(load) && load > 0 ? load : 0;
  const scale = BLOCK_CHO_SCALE[block] ?? 1;
  return clamp(
    STRENGTH_CHO_BASE_G_PER_KG + STRENGTH_CHO_LOAD_COEFFICIENT * scale * l,
    STRENGTH_CHO_MIN_G_PER_KG,
    STRENGTH_CHO_MAX_G_PER_KG
  );
}

// ── Protein ─────────────────────────────────────────────────────────────────

/**
 * 1.6-2.2 g/kg. The deficit figure is the highest because lean-mass sparing is
 * the whole job when energy is restricted.
 */
export const STRENGTH_PROTEIN_G_PER_KG = {
  maintain: 1.6,
  lose:     2.2,
  gain:     1.8,
} as const;

export const STRENGTH_PROTEIN_FLOOR_G_PER_KG = 1.4;

export type StrengthGoal = 'lose' | 'maintain' | 'gain';

/**
 * The part that matters more than the daily total.
 *
 * Areta et al. 2013 showed 20 g every 3 h beats 40 g every 6 h for the same
 * daily total. Res et al. 2012 and Snijders et al. 2015 support the pre-sleep
 * dose. So the app tracks a per-meal target the way it tracks an endurance
 * athlete's g/h — and it can be wrong about it in a way the daily total hides.
 */
export const PROTEIN_PER_MEAL_G_PER_KG = { min: 0.3, max: 0.4 } as const;
export const PRE_SLEEP_PROTEIN_G_PER_KG = 0.4;

export interface ProteinMeal {
  /** 1-based. The last meal is the pre-sleep dose. */
  index: number;
  /** Hours after the first meal of the day. */
  hoursAfterFirst: number;
  proteinG: number;
  gPerKg: number;
  preSleep: boolean;
}

export interface ProteinDistribution {
  dailyG: number;
  dailyGPerKg: number;
  mealCount: number;
  /** Target for each non-pre-sleep meal. */
  perMealG: number;
  perMealGPerKg: number;
  /** Slow protein — casein or dairy. Counts toward the daily total. */
  preSleepG: number;
  /** Hours between meals for this meal count. */
  gapHours: number;
  /** True when the per-meal dose lands in the 0.3-0.4 g/kg band. */
  inBand: boolean;
  meals: ProteinMeal[];
  note: string;
}

/**
 * Spread a daily protein total across meals so every dose clears the leucine
 * threshold without wasting the back half of the day.
 *
 * Meal count is derived rather than fixed: 1.6 g/kg fits four doses of 0.4,
 * but 2.2 g/kg across four would be 0.55 g/kg a sitting, past the point of
 * useful return. Capped at six because past that it stops being a diet and
 * starts being a schedule nobody keeps.
 */
export function planProteinDistribution(
  massKg: number,
  dailyProteinG: number,
  mealCountOverride?: number | null
): ProteinDistribution {
  const mass = isPos(massKg) ? massKg : 0;
  const daily = isPos(dailyProteinG) ? dailyProteinG : 0;

  if (mass <= 0 || daily <= 0) {
    return {
      dailyG: 0, dailyGPerKg: 0, mealCount: 0, perMealG: 0, perMealGPerKg: 0,
      preSleepG: 0, gapHours: 0, inBand: false, meals: [],
      note: 'Body weight and a protein target are needed before meals can be spread.',
    };
  }

  const dailyGPerKg = daily / mass;
  const maxPerMealG = PROTEIN_PER_MEAL_G_PER_KG.max * mass;

  const mealCount = isPos(mealCountOverride)
    ? clamp(Math.round(mealCountOverride as number), 3, 6)
    : clamp(Math.ceil(daily / maxPerMealG), 4, 6);

  // Wider gaps with fewer meals, so the eating window stays a normal waking day
  // rather than stretching to eighteen hours.
  const gapHours = mealCount >= 6 ? 3 : mealCount === 5 ? 3.5 : 4;

  const preSleepG = Math.min(PRE_SLEEP_PROTEIN_G_PER_KG * mass, daily);
  const others = Math.max(1, mealCount - 1);
  const perMealG = Math.max(0, (daily - preSleepG) / others);
  const perMealGPerKg = perMealG / mass;

  const meals: ProteinMeal[] = Array.from({ length: mealCount }, (_, i) => {
    const preSleep = i === mealCount - 1;
    const g = preSleep ? preSleepG : perMealG;
    return {
      index: i + 1,
      hoursAfterFirst: r1(i * gapHours),
      proteinG: Math.round(g),
      gPerKg: r1(g / mass),
      preSleep,
    };
  });

  // Half a decimal place of tolerance — the band is a guideline, not a cliff.
  const inBand =
    perMealGPerKg >= PROTEIN_PER_MEAL_G_PER_KG.min - 0.01 &&
    perMealGPerKg <= PROTEIN_PER_MEAL_G_PER_KG.max + 0.01;

  const note = inBand
    ? `${Math.round(perMealG)}g at each of ${mealCount - 1} meals ${gapHours}h apart, ` +
      `plus ${Math.round(preSleepG)}g of slow protein before bed. Same daily total, ` +
      `more of it used.`
    : `${Math.round(perMealG)}g a meal is outside the ${PROTEIN_PER_MEAL_G_PER_KG.min}` +
      `-${PROTEIN_PER_MEAL_G_PER_KG.max} g/kg per-sitting band. Change the number of ` +
      `meals rather than the daily total.`;

  return {
    dailyG: Math.round(daily),
    dailyGPerKg: r1(dailyGPerKg),
    mealCount,
    perMealG: Math.round(perMealG),
    perMealGPerKg: r1(perMealGPerKg),
    preSleepG: Math.round(preSleepG),
    gapHours,
    inBand,
    meals,
    note,
  };
}

// ── Fat ─────────────────────────────────────────────────────────────────────

/**
 * The floor is higher than endurance's 0.5 g/kg because these athletes have the
 * calorie room and the endocrine argument is real.
 *
 * Note that fat is allocated AT this floor rather than above it. Carbohydrate
 * is the residual macro in this archetype, so the floor and the allocation are
 * the same number — which is what makes the worked example in the design
 * (90 kg, 2 h heavy, ~3,075 kcal maintenance) land on 5.1 g/kg carbohydrate
 * against a curve that asks for 5.2.
 */
export const STRENGTH_FAT_FLOOR_G_PER_KG = 0.8;
export const STRENGTH_FAT_FLOOR_CALORIE_SHARE = 0.20;

export function strengthFatFloorG(massKg: number, calories: number): number {
  const mass = isPos(massKg) ? massKg : 0;
  const cal = isPos(calories) ? calories : 0;
  return Math.max(
    STRENGTH_FAT_FLOOR_G_PER_KG * mass,
    (STRENGTH_FAT_FLOOR_CALORIE_SHARE * cal) / KCAL.fat
  );
}

// ── Allocation ──────────────────────────────────────────────────────────────

export interface StrengthFuelingInput {
  calories: number;
  massKg: number;
  /** Intensity-weighted training hours from `dailyLoad()`. */
  load: number;
  goal?: StrengthGoal;
  block?: StrengthBlock;
  /**
   * Fix carbohydrate rather than letting it fall out as the residual — used for
   * the rare long meet that warrants a load, and for athletes overriding the
   * computed number. Athletes may override anything here EXCEPT the safety
   * floors, which is why there is no override for those.
   */
  carbGPerKgOverride?: number | null;
  /** Spread protein across this many meals instead of the derived count. */
  mealCount?: number | null;
}

export interface StrengthTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  carbGPerKg: number;
  proteinGPerKg: number;
  fatGPerKg: number;
  /**
   * What the block/load curve says this day asks for. Reported alongside the
   * delivered `carbGPerKg` rather than replacing it, so a lifter can see when
   * their calorie budget is not carrying their training volume.
   */
  carbGuidelineGPerKg: number;
  /**
   * Set when the budget cannot hold the protein target, the fat floor and the
   * 3 g/kg carbohydrate floor at once. The targets returned are the best
   * compromise; `caloriesShortfall` is how much more it would take to satisfy
   * all three. Report the conflict, never silently shave the protected macro.
   */
  underfuelled: boolean;
  caloriesShortfall: number;
  proteinDistribution: ProteinDistribution;
}

/**
 * Allocate macros protein-first.
 *
 * Order: protein (goal-based, floored) -> fat (at its floor) -> carbohydrate
 * (the remainder, floored at 3 g/kg). When the three cannot coexist inside the
 * budget, protein is walked back toward its own floor to protect the
 * carbohydrate floor — below 3 g/kg training quality collapses and the honest
 * answer is that the deficit is too aggressive for the training volume, not a
 * quietly broken plan. Fat is never shaved; it is already at its minimum.
 */
export function allocateStrengthMacros(input: StrengthFuelingInput): StrengthTargets {
  const massKg = isPos(input?.massKg) ? input.massKg : 0;
  const calories = isPos(input?.calories) ? input.calories : 0;
  const goal: StrengthGoal = input?.goal ?? 'maintain';
  const block: StrengthBlock = input?.block ?? DEFAULT_STRENGTH_BLOCK;

  if (massKg <= 0 || calories <= 0) {
    return {
      calories: 0, protein: 0, carbs: 0, fat: 0,
      carbGPerKg: 0, proteinGPerKg: 0, fatGPerKg: 0,
      carbGuidelineGPerKg: 0,
      underfuelled: false, caloriesShortfall: 0,
      proteinDistribution: planProteinDistribution(0, 0),
    };
  }

  const carbGuidelineGPerKg = strengthCarbTargetGPerKg(input?.load ?? 0, block);
  const proteinTargetG = STRENGTH_PROTEIN_G_PER_KG[goal] * massKg;
  const proteinFloorG = STRENGTH_PROTEIN_FLOOR_G_PER_KG * massKg;
  const fatFloorG = strengthFatFloorG(massKg, calories);
  const carbFloorG = STRENGTH_CHO_MIN_G_PER_KG * massKg;
  const carbCeilingG = STRENGTH_CHO_MAX_G_PER_KG * massKg;

  const overridden = isPos(input?.carbGPerKgOverride);
  const requestedCarbG = overridden
    ? clamp(
        input.carbGPerKgOverride as number,
        STRENGTH_CHO_MIN_G_PER_KG,
        STRENGTH_CHO_MAX_G_PER_KG
      ) * massKg
    : carbFloorG;

  let protein = proteinTargetG;
  let fat = fatFloorG;
  let carbs: number;

  if (overridden) {
    // Athlete-fixed carbohydrate: carbohydrate is protected and FAT takes the
    // remainder above its floor, mirroring the endurance module's shape.
    carbs = requestedCarbG;
    fat = Math.max(
      fatFloorG,
      (calories - carbs * KCAL.carbs - protein * KCAL.protein) / KCAL.fat
    );
  } else {
    carbs = (calories - protein * KCAL.protein - fat * KCAL.fat) / KCAL.carbs;
    if (carbs > carbCeilingG) {
      // A surplus big enough to push carbohydrate past 7 g/kg is not a
      // carbohydrate requirement, it is spare energy. Cap the band and let fat
      // — which has headroom above its floor — take the rest, rather than
      // prescribing a lifter 9 g/kg because the calorie target was generous.
      carbs = carbCeilingG;
      fat = (calories - carbs * KCAL.carbs - protein * KCAL.protein) / KCAL.fat;
    }
  }

  // What it would take to satisfy the carbohydrate commitment (the floor, or
  // the athlete's own figure), the protein target and the fat floor at once.
  const required =
    Math.max(carbFloorG, requestedCarbG) * KCAL.carbs +
    proteinTargetG * KCAL.protein +
    fatFloorG * KCAL.fat;
  const underfuelled = required > calories;
  const caloriesShortfall = underfuelled ? Math.round(required - calories) : 0;

  // Reconcile against the budget. Two ways to arrive here: the residual left
  // carbohydrate under its floor, or a fixed carbohydrate figure does not fit
  // alongside protein and the fat floor. Both resolve the same way — protein
  // gives way first, down to its own floor, then carbohydrate. Fat is already
  // at its minimum and is never shaved.
  const overBudget = () =>
    carbs * KCAL.carbs + protein * KCAL.protein + fat * KCAL.fat > calories + 0.5;

  if (carbs < carbFloorG || overBudget()) {
    fat = fatFloorG;
    carbs = Math.max(carbs, carbFloorG);
    protein = (calories - carbs * KCAL.carbs - fat * KCAL.fat) / KCAL.protein;
    if (protein < proteinFloorG) {
      protein = proteinFloorG;
      carbs = Math.max(
        0,
        (calories - protein * KCAL.protein - fat * KCAL.fat) / KCAL.carbs
      );
    }
  }

  protein = Math.max(0, protein);
  carbs = Math.max(0, carbs);
  fat = Math.max(0, fat);

  return {
    calories: Math.round(calories),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    carbGPerKg: r1(carbs / massKg),
    proteinGPerKg: r1(protein / massKg),
    fatGPerKg: r1(fat / massKg),
    carbGuidelineGPerKg: r1(carbGuidelineGPerKg),
    underfuelled,
    caloriesShortfall,
    proteinDistribution: planProteinDistribution(massKg, protein, input?.mealCount),
  };
}

// ── Convenience: one call, whole day ────────────────────────────────────────

export interface StrengthDayInput extends StrengthFuelingInput {
  exerciseKcal?: number;
  ffmKg?: number | null;
  /** Clamp the target up to the low-EA floor. Default true. */
  enforceEnergyAvailability?: boolean;
  /** Ignore the flag above and always clamp. Set from `eaClampFor(sport)`. */
  energyAvailabilityNonOverridable?: boolean;
}

export interface StrengthDay extends StrengthTargets {
  energyAvailability: EnergyAvailability;
  /** True when the target was raised to clear the low-EA threshold. */
  caloriesRaisedForSafety: boolean;
}

/**
 * The whole day for a strength athlete, with the shared energy-availability
 * floor applied first.
 *
 * The guard is not endurance-specific and never was — a lifter dieting hard on
 * top of five sessions a week breaches it the same way a triathlete does, and
 * until the guard moved out of `enduranceFueling.ts` they could not reach it.
 */
export function strengthDayTargets(input: StrengthDayInput): StrengthDay {
  const exerciseKcal = input?.exerciseKcal ?? 0;
  const ffmKg = input?.ffmKg ?? null;

  const floored = applyEnergyAvailabilityFloor({
    calories: isPos(input?.calories) ? input.calories : 0,
    exerciseKcal,
    ffmKg,
    enforce: input?.enforceEnergyAvailability,
    nonOverridable: input?.energyAvailabilityNonOverridable,
  });

  const targets = allocateStrengthMacros({ ...input, calories: floored.calories });

  return {
    ...targets,
    energyAvailability: energyAvailability(floored.calories, exerciseKcal, ffmKg),
    caloriesRaisedForSafety: floored.raised,
  };
}

// ── Meet day ────────────────────────────────────────────────────────────────

/**
 * Six to ten hours, nine maximal attempts, twenty-minute waits.
 *
 * This is not a fuelling-rate problem — there is no analogue of the endurance
 * athlete's g/h here, and pretending otherwise would be the exact mistake this
 * archetype exists to avoid. It is a blood-glucose, hydration and
 * don't-be-bloated problem.
 */
export const MEET_PRE_CHO_G_PER_KG = { min: 1, max: 2 } as const;
export const MEET_BETWEEN_ATTEMPT_CHO_G = { min: 20, max: 40 } as const;
/** Below this gap there is no time to take anything and no need to. */
export const MEET_ATTEMPT_GAP_THRESHOLD_MIN = 20;
/**
 * Deliberately modest. Intra-abdominal pressure is the point of the belt, and a
 * full stomach fights it.
 */
export const MEET_FLUID_L_PER_H = 0.5;
export const MEET_CAFFEINE_MG_PER_KG = { min: 3, max: 6 } as const;
export const MEET_CAFFEINE_DEFAULT_MG_PER_KG = 4;
/**
 * Total ceiling for the DAY, not per dose. Three doses across a nine-hour meet
 * is a tachycardia problem, not a performance plan.
 */
export const CAFFEINE_DAILY_CAP_MG_PER_KG = 6;

export interface MeetStep {
  label: string;
  /** Minutes relative to the opener. Negative is before. */
  offsetMin: number;
  carbG: number;
  fluidMl: number;
  caffeineMg: number;
  detail: string;
}

export interface MeetDayPlan {
  massKg: number;
  meetHours: number;
  attempts: number;
  attemptGapMin: number;
  preMeetCarbG: { min: number; max: number };
  /** The single dose, after the daily cap has been applied. */
  caffeineMg: number;
  caffeineCapMg: number;
  /** True when the cap bound the dose because caffeine was already taken. */
  caffeineLimited: boolean;
  betweenAttemptCarbG: number;
  steps: MeetStep[];
  totalCarbG: number;
  totalFluidL: number;
  totalCaffeineMg: number;
  notes: string[];
}

export interface MeetDayInput {
  massKg: number;
  /** Expected time on the platform, warm-up to last attempt. Default 6 h. */
  meetHours?: number;
  /** Default 9 — three attempts on each of the three lifts. */
  attempts?: number;
  /** Typical wait between your attempts. Default 25 min. */
  attemptGapMin?: number;
  /** 3-6 mg/kg. Default 4. Clamped to the band and then to the daily cap. */
  caffeineMgPerKg?: number | null;
  /** Caffeine already taken today — morning coffee counts. */
  caffeineAlreadyMg?: number | null;
  /** Never prescribe caffeine to someone who doesn't use it on a meet day. */
  caffeineHabituated?: boolean;
}

export function buildMeetDayPlan(input: MeetDayInput): MeetDayPlan {
  const massKg = isPos(input?.massKg) ? input.massKg : 0;
  const meetHours = isPos(input?.meetHours) ? (input.meetHours as number) : 6;
  const attempts = isPos(input?.attempts) ? Math.round(input.attempts as number) : 9;
  const attemptGapMin = isPos(input?.attemptGapMin)
    ? (input.attemptGapMin as number)
    : 25;

  const preMeetCarbG = {
    min: Math.round(MEET_PRE_CHO_G_PER_KG.min * massKg),
    max: Math.round(MEET_PRE_CHO_G_PER_KG.max * massKg),
  };
  const preMeetCarbMid = Math.round((preMeetCarbG.min + preMeetCarbG.max) / 2);

  // Caffeine: one dose, capped for the day. Habituation is a hard gate — a meet
  // is the worst possible day to find out how you react to a new stimulant.
  const capMg = Math.round(CAFFEINE_DAILY_CAP_MG_PER_KG * massKg);
  const alreadyMg = isPos(input?.caffeineAlreadyMg)
    ? Math.round(input.caffeineAlreadyMg as number)
    : 0;
  const requestedPerKg = clamp(
    isPos(input?.caffeineMgPerKg)
      ? (input.caffeineMgPerKg as number)
      : MEET_CAFFEINE_DEFAULT_MG_PER_KG,
    MEET_CAFFEINE_MG_PER_KG.min,
    MEET_CAFFEINE_MG_PER_KG.max
  );
  const wantedMg = input?.caffeineHabituated === false
    ? 0
    : Math.round(requestedPerKg * massKg);
  const caffeineMg = Math.max(0, Math.min(wantedMg, capMg - alreadyMg));
  const caffeineLimited = caffeineMg < wantedMg;

  const feedBetween = attemptGapMin > MEET_ATTEMPT_GAP_THRESHOLD_MIN;
  const betweenAttemptCarbG = feedBetween
    ? (attemptGapMin >= 40 ? MEET_BETWEEN_ATTEMPT_CHO_G.max : MEET_BETWEEN_ATTEMPT_CHO_G.min + 10)
    : 0;

  const gaps = Math.max(0, attempts - 1);
  const fluidPerGapMl = gaps > 0
    ? Math.round((MEET_FLUID_L_PER_H * meetHours * 1000) / gaps)
    : 0;

  const steps: MeetStep[] = [
    {
      label: 'T−3:00',
      offsetMin: -180,
      carbG: preMeetCarbMid,
      fluidMl: 0,
      caffeineMg: 0,
      detail: 'Low fat, low fibre, familiar. Nothing you have not eaten before a session.',
    },
  ];

  if (caffeineMg > 0) {
    steps.push({
      label: 'T−1:00',
      offsetMin: -60,
      carbG: 0,
      fluidMl: 0,
      caffeineMg,
      detail: 'One dose, timed to the opener. Not repeated later in the day.',
    });
  }

  for (let i = 1; i <= gaps; i++) {
    steps.push({
      label: `Attempts ${i} → ${i + 1}`,
      offsetMin: Math.round(i * attemptGapMin),
      carbG: betweenAttemptCarbG,
      fluidMl: fluidPerGapMl,
      caffeineMg: 0,
      detail: feedBetween
        ? 'Liquid or gel. A lifter who has to brace does not want a sandwich.'
        : 'Fluid only — the gap is too short for anything else to be useful.',
    });
  }

  steps.push({
    label: 'After',
    offsetMin: Math.round(gaps * attemptGapMin + 30),
    carbG: 0,
    fluidMl: 0,
    caffeineMg: 0,
    detail: 'Normal high-carbohydrate meal. Nothing special is required.',
  });

  const notes: string[] = [];
  notes.push(
    `Fluid is deliberately modest at about ${MEET_FLUID_L_PER_H} L/h. ` +
    'Intra-abdominal pressure is the point of the belt and a full stomach fights it.'
  );
  if (!feedBetween) {
    notes.push(
      `Your attempts are about ${Math.round(attemptGapMin)} minutes apart, under the ` +
      `${MEET_ATTEMPT_GAP_THRESHOLD_MIN}-minute mark where eating between them is worth it. ` +
      'Fluid only.'
    );
  }
  if (caffeineLimited && wantedMg > 0) {
    notes.push(
      `Caffeine capped at ${caffeineMg} mg — you have already had ${alreadyMg} mg today and ` +
      `the day's ceiling is ${capMg} mg (${CAFFEINE_DAILY_CAP_MG_PER_KG} mg/kg). Stacking ` +
      'doses across a long meet is a heart-rate problem, not a performance plan.'
    );
  }
  if (input?.caffeineHabituated === false) {
    notes.push(
      'No caffeine planned — you are not habituated to it. A meet is the worst day to ' +
      'find out how you react to a new stimulant.'
    );
  }
  if (meetHours >= 8) {
    notes.push(
      `${r1(meetHours)} hours on the platform. Bring more food than you think you need ` +
      'and eat to the schedule rather than to appetite, which disappears under nerves.'
    );
  }
  notes.push('Rehearse this exact routine in a heavy training session before you use it.');

  return {
    massKg,
    meetHours: r1(meetHours),
    attempts,
    attemptGapMin: Math.round(attemptGapMin),
    preMeetCarbG,
    caffeineMg,
    caffeineCapMg: capMg,
    caffeineLimited,
    betweenAttemptCarbG,
    steps,
    totalCarbG: steps.reduce((s, x) => s + x.carbG, 0),
    totalFluidL: r1(steps.reduce((s, x) => s + x.fluidMl, 0) / 1000),
    totalCaffeineMg: steps.reduce((s, x) => s + x.caffeineMg, 0),
    notes,
  };
}

/**
 * Carbohydrate loading for a meet is worth it only when the day on the platform
 * is long enough to actually deplete glycogen. For most meets it is not — nine
 * singles over six hours is not a depleting event, and loading just adds water
 * weight you then have to squat.
 */
export const MEET_CARB_LOAD_MIN_HOURS = 3;

export function shouldCarbLoadForMeet(meetHours: number): boolean {
  return Number.isFinite(meetHours) && meetHours >= MEET_CARB_LOAD_MIN_HOURS;
}
