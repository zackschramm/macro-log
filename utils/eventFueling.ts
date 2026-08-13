/**
 * Single-discipline endurance event fuelling: ultras, mountain-bike races,
 * road centuries, big hiking days.
 *
 * The triathlon engine (utils/raceFueling.ts) already knows everything about
 * carbohydrate rates, fluid replacement and the trained-tolerance cap. What it
 * cannot express is a race with ONE discipline and a course that lives at
 * altitude — Leadville, not Kona. This module reuses the raceFueling constants
 * and helpers (imported, never duplicated) and adds the two things a
 * single-sport event needs: a per-discipline rate factor, and an altitude
 * adjustment for courses at 2,400 m and above.
 *
 * Same guiding principle as raceFueling: NEVER prescribe a carbohydrate rate
 * the athlete has not practised. Here the cap is even stricter — there is one
 * rate for the whole event, so the trained tolerance is a hard ceiling that is
 * never exceeded, not even by a discipline factor (the triathlon engine lets
 * the bike leg run 5% over; a 12-hour single-sport day does not get that
 * latitude).
 *
 * Zero React Native imports, same rule as the rest of the engine tree — the
 * test runner loads this file directly under tsx.
 */

import {
  baseCarbRate,
  needsMixedCarbSource,
  MIXED_CARB_THRESHOLD_G_PER_H,
  GLUCOSE_FRUCTOSE_RATIO,
  FLUID_REPLACEMENT_FRACTION,
  DEFAULT_SWEAT_RATE_L_PER_H,
  DEFAULT_SWEAT_SODIUM_MG_PER_L,
  HOT_SWEAT_MULTIPLIER,
  shouldCarbLoad,
  carbLoadGPerKg,
} from './raceFueling';

// ── Disciplines ─────────────────────────────────────────────────────────────

export type EventDiscipline = 'run' | 'mtb' | 'road' | 'hike';

export const EVENT_DISCIPLINES: readonly EventDiscipline[] = [
  'run', 'mtb', 'road', 'hike',
] as const;

/**
 * How much of the duration-based guideline rate each discipline can actually
 * take in, relative to the triathlon engine's bike (1.05) and run (0.75):
 *
 *   road  1.05  stable position, hands free — same as the tri bike
 *   mtb   1.00  bike-level gut tolerance, but technical terrain keeps closing
 *               the windows where eating is physically possible
 *   hike  0.90  walking pace permits real eating and carries less GI stress
 *               than running, but it is still weight-bearing work
 *   run   0.75  impact and gut jostle — same as the tri run
 */
export const DISCIPLINE_RATE_FACTOR: Record<EventDiscipline, number> = {
  road: 1.05,
  mtb:  1.0,
  run:  0.75,
  hike: 0.9,
};

export const DISCIPLINE_LABEL: Record<EventDiscipline, string> = {
  run:  'Run / Ultra',
  mtb:  'Mountain Bike',
  road: 'Road',
  hike: 'Hike',
};

// ── Altitude ────────────────────────────────────────────────────────────────

/**
 * From ~2,400 m, respiratory water loss (dry air, higher ventilation) and
 * altitude diuresis raise fluid needs materially, and appetite is blunted at
 * exactly the moment intake matters most. The fluid target gets a flat 10%
 * raise and the plan says why. From 3,000 m the appetite effect is strong
 * enough to warrant its own warning.
 */
export const ALTITUDE_FLUID_THRESHOLD_M = 2400;
export const HIGH_ALTITUDE_THRESHOLD_M = 3000;
export const ALTITUDE_FLUID_MULTIPLIER = 1.1;

/**
 * When the athlete lives this far below the course, the altitude effects above
 * are ones their training has never rehearsed — worth saying explicitly.
 */
export const UNACCUSTOMED_ALTITUDE_GAP_M = 1500;

/**
 * No race course exists above ~5,400 m. A larger value is almost certainly
 * feet entered as metres (Leadville's 10,152 ft becoming "10152 m"), so it is
 * rejected rather than silently producing a plan for the death zone — same
 * discipline as sweatRateLPerH() rejecting a 7 kg/h "sweat rate" as a typo.
 */
export const MAX_CREDIBLE_ALTITUDE_M = 6000;

// ── Other clamps and thresholds ─────────────────────────────────────────────

/** Beyond ~4 L/h is not physiological — mirror of the sweat-test ceiling. */
export const MAX_CREDIBLE_SWEAT_RATE_L_PER_H = 4;

/** Multi-day stage racing is out of scope; longer inputs clamp to this. */
export const MAX_EVENT_HOURS = 48;

/** Past this, all-gel fuelling stops being takeable and solids come in. */
export const SOLID_FOOD_HOURS = 6;

/** Enough climbing that effort — and eating opportunity — comes in blocks. */
export const BIG_VERT_NOTE_M = 2500;

/** Vert beyond this on one course is a data-entry error (ft as m), ignore. */
export const MAX_CREDIBLE_VERT_M = 15000;

