/**
 * The device-dependent half of wearable session mapping: the hand-off between
 * a screen (which can call the health hook) and buildCoachContext (which
 * cannot, because it is not a component).
 *
 * All the pure conversion logic lives in `workoutMapping.ts` and is re-exported
 * here so callers only need one import.
 */

import type { Session } from './sessionEnergy';
import { sessionsForDate } from './workoutMapping';
import { logError } from './logError';
import type { RawWorkout } from './workoutMapping';

export {
  toDiscipline, inferZone, workoutToSession, workoutsToSessions, sessionsForDate,
} from './workoutMapping';
export type { RawWorkout } from './workoutMapping';

/**
 * Cache of today's sessions, written by whichever screen last pulled workout
 * history from the health hook.
 *
 * `getWorkoutHistory` lives on the `useHealth()` hook, so it can only be called
 * from inside a component. `buildCoachContext` is a plain async function and
 * cannot use hooks — hence this hand-off rather than a direct call. Screens
 * that already fetch workouts publish here; the coach context reads it.
 *
 * Stale data is worse than none here (yesterday's brick would inflate today's
 * carbohydrate target), so entries are date-stamped and ignored if they aren't
 * for the requested day.
 */
const SESSION_CACHE_KEY = 'fuelog_today_sessions';

export async function publishTodaySessions(
  workouts: RawWorkout[],
  dateStr: string
): Promise<void>{
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const sessions = sessionsForDate(workouts, dateStr);
    await AsyncStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({ date: dateStr, sessions })
    );
  } catch (e) {
    logError('sessionMapping.publishTodaySessions', e);
  }
}

export async function readTodaySessions(dateStr: string): Promise<Session[]>{
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const raw = await AsyncStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Only trust the cache for the day it was written for.
    if (parsed?.date !== dateStr || !Array.isArray(parsed?.sessions)) return [];
    return parsed.sessions as Session[];
  } catch (e) {
    logError('sessionMapping.readTodaySessions', e);
    return [];
  }
}
