/**
 * Periodized daily fuelling for endurance athletes.
 *
 * The two things this does that the general macro engine cannot:
 *
 *   1. CARBOHYDRATE IS PERIODIZED, not multiplied. Guidelines put daily intake
 *      at 3-5 g/kg on rest days and 8-12 g/kg on long/hard days. One static
 *      multiplier cannot express a 4x range, so it is wrong every day.
 *
 *   2. CARBOHYDRATE IS PROTECTED, not residual. The general engine allocates
 *      protein, then fat, and lets carbohydrate absorb whatever is left. For a
 *      lifter that's right. For a triathlete it is backwards — carbohydrate is
 *      the performance-limiting macro and must be reserved first.
 *
 * Zero runtime imports (see enduranceEnergy.ts for why).
 */

import type { IntensityZone } from './enduranceEnergy';

// ── Training phase ──────────────────────────────────────────────────────────

export type TrainingPhase =
  | 'off_season' | 'base' | 'build' | 'peak' | 'taper' | 'race_week';

/**
 * Phase scales the *slope* of the carbohydrate curve, not its floor.
 *
 * Scaling the whole curve would push rest days below the 3 g/kg minimum, which
 * is a real health floor rather than a preference. Scaling only the load term
 * keeps easy days sane while letting base blocks run leaner and peak blocks
 * run fully fuelled.
 */
export const PHASE_CHO_SCALE: Record<TrainingPhase, number> = {
  off_season: 0.80,
  base:       0.90,
  build:      1.00,
  peak:       1.05,
  taper:      1.00,
  race_week:  1.05,
};

export const TRAINING_PHASES: TrainingPhase[] =
  ['off_season', 'base', 'build', 'peak', 'taper', 'race_week'];

export const PHASE_LABEL: Record<TrainingPhase, string> = {
  off_season: 'Off-season',
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  taper: 'Taper',
  race_week: 'Race week',
};

// ── Race date → phase ───────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Whole days from today to the race. Negative once the race has passed. */
export function daysUntilRace(
  raceDateISO?: string | null,
  todayISO?: string | null
): number | null {
  if (!raceDateISO) return null;
  const race = Date.parse(`${raceDateISO.slice(0, 10)}T00:00:00Z`);
  const today = todayISO
    ? Date.parse(`${todayISO.slice(0, 10)}T00:00:00Z`)
    : Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(race) || !Number.isFinite(today)) return null;
  return Math.round((race - today) / DAY_MS);
}

export function weeksUntilRace(
  raceDateISO?: string | null,
  todayISO?: string | null
): number | null {
  const d = daysUntilRace(raceDateISO, todayISO);
  return d === null ? null : d / 7;
}

/**
 * Infer the training phase from how far out the race is.
 *
 * Rough but useful — an athlete following a real plan can override it, and an
 * athlete who isn't following one gets something better than nothing. The
 * boundaries follow conventional periodization for long-course triathlon.
 */
export function phaseFromRaceDate(
  raceDateISO?: string | null,
  todayISO?: string | null
): TrainingPhase | null {
  const days = daysUntilRace(raceDateISO, todayISO);
  if (days === null) return null;
  if (days < 0) return 'off_season';   // race is behind us
  if (days <= 7) return 'race_week';
  if (days <= 21) return 'taper';
  if (days <= 56) return 'peak';
  if (days <= 112) return 'build';
  return 'base';
}

/**
 * Carbohydrate loading runs 36-48 h out, so days 1 and 2 before the race.
 * Race day itself is handled by the pre-race meal, not by loading.
 */
export function isCarbLoadWindow(
  raceDateISO?: string | null,
  todayISO?: string | null,
  raceHours?: number | null
): boolean {
  const days = daysUntilRace(raceDateISO, todayISO);
  if (days === null || days < 1 || days > 2) return false;
  // Only meaningful for events long enough to deplete glycogen.
  return !Number.isFinite(raceHours as number) || (raceHours as number) >= 1.5;
}

// ── Carbohydrate ────────────────────────────────────────────────────────────

/**
 * Curve constants.
 *
 * These were originally base 3 / coefficient 2.5, which passed every "is the
 * output inside the published band" test while systematically sitting near the
 * TOP of each band — 72% of the way up at 4.5 h, 100% at 6 h — and, perversely,
 * slightly BELOW the band at 1 hour. In other words the curve was too steep,
 * and "in band" turned out to be far too weak an assertion to catch it.
 *
 * Recalibrated to land mid-band across the range. The tests now assert position
 * within the band, not just membership.
 */