// ── Plan ────────────────────────────────────────────────────────────────────

export interface EventPlanInput {
  discipline: EventDiscipline;
  /** Expected time on course, hours. */
  targetHours: number;
  weightKg: number;
  /**
   * Highest carbohydrate rate actually practised in training, g/h. Hard cap —
   * see the module note. Non-positive or missing means "unset": the guideline
   * rate applies and the UI is expected to warn.
   */
  trainedCarbTolerance?: number | null;
  /** Measured, litres per hour. Falls back to the population default. */
  sweatRateLPerH?: number | null;
  /** Hot/humid conditions raise sweat rate 25%, same as raceFueling. */
  hotRace?: boolean;
  /** Course altitude, metres. Drives the fluid raise and altitude notes. */
  raceAltitudeM?: number | null;
  /** Where the athlete lives, metres. 0 (sea level) is a valid value. */
  homeAltitudeM?: number | null;
  /** Total climbing on the course, metres. Optional, notes only. */
  vertGainM?: number | null;
}

export interface EventPlan {
  discipline: EventDiscipline;
  totalHours: number;
  /** Guideline rate for the duration, before the discipline factor. */
  baseRateGPerH: number;
  /** What we actually prescribe: base × discipline factor, hard-capped. */
  carbRateGPerH: number;
  /** True when trained tolerance is the binding constraint. */
  limitedByTolerance: boolean;
  totalCarbG: number;
  fluidLPerH: number;
  totalFluidL: number;
  sodiumMgPerH: number;
  totalSodiumMg: number;
  mixedSourceRequired: boolean;
  /** True when the ≥2,400 m fluid raise was applied. */
  altitudeFluidApplied: boolean;
  /** Day-before loading, when the event is long enough to warrant it. */
  carbLoad: { gPerKg: number; totalG: number } | null;
  notes: string[];
}

const isPos = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function emptyPlan(discipline: EventDiscipline): EventPlan {
  return {
    discipline,
    totalHours: 0,
    baseRateGPerH: 0,
    carbRateGPerH: 0,
    limitedByTolerance: false,
    totalCarbG: 0,
    fluidLPerH: 0,
    totalFluidL: 0,
    sodiumMgPerH: 0,
    totalSodiumMg: 0,
    mixedSourceRequired: false,
    altitudeFluidApplied: false,
    carbLoad: null,
    notes: [],
  };
}

