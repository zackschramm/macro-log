/**
 * Session energy expenditure and training load. ARCHETYPE-AGNOSTIC.
 *
 * WHY THIS EXISTS
 * A triathlete's requirements swing ~4x between a rest day and a 6-hour brick.
 * The old model described them with one static multiplier
 * (`triathlon: { carbs: 1.4, cal: 1.2 }`), which is a weekly average and is
 * therefore wrong on nearly every individual day — it overfeeds rest days and
 * badly underfeeds long ones. This module computes the day from the day.
 *
 * WHY IT IS NO LONGER CALLED `enduranceEnergy.ts`
 * Wearable-first source priority (power -> device -> distance -> MET), the
 * double-count fix and the NEAT factors are physics and accounting. They do not
 * care what sport produced the session, and every archetype needs them —
 * energy availability in particular is meaningless without a defensible
 * exercise-energy figure. A powerlifter's app importing a file called
 * "endurance" is the kind of smell that causes someone to duplicate it later.
 * `enduranceEnergy.ts` is kept as a re-export shim so existing imports work.
 *
 * DELIBERATELY ZERO RUNTIME IMPORTS so it can be unit-tested without dragging
 * React Native in through the Supabase client. Same rule as `constants/data.ts`
 * and `utils/weightMerge.ts`. Type-only imports are fine (they're erased).
 */

/**
 * Movement families, not sports. Each row is a distinct metabolic shape, so
 * the table stays short — 26 sports do not need 26 rows, they need six.
 */
export type Discipline =
  | 'swim' | 'bike' | 'run' | 'strength'
  | 'court' | 'field' | 'combat' | 'climb' | 'mobility'
  | 'other';

/** Five-zone model. Maps onto HR zones, power zones, or plain RPE. */
export type IntensityZone = 'z1' | 'z2' | 'z3' | 'z4' | 'z5';

export interface Session {
  discipline: Discipline;
  durationMin: number;
  /** Ground distance. Drives run energy; ignored for bike when power exists. */
  distanceKm?: number | null;
  /**
   * Mechanical work from a power meter, in kJ. The single most accurate input
   * in endurance sport — prefer it over everything else for cycling.
   */
  workKJ?: number | null;
  /** Minutes per zone when the device reports them (Whoop, Garmin). Best case. */
  zoneMinutes?: Partial<Record<IntensityZone, number>> | null;
  /** One zone for the whole session, when per-zone data isn't available. */
  zone?: IntensityZone | null;
  /** The device's own kcal figure (HealthKit `calories`). Fallback only. */
  deviceKcal?: number | null;
  elevationGainM?: number | null;
}

// ── Physical constants ──────────────────────────────────────────────────────

/**
 * Running costs ~1 kcal per kg per km and is famously near-independent of pace.
 * 1.03 is the gross figure (net of resting is ~0.9); we subtract resting
 * separately in `sessionNetKcal`, so the gross constant is the correct one here.
 */
export const RUN_KCAL_PER_KG_KM = 1.03;

/**
 * Cycling gross metabolic efficiency. 20-25% is the accepted range; 0.24 is
 * mid-range and has a convenient property — see `bikeEnergyKcal`.
 */
export const GROSS_EFFICIENCY = 0.24;

export const KJ_TO_KCAL = 0.239006;

/** Metabolic cost of lifting bodyweight, per kg per metre climbed, in kcal. */
const CLIMB_KCAL_PER_KG_PER_M = 9.81 / GROSS_EFFICIENCY / 4184; // ≈ 0.00977