export const CHO_BASE_G_PER_KG = 3.5;
export const CHO_LOAD_COEFFICIENT = 2.0;
export const CHO_MIN_G_PER_KG = 3;
export const CHO_MAX_G_PER_KG = 12;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isPos = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Carbohydrate target in g/kg from intensity-weighted training hours.
 *
 * Continuous rather than bucketed, so a 61-minute session doesn't jump a whole
 * tier over a 59-minute one. Validated mid-band against the guidelines:
 *
 *   rest (0.0)          ->3.5    guideline 3-5     25% into band
 *   1 h easy Z2 (0.7)   ->4.9    guideline 3-5     upper end, sensible
 *   1 h threshold (1.3) ->6.1    guideline 5-7     55%
 *   2 h Z2 (1.4)        ->6.3    guideline 6-10    8%
 *   3 h Z2 (2.1)        ->7.7    guideline 6-10    43%
 *   4.5 h Z2 (3.15)     ->9.8    guideline 8-12    45%
 *   6 h Z2 (4.2)        ->11.9   guideline 8-12    98%
 */
export function carbTargetGPerKg(
  load: number,
  phase: TrainingPhase = 'build'
): number {
  const l = Number.isFinite(load) && load > 0 ? load : 0;
  const scale = PHASE_CHO_SCALE[phase] ?? 1;
  return clamp(
    CHO_BASE_G_PER_KG + CHO_LOAD_COEFFICIENT * scale * l,
    CHO_MIN_G_PER_KG,
    CHO_MAX_G_PER_KG
  );
}

/**
 * Carbohydrate loading, 36-48 h before a long race.
 *
 * Only worth doing for events long enough to deplete glycogen — under ~90 min
 * you start with enough on board and loading just adds water weight.
 */
export const CARB_LOAD_G_PER_KG = 10.5;
export const CARB_LOAD_G_PER_KG_LONG = 11.5;

/** Loading target for a race of the given expected duration. 0 when not worth it. */
export function carbLoadGPerKgFor(raceHours: number): number {
  if (!Number.isFinite(raceHours) || raceHours < 1.5) return 0;
  return raceHours >= 4 ? CARB_LOAD_G_PER_KG_LONG : CARB_LOAD_G_PER_KG;
}

/** Deliberate low-carb "train low" session, for athletes who periodize that way. */
export const TRAIN_LOW_G_PER_KG = 3;

// ── Protein ─────────────────────────────────────────────────────────────────

/**
 * Endurance protein in g/kg. Requirements are 1.2-2.0 g/kg, and
 * indicator-amino-acid work puts the recommended intake at ~1.83 g/kg.
 *
 * Note these are LOWER than the app's general figures (which reach 2.2 g/kg on
 * a cut). That's deliberate: on a 12 g/kg carbohydrate day you cannot fit
 * 2.2 g/kg protein, the carbohydrate, and a viable fat intake inside any
 * sensible calorie budget — and of the three, protein is the one with the most
 * headroom in this population.
 */
export const ENDURANCE_PROTEIN_G_PER_KG = {
  maintain: 1.6,
  lose: 1.8,   // muscle sparing matters more in a deficit
  gain: 1.7,
} as const;

export const ENDURANCE_PROTEIN_FLOOR_G_PER_KG = 1.4;

/** Hormonal/absorption floor. Below this we refuse to squeeze fat further. */
export const FAT_FLOOR_G_PER_KG = 0.5;

export type EnduranceGoal = 'lose' | 'maintain' | 'gain';

// ── Allocation ──────────────────────────────────────────────────────────────

export interface FuelingInput {
  calories: number;
  massKg: number;
  load: number;
  goal?: EnduranceGoal;
  phase?: TrainingPhase;
  /** Override the computed carbohydrate target, e.g. carb loading. */
  carbGPerKgOverride?: number | null;
}

export interface FuelingTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  carbGPerKg: number;
  proteinGPerKg: number;
  fatGPerKg: number;
  /**
   * Set when the calorie budget cannot hold the carbohydrate target, the
   * protein target and the fat floor at once. The targets returned are the
   * best compromise; `caloriesShortfall` is how much more the athlete would
   * need to eat to satisfy all three.
   */
  underfuelled: boolean;
  caloriesShortfall: number;
}

