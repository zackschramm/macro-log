/**
 * Race-day fuelling for triathlon, plus the gut-training and sweat-rate work
 * that has to happen beforehand for the plan to be achievable.
 *
 * The guiding principle: NEVER prescribe a carbohydrate rate the athlete has
 * not practised. Research and elite fields support 90-120 g/h for long course,
 * but handing 110 g/h to someone whose longest ride has been fuelled at 60 is
 * how you write a DNF at mile 60 of the bike. Every number here is capped by
 * trained tolerance, and if the race is too close to close the gap, the plan
 * says so instead of quietly optimising.
 *
 * Zero runtime imports (see enduranceEnergy.ts).
 */

// ── Race distances ──────────────────────────────────────────────────────────

export type TriDistance = 'sprint' | 'olympic' | 'half' | 'full';

export interface TriCourse {
  label: string;
  swimKm: number;
  bikeKm: number;
  runKm: number;
  /** Typical finishing range in hours, for age-group athletes. */
  typicalHours: [number, number];
}

export const TRI_COURSES: Record<TriDistance, TriCourse> = {
  sprint:  { label: 'Sprint',   swimKm: 0.75, bikeKm: 20,  runKm: 5,    typicalHours: [1.0, 1.8] },
  olympic: { label: 'Olympic',  swimKm: 1.5,  bikeKm: 40,  runKm: 10,   typicalHours: [2.0, 3.5] },
  half:    { label: '70.3',     swimKm: 1.9,  bikeKm: 90,  runKm: 21.1, typicalHours: [4.5, 7.5] },
  full:    { label: 'Ironman',  swimKm: 3.8,  bikeKm: 180, runKm: 42.2, typicalHours: [9.5, 16.0] },
};

// ── Carbohydrate rate ───────────────────────────────────────────────────────

/**
 * Baseline carbohydrate rate in g/h by expected race duration.
 *
 *   < 1 h    0     glycogen on board is enough; a mouth-rinse at most
 *   1-2 h    45    30-60 band
 *   2-3 h    75    60-90 band
 *   > 3 h    105   90-120 band, where long course now sits
 */
export function baseCarbRate(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  if (hours < 1) return 0;
  if (hours < 2) return 45;
  if (hours < 3) return 75;
  return 105;
}

/**
 * Glucose transport (SGLT1) saturates near 60 g/h. Fructose crosses on a
 * separate transporter (GLUT5), so mixing raises the ceiling. Above 60 g/h a
 * single-source product will sit in the gut and cause distress no matter how
 * well trained the athlete is.
 */
export const MIXED_CARB_THRESHOLD_G_PER_H = 60;
export const GLUCOSE_FRUCTOSE_RATIO = '1:0.8';

export function needsMixedCarbSource(rateGPerH: number): boolean {
  return rateGPerH > MIXED_CARB_THRESHOLD_G_PER_H;
}

// ── Leg-by-leg plan ─────────────────────────────────────────────────────────

export type Leg = 'swim' | 'bike' | 'run';

/**
 * The bike is where you fuel: stable position, hands free, food reachable, and
 * far better GI tolerance than running. The run is where distress shows up, so
 * it gets a deliberately lower rate even though the athlete is more depleted.
 */
export const LEG_RATE_FACTOR: Record<Leg, number> = {
  swim: 0,     // nothing practical to take
  bike: 1.05,
  run:  0.75,
};

export interface LegSplit {
  leg: Leg;
  hours: number;
}

export interface LegPlan {
  leg: Leg;
  hours: number;
  carbRateGPerH: number;
  carbG: number;
  fluidL: number;
  sodiumMg: number;
  mixedSourceRequired: boolean;
}

export interface RacePlanInput {
  /** Expected split durations. Swim may be omitted for non-triathlon events. */
  splits: LegSplit[];
  massKg: number;
  /**
   * Highest carbohydrate rate the athlete has actually practised in training,
   * g/h. This is a hard cap — see the module note.
   */
  trainedToleranceGPerH: number;
  /** Measured or estimated, litres per hour. See `sweatRateLPerH`. */
  sweatRateLPerH?: number | null;
  /** Sodium concentration of sweat, mg/L. ~1000 is the population default. */
  sodiumMgPerL?: number | null;
  /** Hot/humid conditions raise sweat rate materially. */
  hot?: boolean;
}

export interface RacePlan {
  totalHours: number;
  baseRateGPerH: number;
  /** What we actually prescribe after capping by trained tolerance. */
  prescribedRateGPerH: number;
  /** True when tolerance is the binding constraint rather than the guideline. */
  limitedByTolerance: boolean;
  legs: LegPlan[];
  totalCarbG: number;
  totalFluidL: number;
  totalSodiumMg: number;
  caffeineMg: { min: number; max: number };
  mixedSourceRequired: boolean;
  notes: string[];
}