/**
 * METs by discipline and zone. Used only when better data is unavailable.
 *
 * Calibrated against the Compendium of Physical Activities for the SPEED RANGE
 * each zone actually corresponds to in `inferZone` (see workoutMapping.ts), not
 * against a vague sense of "moderate". The cycling row was previously 15-50%
 * below the Compendium at every zone — a 70 kg rider doing an hour at 25 kph
 * was costed at 500 kcal against a reference of 735. Cycling is the dominant
 * discipline in triathlon by both time and calories, so that error propagated
 * into every downstream number: daily energy, the calorie target, and (via the
 * squeeze on the remaining budget) the achievable fat intake.
 *
 * Reference points used:
 *   cycling   16-19 kph 6.0 · 19-25.7 kph 8.0 · 25.7-30.6 kph 10.0
 *             30.6-32 kph 12.0 · > 32 kph 15.8
 *   running   8 kph 8.3 · 9.7 kph 9.8 · 11.3 kph 11.0 · 16 kph 14.5
 *   swimming  freestyle slow 5.8 · moderate 8.3 · fast 9.8-10.0
 *
 * The five rows below `strength` were added when the engine generalised past
 * endurance. Before them, a basketball game, a wrestling practice and an hour
 * of hatha yoga were all costed identically through `other` at 5.5 METs, which
 * is roughly double the truth for yoga and well under it for combat. That error
 * lands directly in the energy-availability denominator, so it is a safety
 * number and not only an accuracy one.
 *
 *   court     basketball shooting 4.5 · general 6.5 · game 8.0 · tennis
 *             doubles 6.0 · singles 8.0 · squash 7.3-12.0
 *   field     baseball 5.0 · touch football 8.0 · field hockey 7.8 · soccer
 *             casual 7.0 · competitive 10.0 · rugby competitive 10.0
 *   combat    punching bag 5.5 · wrestling 6.0 · boxing sparring 7.8 · martial
 *             arts vigorous 10.3 · boxing in ring 12.8
 *   climb     rappelling 5.0 · low/moderate difficulty 5.8 · bouldering 7.3 ·
 *             ascending rock 8.0. Capped below court and field at the top end
 *             because climbing is highly intermittent — belays and long rests
 *             sit inside the logged session duration.
 *   mobility  stretching 2.3 · hatha yoga 2.5 · tai chi 3.0 · pilates 3.0 ·
 *             power yoga 4.0
 */
const MET_TABLE: Record<Discipline, Record<IntensityZone, number>> = {
  swim:     { z1: 5.8, z2: 7.0, z3: 8.3, z4: 9.8, z5: 11.0 },
  bike:     { z1: 6.5, z2: 9.0, z3: 11.0, z4: 13.5, z5: 16.0 },
  run:      { z1: 8.3, z2: 9.8, z3: 11.5, z4: 13.0, z5: 14.5 },
  strength: { z1: 3.5, z2: 4.0, z3: 5.0, z4: 6.0, z5: 6.0 },
  court:    { z1: 4.5, z2: 6.0, z3: 7.5, z4: 9.5, z5: 11.0 },
  field:    { z1: 4.5, z2: 6.5, z3: 8.0, z4: 10.0, z5: 12.0 },
  combat:   { z1: 5.0, z2: 7.0, z3: 9.0, z4: 11.0, z5: 12.8 },
  climb:    { z1: 4.0, z2: 5.5, z3: 7.0, z4: 8.0, z5: 9.0 },
  mobility: { z1: 2.3, z2: 2.8, z3: 3.5, z4: 4.0, z5: 5.0 },
  other:    { z1: 4.0, z2: 5.5, z3: 7.0, z4: 8.5, z5: 10.0 },
};

/** Assumed zone when nothing tells us the intensity. Deliberately moderate. */
const DEFAULT_ZONE: IntensityZone = 'z2';

// ── Intensity ───────────────────────────────────────────────────────────────

/**
 * Training-load weight per zone. Sub-threshold work is cheap in glycogen terms
 * relative to its duration; threshold and above is expensive.
 */
export const INTENSITY_WEIGHT: Record<IntensityZone, number> = {
  z1: 0.5, z2: 0.7, z3: 1.0, z4: 1.3, z5: 1.5,
};

const ZONES: IntensityZone[] = ['z1', 'z2', 'z3', 'z4', 'z5'];

const isPos = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Total minutes across a zone breakdown, ignoring junk values. */
function zoneTotal(zm: Partial<Record<IntensityZone, number>>): number {
  return ZONES.reduce((sum, z) => sum + (isPos(zm[z]) ? (zm[z] as number) : 0), 0);
}

/**
 * The session's representative zone — the duration-weighted average of the
 * zone breakdown, or the explicit `zone`, or the default.
 *
 * Returned as a continuous value so a 50/50 z2/z4 session doesn't get rounded
 * to a single bucket and lose the distinction from a steady z3.
 */