const KCAL = { protein: 4, carbs: 4, fat: 9 } as const;

/**
 * Allocate macros with carbohydrate protected.
 *
 * Order: carbohydrate (periodized) ->protein (goal-based, floored) ->fat
 * (remainder, floored). If the three cannot coexist inside the budget we do
 * NOT silently shave carbohydrate — we report `underfuelled` with the exact
 * shortfall, because the honest answer to "I want to lose weight while training
 * 20 hours a week" is that the numbers don't work, not a quietly broken plan.
 */
export function allocateEnduranceMacros(input: FuelingInput): FuelingTargets {
  const massKg = isPos(input?.massKg) ? input.massKg : 0;
  const calories = isPos(input?.calories) ? input.calories : 0;
  const goal: EnduranceGoal = input?.goal ?? 'maintain';
  const phase: TrainingPhase = input?.phase ?? 'build';

  if (massKg <= 0 || calories <= 0) {
    return {
      calories: 0, protein: 0, carbs: 0, fat: 0,
      carbGPerKg: 0, proteinGPerKg: 0, fatGPerKg: 0,
      underfuelled: false, caloriesShortfall: 0,
    };
  }

  const carbGPerKg = isPos(input?.carbGPerKgOverride)
    ? clamp(input.carbGPerKgOverride as number, CHO_MIN_G_PER_KG, CHO_MAX_G_PER_KG)
    : carbTargetGPerKg(input?.load ?? 0, phase);

  const proteinGPerKg = ENDURANCE_PROTEIN_G_PER_KG[goal];

  let carbs = carbGPerKg * massKg;
  let protein = proteinGPerKg * massKg;
  const fatFloorG = FAT_FLOOR_G_PER_KG * massKg;

  const required = carbs * KCAL.carbs + protein * KCAL.protein + fatFloorG * KCAL.fat;
  const underfuelled = required > calories;
  const caloriesShortfall = underfuelled ? Math.round(required - calories) : 0;

  let fat: number;

  if (!underfuelled) {
    // Normal case: fat takes the remainder and comfortably clears its floor.
    fat = (calories - carbs * KCAL.carbs - protein * KCAL.protein) / KCAL.fat;
  } else {
    // The budget cannot hold all three. Give up protein first (down to its
    // floor), then carbohydrate — never fat, which is already at its minimum.
    fat = fatFloorG;
    const proteinFloorG = ENDURANCE_PROTEIN_FLOOR_G_PER_KG * massKg;
    let remaining = calories - fat * KCAL.fat;

    const carbKcal = carbs * KCAL.carbs;
    const proteinKcal = protein * KCAL.protein;

    if (remaining >= carbKcal + proteinFloorG * KCAL.protein) {
      protein = (remaining - carbKcal) / KCAL.protein;
    } else {
      protein = proteinFloorG;
      remaining -= protein * KCAL.protein;
      carbs = Math.max(0, remaining / KCAL.carbs);
    }
    void proteinKcal;
  }

  fat = Math.max(0, fat);

  return {
    calories: Math.round(calories),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat),
    carbGPerKg: Math.round((carbs / massKg) * 10) / 10,
    proteinGPerKg: Math.round((protein / massKg) * 10) / 10,
    fatGPerKg: Math.round((fat / massKg) * 10) / 10,
    underfuelled,
    caloriesShortfall,
  };
}

// ── Energy availability (RED-S) ─────────────────────────────────────────────

/**
 * Energy availability is what's left for physiology after training is paid for,
 * normalised to the tissue that actually needs it:
 *
 *     EA = (intake - exercise energy expenditure) / fat-free mass
 *
 * Below 30 kcal/kg FFM/day is the clinical threshold for low energy
 * availability; sustained, it becomes RED-S — a multi-system problem affecting
 * bone density, endocrine function, immunity and performance. 45+ is optimal.
 *
 * This is the single most common serious nutrition problem in age-group
 * endurance sport, and almost no consumer app checks for it. Fuelog already
 * knows fat-free mass from InBody, so the check is nearly free.
 *
 * ── A property of this metric that looks like a bug and is not ──────────────
 *
 * An athlete eating exactly maintenance always has
 *
 *     EA = (maintenance − EEE) / FFM = (BMR × NEAT) / FFM
 *
 * which does not contain a training term at all. With Katch-McArdle
 * (BMR = 370 + 21.6·FFM) and a desk job (NEAT 1.25) that lands near
 *
 *     1.25 × (370/FFM + 21.6)  ≈  33-37 kcal/kg FFM
 *
 * for essentially every body size. So a healthy athlete eating maintenance sits
 * around 35 whether they trained for one hour or six, and CANNOT reach 45
 * without either eating a surplus or having a genuinely active non-training
 * life. Do not "fix" this by inflating the NEAT factors.
 *
 * The consequence for the product: 45 is a well-fuelled/surplus marker, not a
 * daily goal, and 30-45 must NOT produce a warning or the app cries wolf every
 * single day. Only `status === 'low'` is actionable — and it is reachable
 * exactly when it should be, by dieting on top of a heavy training load.
 * Use `shouldWarn` rather than testing the status string at call sites.
 */
