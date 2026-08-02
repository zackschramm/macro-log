/**
 * Bridge from whatever the wearables give us to the engine's `Session` shape.
 *
 * WHAT'S ACTUALLY AVAILABLE (audited 2026-07-30)
 *   HealthKit  duration, distance (km), calories, activity type. NO power.
 *   Whoop      strain/recovery/sleep only — the proxy does not expose
 *              /v1/activity/workout yet, which is a shame because Whoop
 *              returns per-zone durations, the single best intensity input.
 *   Garmin     body battery, dailies, sleep. No activities at all.
 *
 * So today everything routes through HealthKit and cycling falls back to METs
 * or Apple's own kcal figure. `Session.workKJ` exists and is preferred wherever
 * it appears, so the day a power source is wired in, accuracy improves with no
 * change to the fuelling maths.
 *
 * ZERO RUNTIME IMPORTS. `sessionMapping.ts` re-exports all of this and adds
 * the AsyncStorage hand-off; that half needs a device and cannot be unit
 * tested, so it lives separately. Importing `logError` here would drag in
 * expo-constants ->react-native and break the test runner on Flow syntax.
 */

import type { Session, Discipline, IntensityZone } from './sessionEnergy';

/**
 * HealthKit activity type numbers ->our disciplines.
 * See WORKOUT_TYPE_NAMES in hooks/useHealthKit.ts for the full table.
 *
 * The court/field/combat/climb/mobility rows landed when the engine
 * generalised past endurance. Before them every one of these fell through to
 * `other` at 5.5 METs for a moderate session, which is roughly double the
 * truth for yoga and well under it for combat. That figure feeds the
 * energy-availability denominator, so it is a safety number as well as an
 * accuracy one.
 */
const HK_TYPE_TO_DISCIPLINE: Record<number, Discipline> = {
  13: 'bike',      // Cycling
  37: 'run',       // Running
  46: 'swim',      // Swimming
  53: 'swim',      // Water Sports
  63: 'run',       // Walking — costed as running, distance dominates anyway
  28: 'run',       // Hiking
  58: 'other',     // Rowing
  50: 'strength',  // Strength Training
  20: 'strength',  // Functional Strength
  35: 'other',     // HIIT
  16: 'other',     // Elliptical
  11: 'other',     // Cross Training
  6:  'court',     // Basketball
  48: 'court',     // Tennis
  4:  'court',     // Badminton
  54: 'court',     // Racquetball
  55: 'court',     // Squash
  1:  'field',     // Football
  3:  'field',     // Australian Football
  5:  'field',     // Baseball
  10: 'field',     // Cricket
  29: 'field',     // Hockey
  38: 'field',     // Rugby
  44: 'field',     // Soccer
  8:  'combat',    // Boxing
  33: 'combat',    // Martial Arts
  57: 'combat',    // Wrestling
  9:  'climb',     // Climbing
  34: 'mobility',  // Mind & Body
  52: 'mobility',  // Yoga
};

/**
 * Fallback for sources that give a name but a useless type number.
 *
 * Deliberately NOT extended to the team-sport disciplines. This list only fires
 * when the activity type is unrecognised, and team-sport words are far too
 * ambiguous at that point — "Underwater Hockey" is not field hockey and "Foot
 * Golf" is not golf. A wrong discipline is worse than `other`, which at least
 * defers to whatever kcal figure the device reported.
 */
const NAME_TO_DISCIPLINE: [RegExp, Discipline][] = [
  [/cycl|bike|spin|peloton|zwift/i, 'bike'],
  [/run|jog|treadmill/i, 'run'],
  [/swim/i, 'swim'],
  [/lift|strength|weight|gym/i, 'strength'],
];

export function toDiscipline(typeNum: number, name?: string): Discipline {
  const byType = HK_TYPE_TO_DISCIPLINE[typeNum];
  if (byType) return byType;
  if (name) {
    for (const [re, d] of NAME_TO_DISCIPLINE) if (re.test(name)) return d;
  }
  return 'other';
}

/**
 * Infer intensity from pace when we can, since HealthKit gives us no zones.
 *
 * Deliberately conservative — guessing z5 off a fast split would inflate both
 * the training load and the carbohydrate target. Unknown resolves to z2, which
 * is where most endurance training actually lives.
 */
export function inferZone(
  discipline: Discipline,
  durationMin: number,
  distanceKm?: number | null
): IntensityZone {
  if (!distanceKm || !durationMin || distanceKm <= 0 || durationMin <= 0) return 'z2';
  const kph = distanceKm / (durationMin / 60);

  if (discipline === 'run') {
    if (kph >= 16) return 'z5';   // sub-3:45/km
    if (kph >= 14) return 'z4';
    if (kph >= 12) return 'z3';
    if (kph >= 9) return 'z2';
    return 'z1';
  }
  if (discipline === 'bike') {
    if (kph >= 38) return 'z5';
    if (kph >= 33) return 'z4';
    if (kph >= 28) return 'z3';
    if (kph >= 22) return 'z2';
    return 'z1';
  }
  if (discipline === 'swim') {
    if (kph >= 4.5) return 'z4';  // ~1:20/100m
    if (kph >= 3.5) return 'z3';
    if (kph >= 2.5) return 'z2';
    return 'z1';
  }
  return 'z2';
}

export interface RawWorkout {
  type: number;
  name?: string;
  duration: number;            // minutes
  distance?: number | null;    // km
  calories?: number | null;
  startDate?: string;
}

export function workoutToSession(w: RawWorkout): Session | null {
  if (!w || !Number.isFinite(w.duration) || w.duration <= 0) return null;
  const discipline = toDiscipline(w.type, w.name);
  const distanceKm = Number.isFinite(w.distance as number) && (w.distance as number) > 0
    ? (w.distance as number) : null;
  return {
    discipline,
    durationMin: w.duration,
    distanceKm,
    zone: inferZone(discipline, w.duration, distanceKm),
    deviceKcal: Number.isFinite(w.calories as number) && (w.calories as number) > 0
      ? (w.calories as number) : null,
  };
}

export function workoutsToSessions(workouts: RawWorkout[]): Session[] {
  if (!Array.isArray(workouts)) return [];
  return workouts.map(workoutToSession).filter((s): s is Session => s !== null);
}

/** Keep only the workouts that started on the given local date (YYYY-MM-DD). */
export function sessionsForDate(workouts: RawWorkout[], dateStr: string): Session[] {
  if (!Array.isArray(workouts)) return [];
  return workoutsToSessions(
    workouts.filter(w => (w.startDate ?? '').slice(0, 10) === dateStr)
  );
}