export function effectiveIntensityWeight(s: Session): number {
  if (s.zoneMinutes) {
    const total = zoneTotal(s.zoneMinutes);
    if (total > 0) {
      const weighted = ZONES.reduce((sum, z) => {
        const m = isPos(s.zoneMinutes![z]) ? (s.zoneMinutes![z] as number) : 0;
        return sum + m * INTENSITY_WEIGHT[z];
      }, 0);
      return weighted / total;
    }
  }
  return INTENSITY_WEIGHT[s.zone ?? DEFAULT_ZONE];
}

/** Nearest discrete zone, for MET lookup. */
function representativeZone(s: Session): IntensityZone {
  if (s.zone) return s.zone;
  if (s.zoneMinutes) {
    const total = zoneTotal(s.zoneMinutes);
    if (total > 0) {
      const w = effectiveIntensityWeight(s);
      // Pick the zone whose weight is closest to the weighted average.
      return ZONES.reduce((best, z) =>
        Math.abs(INTENSITY_WEIGHT[z] - w) < Math.abs(INTENSITY_WEIGHT[best] - w) ? z : best
      , 'z1' as IntensityZone);
    }
  }
  return DEFAULT_ZONE;
}

// ── Per-discipline energy ───────────────────────────────────────────────────

/**
 * Running: gross cost is distance x bodyweight, plus the vertical work of any
 * climbing. Pace barely matters, which is why there's no speed term.
 */
export function runEnergyKcal(
  massKg: number,
  distanceKm: number,
  elevationGainM?: number | null
): number {
  if (!isPos(massKg) || !isPos(distanceKm)) return 0;
  const flat = RUN_KCAL_PER_KG_KM * massKg * distanceKm;
  const climb = isPos(elevationGainM)
    ? CLIMB_KCAL_PER_KG_PER_M * massKg * elevationGainM
    : 0;
  return flat + climb;
}

/**
 * Cycling from a power meter.
 *
 * Metabolic energy = work / efficiency. Converting to kcal:
 *   workKJ / 0.24 x 0.239 = workKJ x 0.996
 *
 * The unit conversion and the efficiency loss cancel almost exactly, which is
 * why "1 kJ of work ≈ 1 kcal burned" is the standard cycling shortcut. Note
 * there is no bodyweight term — that's the whole point of a power meter.
 */
export function bikeEnergyFromWorkKcal(workKJ: number): number {
  if (!isPos(workKJ)) return 0;
  return (workKJ / GROSS_EFFICIENCY) * KJ_TO_KCAL;
}

/** ACSM: kcal/min = MET x 3.5 x kg / 200. */
export function metEnergyKcal(met: number, massKg: number, minutes: number): number {
  if (!isPos(met) || !isPos(massKg) || !isPos(minutes)) return 0;
  return (met * 3.5 * massKg / 200) * minutes;
}

export type EnergySource = 'power' | 'device' | 'distance' | 'met';

export interface SessionEnergy {
  /** Additional energy beyond simply existing. This is what the day gets. */
  net: number;
  /** Total cost including the resting energy of those minutes. */
  gross: number;
  source: EnergySource;
  /** What the wearable reported, as active kcal. Null when unavailable. */
  deviceKcal: number | null;
  /** Our independent estimate of net, always computed, for comparison. */
  modelNet: number;
  /** device minus model. Positive means the watch read higher than we would. */
  deltaKcal: number | null;
}

/**
 * Our own estimate, ignoring whatever the device claims.
 *
 *   power meter  — measured mechanical work, the gold standard
 *   distance     — the kcal/kg/km relationship for running is very tight
 *   METs         — always available, least accurate
 *
 * Always returned alongside the device figure so the two can be compared rather
 * than one silently replacing the other.
 */
export function modelGrossKcal(s: Session, massKg: number): { kcal: number; source: EnergySource } {
  if (s.discipline === 'bike' && isPos(s.workKJ)) {
    return { kcal: bikeEnergyFromWorkKcal(s.workKJ), source: 'power' };
  }
  if (s.discipline === 'run' && isPos(s.distanceKm)) {
    return { kcal: runEnergyKcal(massKg, s.distanceKm, s.elevationGainM), source: 'distance' };
  }
  const met = MET_TABLE[s.discipline]?.[representativeZone(s)]
    ?? MET_TABLE.other[DEFAULT_ZONE];
  return { kcal: metEnergyKcal(met, massKg, s.durationMin), source: 'met' };
}