export const EA_OPTIMAL = 45;
export const EA_LOW = 30;

export type EaStatus = 'optimal' | 'suboptimal' | 'low' | 'unknown';

export interface EnergyAvailability {
  value: number | null;
  status: EaStatus;
  /**
   * The only field the UI should gate a warning on. True below the clinical
   * threshold only — see the note above on why 30-45 is unremarkable.
   */
  shouldWarn: boolean;
  /** Extra kcal/day needed to clear the low-EA threshold. 0 when already clear. */
  deficitToLow: number;
  /** Extra kcal/day needed to reach optimal. 0 when already optimal. */
  deficitToOptimal: number;
}

export function energyAvailability(
  intakeKcal: number,
  exerciseKcal: number,
  ffmKg: number | null | undefined
): EnergyAvailability {
  if (!isPos(ffmKg) || !isPos(intakeKcal)) {
    return {
      value: null, status: 'unknown', shouldWarn: false,
      deficitToLow: 0, deficitToOptimal: 0,
    };
  }
  const ex = Number.isFinite(exerciseKcal) && exerciseKcal > 0 ? exerciseKcal : 0;
  const ea = (intakeKcal - ex) / ffmKg;

  const status: EaStatus =
    ea >= EA_OPTIMAL ? 'optimal' : ea >= EA_LOW ? 'suboptimal' : 'low';

  return {
    value: Math.round(ea * 10) / 10,
    status,
    shouldWarn: status === 'low',
    deficitToLow: ea >= EA_LOW ? 0 : Math.round((EA_LOW - ea) * ffmKg),
    deficitToOptimal: ea >= EA_OPTIMAL ? 0 : Math.round((EA_OPTIMAL - ea) * ffmKg),
  };
}

/**
 * The lowest calorie target that keeps energy availability at or above the
 * clinical floor. Callers should clamp goal-adjusted targets to this — an app
 * should not prescribe a number that is known to be harmful.
 */
export function minimumSafeCalories(
  exerciseKcal: number,
  ffmKg: number | null | undefined
): number | null {
  if (!isPos(ffmKg)) return null;
  const ex = Number.isFinite(exerciseKcal) && exerciseKcal > 0 ? exerciseKcal : 0;
  return Math.round(EA_LOW * ffmKg + ex);
}

// ── Convenience: one call, whole day ────────────────────────────────────────

export interface EnduranceDayInput extends FuelingInput {
  exerciseKcal?: number;
  ffmKg?: number | null;
  /** Clamp the target up to the low-EA floor. Default true. */
  enforceEnergyAvailability?: boolean;
}

export interface EnduranceDay extends FuelingTargets {
  energyAvailability: EnergyAvailability;
  /** True when the target was raised to clear the low-EA threshold. */
  caloriesRaisedForSafety: boolean;
}

export function enduranceDayTargets(input: EnduranceDayInput): EnduranceDay {
  const exerciseKcal = input?.exerciseKcal ?? 0;
  const ffmKg = input?.ffmKg ?? null;
  const enforce = input?.enforceEnergyAvailability !== false;

  let calories = isPos(input?.calories) ? input.calories : 0;
  let caloriesRaisedForSafety = false;

  if (enforce) {
    const floor = minimumSafeCalories(exerciseKcal, ffmKg);
    if (floor !== null && calories > 0 && calories < floor) {
      calories = floor;
      caloriesRaisedForSafety = true;
    }
  }

  const targets = allocateEnduranceMacros({ ...input, calories });

  return {
    ...targets,
    energyAvailability: energyAvailability(calories, exerciseKcal, ffmKg),
    caloriesRaisedForSafety,
  };
}

// Re-exported so callers don't need two imports to describe a session.
export type { IntensityZone };