export function buildEventPlan(input: EventPlanInput): EventPlan {
  // Junk discipline falls back to the most conservative factor.
  const discipline: EventDiscipline =
    input?.discipline && DISCIPLINE_RATE_FACTOR[input.discipline] !== undefined
      ? input.discipline
      : 'run';

  const rawHours = isPos(input?.targetHours)
    ? Math.min(input.targetHours, MAX_EVENT_HOURS)
    : 0;
  if (rawHours <= 0) return emptyPlan(discipline);
  const hours = r1(rawHours);

  const weightKg = isPos(input?.weightKg) ? input.weightKg : 0;

  // ── Carbohydrate rate ── duration sets the guideline, the discipline scales
  // it, and the trained tolerance caps it. The cap is never exceeded: floor()
  // on a fractional tolerance so rounding cannot sneak above it.
  const baseRateGPerH = baseCarbRate(hours);
  const uncapped = Math.round(baseRateGPerH * DISCIPLINE_RATE_FACTOR[discipline]);
  const tolerance = isPos(input?.trainedCarbTolerance)
    ? Math.floor(input.trainedCarbTolerance)
    : null;
  const carbRateGPerH = tolerance !== null ? Math.min(uncapped, tolerance) : uncapped;
  const limitedByTolerance = tolerance !== null && tolerance < uncapped;

  // ── Fluid and sodium ── replacement fraction and heat multiplier are the
  // raceFueling ones; altitude adds a flat 10% from 2,400 m.
  const sweatValid =
    isPos(input?.sweatRateLPerH) &&
    input.sweatRateLPerH! <= MAX_CREDIBLE_SWEAT_RATE_L_PER_H;
  const sweatBase = sweatValid ? input.sweatRateLPerH! : DEFAULT_SWEAT_RATE_L_PER_H;
  const sweatRate = sweatBase * (input?.hotRace ? HOT_SWEAT_MULTIPLIER : 1);

  const raceAlt =
    isPos(input?.raceAltitudeM) && input.raceAltitudeM! <= MAX_CREDIBLE_ALTITUDE_M
      ? input.raceAltitudeM!
      : null;
  const homeAlt =
    typeof input?.homeAltitudeM === 'number' &&
    Number.isFinite(input.homeAltitudeM) &&
    input.homeAltitudeM >= 0 &&
    input.homeAltitudeM <= MAX_CREDIBLE_ALTITUDE_M
      ? input.homeAltitudeM
      : null;
  const altitudeFluidApplied = raceAlt !== null && raceAlt >= ALTITUDE_FLUID_THRESHOLD_M;

  const fluidLPerH = r2(
    sweatRate * FLUID_REPLACEMENT_FRACTION *
    (altitudeFluidApplied ? ALTITUDE_FLUID_MULTIPLIER : 1)
  );
  const sodiumMgPerH = Math.round(fluidLPerH * DEFAULT_SWEAT_SODIUM_MG_PER_L);

  // Totals derive from the rounded per-hour numbers so the plan is internally
  // consistent — what the table shows per hour times the hours IS the total.
  const totalCarbG = Math.round(carbRateGPerH * hours);
  const totalFluidL = r1(fluidLPerH * hours);
  const totalSodiumMg = Math.round(sodiumMgPerH * hours);

  const mixedSourceRequired = needsMixedCarbSource(carbRateGPerH);

  const vert =
    isPos(input?.vertGainM) && input.vertGainM! <= MAX_CREDIBLE_VERT_M
      ? input.vertGainM!
      : null;

  const carbLoad =
    shouldCarbLoad(hours) && weightKg > 0
      ? {
          gPerKg: carbLoadGPerKg(hours),
          totalG: Math.round(carbLoadGPerKg(hours) * weightKg),
        }
      : null;

  // ── Notes ── plain sentences describing what the plan did and why. They
  // describe mechanisms and practice, never promised outcomes.
  const notes: string[] = [];

  if (limitedByTolerance) {
    notes.push(
      `Capped at your trained ${tolerance} g/h rather than the ${uncapped} g/h ` +
      `this duration and discipline support. Gut training closes that gap.`
    );
  }
  if (mixedSourceRequired) {
    notes.push(
      `Your rate is above ${MIXED_CARB_THRESHOLD_G_PER_H} g/h, so you need ` +
      `mixed glucose:fructose (${GLUCOSE_FRUCTOSE_RATIO}). A single-source product ` +
      `will not absorb fast enough and will sit in your gut.`
    );
  }
  if (input?.hotRace) {
    notes.push('Sweat rate raised 25% for heat — retest in similar conditions if you can.');
  }
  if (!sweatValid) {
    notes.push(
      `Using the ${DEFAULT_SWEAT_RATE_L_PER_H} L/h population default. Do a ` +
      `sweat-rate test — individual rates vary more than any other variable here.`
    );
  }
  if (altitudeFluidApplied) {
    notes.push(
      `Race altitude ${Math.round(raceAlt!)} m: fluid raised 10%. Altitude ` +
      `increases respiratory and urinary fluid loss and suppresses appetite, ` +
      `so fuelling by schedule beats fuelling by hunger.`
    );
    if (raceAlt! >= HIGH_ALTITUDE_THRESHOLD_M) {
      notes.push(
        `Above ${HIGH_ALTITUDE_THRESHOLD_M} m appetite suppression is strong and ` +
        `thirst lags behind losses. This plan assumes you are reasonably ` +
        `acclimatised — when to arrive is an acclimatisation question outside a ` +
        `fuelling plan's scope. Set a timer and eat when it goes off.`
      );
    }
    if (homeAlt !== null && raceAlt! - homeAlt >= UNACCUSTOMED_ALTITUDE_GAP_M) {
      notes.push(
        `The course sits about ${Math.round(raceAlt! - homeAlt)} m above where ` +
        `you live, so these altitude effects will be unfamiliar rather than ` +
        `practised. That makes the schedule matter more, not less.`
      );
    }
  }
  if (discipline === 'mtb') {
    notes.push(
      'Technical descents close your eating windows on a mountain bike. ' +
      'Front-load intake on climbs and smooth sections rather than spreading it evenly.'
    );
  }
  if (vert !== null && vert >= BIG_VERT_NOTE_M) {
    notes.push(
      `About ${Math.round(vert)} m of climbing means effort — and the chance to ` +
      `eat — comes in blocks. Plan feeds by time, not by distance markers.`
    );
  }
  if (hours >= SOLID_FOOD_HOURS) {
    notes.push(
      `Past ${SOLID_FOOD_HOURS} hours, gels alone get hard to keep taking. ` +
      `Standard ultra practice is to mix in solid food you have used in training.`
    );
  }
  if (hours >= 3) {
    notes.push('Practise this exact plan on at least two long sessions before race day.');
  }
  if (carbLoad) {
    notes.push(
      `Day before: about ${carbLoad.gPerKg} g of carbohydrate per kg — roughly ` +
      `${carbLoad.totalG} g at your weight.`
    );
  }

  return {
    discipline,
    totalHours: hours,
    baseRateGPerH,
    carbRateGPerH,
    limitedByTolerance,
    totalCarbG,
    fluidLPerH,
    totalFluidL,
    sodiumMgPerH,
    totalSodiumMg,
    mixedSourceRequired,
    altitudeFluidApplied,
    carbLoad,
    notes,
  };
}