/**
 * Session energy from the best available source, computed AFTER the session has
 * completed and the wearable has reported.
 *
 * ── Two things this gets right that the first version did not ───────────────
 *
 * 1. THE DEVICE FIGURE IS ALREADY ACTIVE ENERGY.
 *    `HKWorkout.totalEnergyBurned` — what react-native-health surfaces as
 *    `calories` — is the ACTIVE energy burned during the workout; Apple has
 *    already excluded the resting component. Subtracting BMR from it again
 *    double-corrects. For a 4-hour ride reported at 2,400 kcal that quietly
 *    lost ~290 kcal a day. Device values therefore go straight in as net;
 *    only our own gross estimates get the resting subtraction.
 *
 * 2. THE WEARABLE IS PREFERRED OVER OUR ESTIMATE (below power).
 *    A watch measures heart rate against a personal profile. Our MET table is
 *    a population average. More practically: the athlete can see what their
 *    watch said, and an app that silently disagrees with it loses their trust.
 *    Power still wins where it exists — measured mechanical work beats an
 *    HR-derived inference — but otherwise the device leads and our estimate is
 *    retained as a cross-check.
 */
export function sessionEnergy(s: Session, massKg: number, bmr: number): SessionEnergy {
  const empty: SessionEnergy = {
    net: 0, gross: 0, source: 'met', deviceKcal: null, modelNet: 0, deltaKcal: null,
  };
  if (!isPos(s?.durationMin) || !isPos(massKg)) return empty;

  const resting = isPos(bmr) ? (bmr / 1440) * s.durationMin : 0;
  const model = modelGrossKcal(s, massKg);
  const modelNet = Math.max(0, model.kcal - resting);
  const deviceKcal = isPos(s.deviceKcal) ? s.deviceKcal : null;

  // Power is measured work — it outranks an HR-derived estimate.
  if (model.source === 'power') {
    return {
      net: modelNet, gross: model.kcal, source: 'power',
      deviceKcal, modelNet,
      deltaKcal: deviceKcal === null ? null : Math.round(deviceKcal - modelNet),
    };
  }

  if (deviceKcal !== null) {
    return {
      net: deviceKcal,                 // already active — no resting subtraction
      gross: deviceKcal + resting,
      source: 'device',
      deviceKcal, modelNet,
      deltaKcal: Math.round(deviceKcal - modelNet),
    };
  }

  return {
    net: modelNet, gross: model.kcal, source: model.source,
    deviceKcal: null, modelNet, deltaKcal: null,
  };
}

/** Gross cost of a session. Kept for callers that want the total, not the delta. */
export function sessionGrossKcal(s: Session, massKg: number): number {
  if (!isPos(s?.durationMin) || !isPos(massKg)) return 0;
  return sessionEnergy(s, massKg, 0).gross;
}

/**
 * Net session energy — the part that is *additional* to simply existing.
 *
 * THE MISTAKE THIS AVOIDS
 * You were alive during the workout, and BMR already accounts for those hours.
 * Adding the gross cost of a 5-hour ride on top of a TDEE that already assumed
 * "very active" counts the training twice. For an Ironman athlete in a build
 * block that's an 800-1000 kcal/day overshoot, more than the entire goal
 * adjustment.
 *
 * Callers must pair this with a NEAT-only activity factor (see NEAT_FACTORS),
 * never with the 1.55-1.9 multipliers that already contain exercise.
 */
export function sessionNetKcal(s: Session, massKg: number, bmr: number): number {
  return sessionEnergy(s, massKg, bmr).net;
}

/** Net energy across a day's sessions. */
export function dailyNetKcal(sessions: Session[], massKg: number, bmr: number): number {
  if (!Array.isArray(sessions)) return 0;
  return sessions.reduce((sum, s) => sum + sessionNetKcal(s, massKg, bmr), 0);
}

// ── Training load ───────────────────────────────────────────────────────────