/**
 * Replace 60-80% of sweat losses, not 100%. Drinking to full replacement over
 * many hours is how athletes end up hyponatraemic, and the gut cannot absorb
 * that much anyway.
 */
export const FLUID_REPLACEMENT_FRACTION = 0.7;
export const DEFAULT_SWEAT_RATE_L_PER_H = 0.9;
export const DEFAULT_SWEAT_SODIUM_MG_PER_L = 1000;
export const HOT_SWEAT_MULTIPLIER = 1.25;

const isPos = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildRacePlan(input: RacePlanInput): RacePlan {
  const splits = (input?.splits ?? []).filter(s => isPos(s?.hours));
  const totalHours = splits.reduce((sum, s) => sum + s.hours, 0);
  const massKg = isPos(input?.massKg) ? input.massKg : 0;

  const baseRateGPerH = baseCarbRate(totalHours);
  const tolerance = isPos(input?.trainedToleranceGPerH)
    ? input.trainedToleranceGPerH
    : baseRateGPerH;
  const prescribedRateGPerH = Math.min(baseRateGPerH, tolerance);
  const limitedByTolerance = tolerance < baseRateGPerH;

  const sweatBase = isPos(input?.sweatRateLPerH)
    ? input.sweatRateLPerH
    : DEFAULT_SWEAT_RATE_L_PER_H;
  const sweatRate = sweatBase * (input?.hot ? HOT_SWEAT_MULTIPLIER : 1);
  const sodiumConc = isPos(input?.sodiumMgPerL)
    ? input.sodiumMgPerL
    : DEFAULT_SWEAT_SODIUM_MG_PER_L;

  const legs: LegPlan[] = splits.map(s => {
    const rate = Math.round(prescribedRateGPerH * (LEG_RATE_FACTOR[s.leg] ?? 1));
    // No fluid or fuel is realistically taken in the water.
    const drinking = s.leg !== 'swim';
    const fluidL = drinking ? sweatRate * FLUID_REPLACEMENT_FRACTION * s.hours : 0;
    return {
      leg: s.leg,
      hours: r1(s.hours),
      carbRateGPerH: rate,
      carbG: Math.round(rate * s.hours),
      fluidL: r1(fluidL),
      sodiumMg: Math.round(fluidL * sodiumConc),
      mixedSourceRequired: needsMixedCarbSource(rate),
    };
  });

  const notes: string[] = [];
  if (limitedByTolerance) {
    notes.push(
      `Capped at your trained ${Math.round(tolerance)} g/h rather than the ` +
      `${baseRateGPerH} g/h this duration supports. Gut training closes that gap.`
    );
  }
  if (needsMixedCarbSource(prescribedRateGPerH)) {
    notes.push(
      `Above ${MIXED_CARB_THRESHOLD_G_PER_H} g/h you need mixed glucose:fructose ` +
      `(${GLUCOSE_FRUCTOSE_RATIO}). A single-source product will not absorb fast ` +
      `enough and will sit in your gut.`
    );
  }
  if (input?.hot) {
    notes.push('Sweat rate raised 25% for heat — retest in similar conditions if you can.');
  }
  if (!isPos(input?.sweatRateLPerH)) {
    notes.push(
      `Using the ${DEFAULT_SWEAT_RATE_L_PER_H} L/h population default. Do a ` +
      `sweat-rate test — individual rates vary more than any other variable here.`
    );
  }
  if (totalHours >= 3) {
    notes.push('Practise this exact plan on at least two long sessions before race day.');
  }

  return {
    totalHours: r1(totalHours),
    baseRateGPerH,
    prescribedRateGPerH: Math.round(prescribedRateGPerH),
    limitedByTolerance,
    legs,
    totalCarbG: legs.reduce((s, l) => s + l.carbG, 0),
    totalFluidL: r1(legs.reduce((s, l) => s + l.fluidL, 0)),
    totalSodiumMg: legs.reduce((s, l) => s + l.sodiumMg, 0),
    caffeineMg: { min: Math.round(3 * massKg), max: Math.round(6 * massKg) },
    mixedSourceRequired: needsMixedCarbSource(prescribedRateGPerH),
    notes,
  };
}

/** Even splits from a target finish time, when the athlete has no pacing plan yet. */
export const TYPICAL_SPLIT_FRACTIONS: Record<TriDistance, Record<Leg, number>> = {
  sprint:  { swim: 0.14, bike: 0.52, run: 0.34 },
  olympic: { swim: 0.13, bike: 0.52, run: 0.35 },
  half:    { swim: 0.10, bike: 0.53, run: 0.37 },
  full:    { swim: 0.08, bike: 0.53, run: 0.39 },
};

export function estimateSplits(distance: TriDistance, finishHours: number): LegSplit[] {
  const f = TYPICAL_SPLIT_FRACTIONS[distance];
  if (!f || !isPos(finishHours)) return [];
  return (['swim', 'bike', 'run'] as Leg[]).map(leg => ({
    leg, hours: finishHours * f[leg],
  }));
}