/** Load in "intensity-weighted hours". A 1-hour threshold session ≈ 1.3. */
export function sessionLoad(s: Session): number {
  if (!isPos(s?.durationMin)) return 0;
  return (s.durationMin / 60) * effectiveIntensityWeight(s);
}

export function dailyLoad(sessions: Session[]): number {
  if (!Array.isArray(sessions)) return 0;
  return sessions.reduce((sum, s) => sum + sessionLoad(s), 0);
}

// ── Daily energy target ─────────────────────────────────────────────────────

export type NeatLevel = 'sedentary' | 'standing' | 'manual';

/**
 * Non-exercise activity factors. These describe life *outside* training only.
 *
 * Do not substitute the standard 1.2-1.9 activity multipliers here — those
 * already bake training in, and using one alongside session energy is exactly
 * the double-count this module exists to prevent.
 */
export const NEAT_FACTORS: Record<NeatLevel, number> = {
  sedentary: 1.25,  // desk job, mostly seated outside training
  standing:  1.35,  // on feet a good part of the day
  manual:    1.50,  // manual labour
};

export const DEFAULT_NEAT: NeatLevel = 'sedentary';

export interface DailyEnergyInput {
  bmr: number;
  neat?: NeatLevel | null;
  sessions?: Session[] | null;
  massKg: number;
  /** Goal adjustment in kcal, e.g. -400 to lose. */
  goalAdjustment?: number;
}

export interface DailyEnergy {
  /** BMR x NEAT — the cost of the day before any training. */
  restingComponent: number;
  /** Net additional cost of the day's sessions. */
  exerciseComponent: number;
  /** Maintenance for today: resting + exercise. */
  maintenance: number;
  /** Maintenance plus the goal adjustment. What to actually eat. */
  target: number;
  /** Intensity-weighted training hours, drives the carbohydrate target. */
  load: number;
  /** Which source each session's energy came from, for transparency. */
  sources: EnergySource[];
  /** What the wearables reported in total, net. Null when none did. */
  deviceKcal: number | null;
  /** What we would have estimated without them. */
  modelKcal: number;
  /**
   * device minus model. Null when no device figure exists.
   *
   * Worth surfacing rather than hiding: a large gap usually means either the
   * watch is mis-calibrated or we're missing a discipline's real intensity, and
   * the athlete is the only one who can say which.
   */
  deltaKcal: number | null;
}

export function dailyEnergy(input: DailyEnergyInput): DailyEnergy {
  const bmr = isPos(input?.bmr) ? input.bmr : 0;
  const massKg = isPos(input?.massKg) ? input.massKg : 0;
  const sessions = Array.isArray(input?.sessions) ? input.sessions : [];
  const neatFactor = NEAT_FACTORS[input?.neat ?? DEFAULT_NEAT] ?? NEAT_FACTORS[DEFAULT_NEAT];

  const breakdown = sessions.map(s => sessionEnergy(s, massKg, bmr));
  const restingComponent = bmr * neatFactor;
  const exerciseComponent = breakdown.reduce((sum, b) => sum + b.net, 0);
  const maintenance = restingComponent + exerciseComponent;
  const target = maintenance + (input?.goalAdjustment ?? 0);

  const withDevice = breakdown.filter(b => b.deviceKcal !== null);
  const modelKcal = breakdown.reduce((sum, b) => sum + b.modelNet, 0);
  // Only meaningful when every session reported — a partial sum would compare
  // three sessions' device figures against four sessions' model estimates.
  const deviceKcal = withDevice.length > 0 && withDevice.length === breakdown.length
    ? withDevice.reduce((sum, b) => sum + (b.deviceKcal as number), 0)
    : null;

  return {
    restingComponent: Math.round(restingComponent),
    exerciseComponent: Math.round(exerciseComponent),
    maintenance: Math.round(maintenance),
    target: Math.round(Math.max(0, target)),
    load: dailyLoad(sessions),
    sources: breakdown.map(b => b.source),
    deviceKcal: deviceKcal === null ? null : Math.round(deviceKcal),
    modelKcal: Math.round(modelKcal),
    deltaKcal: deviceKcal === null ? null : Math.round(deviceKcal - modelKcal),
  };
}