// ── Sweat rate ──────────────────────────────────────────────────────────────

export interface SweatTestInput {
  massBeforeKg: number;
  massAfterKg: number;
  /** Litres consumed during the session. */
  fluidDrunkL: number;
  durationMin: number;
}

/**
 * Sweat rate from a weigh-in test: mass lost plus fluid drunk, over time.
 * 1 L of sweat weighs 1 kg, which is what makes this work.
 *
 * Do it nude, immediately before and after, towelled dry. Urine output during
 * the session breaks the assumption, so empty the bladder first.
 */
export function sweatRateLPerH(t: SweatTestInput): number | null {
  if (!isPos(t?.massBeforeKg) || !isPos(t?.massAfterKg) || !isPos(t?.durationMin)) return null;
  const drunk = Number.isFinite(t.fluidDrunkL) && t.fluidDrunkL > 0 ? t.fluidDrunkL : 0;
  const lostKg = t.massBeforeKg - t.massAfterKg;
  const totalSweatL = lostKg + drunk;
  if (!(totalSweatL > 0)) return null;
  const rate = totalSweatL / (t.durationMin / 60);
  // Beyond ~4 L/h is not physiological — almost certainly a data entry error.
  if (rate > 4) return null;
  return r1(rate);
}

// ── Gut training ────────────────────────────────────────────────────────────

export const GUT_RAMP_G_PER_STEP = 10;
export const GUT_WEEKS_PER_STEP = 2.5;

export interface GutTrainingPlan {
  currentGPerH: number;
  targetGPerH: number;
  weeksNeeded: number;
  /** Whether the target is reachable in the time available. */
  achievable: boolean;
  /** The rate that IS reachable by race day. Equals target when achievable. */
  achievableGPerH: number;
  /** One entry per step: the rate to practise, and the week to start it. */
  steps: { week: number; rateGPerH: number }[];
  note: string;
}

/**
 * Gut tolerance is trainable and the ramp is well established: roughly +10 g/h
 * every 2-3 weeks on the long session. Going from 60 to 110 g/h takes about
 * 13 weeks, which is why fuelling practice has to start when the training block
 * does, not in the taper.
 */
export function planGutTraining(
  currentGPerH: number,
  targetGPerH: number,
  weeksAvailable?: number | null
): GutTrainingPlan {
  const current = isPos(currentGPerH) ? currentGPerH : 0;
  const target = isPos(targetGPerH) ? targetGPerH : current;
  const gap = Math.max(0, target - current);
  const stepCount = Math.ceil(gap / GUT_RAMP_G_PER_STEP);
  const weeksNeeded = Math.ceil(stepCount * GUT_WEEKS_PER_STEP);

  const available = isPos(weeksAvailable) ? weeksAvailable : null;
  const achievable = available === null || weeksNeeded <= available;

  const stepsPossible = available === null
    ? stepCount
    : Math.max(0, Math.floor(available / GUT_WEEKS_PER_STEP));
  const achievableGPerH = achievable
    ? target
    : Math.min(target, current + stepsPossible * GUT_RAMP_G_PER_STEP);

  const usableSteps = achievable ? stepCount : stepsPossible;
  const steps = Array.from({ length: usableSteps }, (_, i) => ({
    week: Math.round(i * GUT_WEEKS_PER_STEP) + 1,
    rateGPerH: Math.min(target, current + (i + 1) * GUT_RAMP_G_PER_STEP),
  }));

  let note: string;
  if (gap === 0) {
    note = 'Already fuelling at your target rate. Keep practising it on long sessions.';
  } else if (achievable) {
    note = `About ${weeksNeeded} weeks of practice on your long sessions to go from ` +
           `${Math.round(current)} to ${Math.round(target)} g/h.`;
  } else {
    // `available` is days/7 at the call site, so round it — a raw float here
    // reads as "you have 6.285714285714286 weeks", which it did before this.
    const availableWeeks = Math.floor(available as number);
    note = `${Math.round(target)} g/h needs roughly ${weeksNeeded} weeks and you have ` +
           `${availableWeeks}. Race at ${Math.round(achievableGPerH)} g/h — a rate you ` +
           `have actually trained beats one you have only read about.`;
  }

  return { currentGPerH: current, targetGPerH: target, weeksNeeded, achievable, achievableGPerH, steps, note };
}

// ── Carb loading ────────────────────────────────────────────────────────────

/**
 * Loading is only worth doing for events long enough to actually deplete
 * glycogen. Under ~90 minutes you start with enough on board and loading just
 * adds water weight you then carry around the course.
 */
export function shouldCarbLoad(raceHours: number): boolean {
  return Number.isFinite(raceHours) && raceHours >= 1.5;
}

export function carbLoadGPerKg(raceHours: number): number {
  if (!shouldCarbLoad(raceHours)) return 0;
  return raceHours >= 4 ? 11.5 : 10.5;
}
