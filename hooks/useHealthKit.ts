import { useState, useEffect } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { bucketByDayAndSource, SAMPLE_UNITS, type RawSample } from '../utils/healthBuckets';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppleHealthKit, {
  HealthKitPermissions,
  HealthValue,
} from 'react-native-health';
import { toLocalDateString } from '../utils/dateUtils';
import { logError } from '../utils/logError';

const isHealthAvailable = Platform.OS === 'ios' && AppleHealthKit && typeof AppleHealthKit.isAvailable === 'function';

// iOS 27 beta has an ICU/timezone regression that crashes the process natively
// (EXC_BAD_ACCESS in _xzm_xzone_malloc_tiny, inside NSDateFormatter date-string
// formatting) whenever react-native-health runs an HKStatisticsCollectionQuery —
// i.e. getDailyStepCountSamples, getActiveEnergyBurned, getBasalEnergyBurned.
// The crash happens in native code before any JS callback fires, so it cannot be
// caught by a JS try/catch or React error boundary.
//
// These three used to resolve with EMPTY DATA on affected versions. That stopped
// the crash but blanked steps, active energy and basal energy — so the Stats page
// and every TDEE calculation silently showed nothing on iOS 27, and the app was
// untestable for anyone on the beta. They now fall back to `getSamples`, which
// reaches the same data through HKSampleQuery (a different native path that does
// not crash) and is aggregated in JS instead. See `samplesFallback` below.
//
// Bucketing lives in utils/healthBuckets.ts so it can be unit-tested without
// loading react-native-health (which pulls in React Native).
const STATISTICS_COLLECTION_UNSAFE =
  Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 27;

/**
 * iOS 27 fallback — same numbers, different query.
 *
 * Only the native *aggregation* is broken. `getSamples` reaches the same data
 * through `HKSampleQuery` (see RCTAppleHealthKit+Queries.m), which is a
 * different code path and does not crash. So instead of returning nothing on
 * iOS 27, we pull the raw samples and do the bucketing here.
 *
 * Previously these three returned `[]` on iOS 27, which meant no steps, no
 * active energy and no basal energy — i.e. the entire Stats page and every TDEE
 * calculation silently went blank on that OS. That was the right emergency
 * stop; it is not a good permanent answer, and it makes the app untestable for
 * anyone on the beta.
 *
 * Buckets are keyed by (day, source) so all three shapes of caller keep working:
 * ones that just sum, ones that group by `sourceName` to pick a dominant
 * source, and ones that want per-day values for a chart.
 */
/**
 * HealthKit encrypts its store and refuses every query while the device is
 * locked, failing with `Code=6 "Protected health data is inaccessible"`. This
 * also covers the window where the app is running but has not been foregrounded
 * yet — the same lifecycle trap that silently killed the Whoop token exchange.
 *
 * Treating that error as "no data" turns a locked phone into zero steps, which
 * is what a real user saw: the iOS Health app showed a full day of steps while
 * Fuelog showed 0, and the only trace was thirteen Sentry events nobody had a
 * reason to look at.
 */
function isProtectedDataError(err: any): boolean {
  const msg = typeof err === 'string' ? err : (err?.message ?? JSON.stringify(err ?? ''));
  return /Protected health data is inaccessible|Code=6\b/.test(msg);
}

/** Resolve once the app is foregrounded, so HealthKit will actually answer. */
function whenActive(timeoutMs = 10000): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); sub.remove(); resolve(); };
    const timer = setTimeout(finish, timeoutMs);
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') finish();
    });
  });
}

function samplesFallback(
  type: 'ActiveEnergyBurned' | 'BasalEnergyBurned' | 'StepCount',
  opts: any,
  cb: (err: any, data: any[]) => void,
  isRetry = false,
) {
  const { unit, scale } = SAMPLE_UNITS[type] ?? { unit: 'count', scale: 1 };
  try {
    (AppleHealthKit as any).getSamples(
      { ...opts, type, unit },
      (err: any, raw: RawSample[]) => {
        // REPORT, don't just swallow. This path failing silently is precisely
        // why the Stats page went blank on iOS 27 with no crash, no exception
        // and nothing in Sentry — the callback returned [] and every caller
        // treated "no data" as a legitimate answer. Failing soft is still the
        // right behaviour for the UI; being invisible is not.
        if (err) {
          // Locked device: wait for foreground and ask once more rather than
          // reporting zero. Not logged on the first attempt — it is an expected
          // transient state, and logging it drowns out real failures.
          if (isProtectedDataError(err) && !isRetry) {
            whenActive().then(() => samplesFallback(type, opts, cb, true));
            return;
          }
          logError(`useHealthKit.samplesFallback.${type}`, err);
          // A protected-data failure surfaces to the caller instead of
          // masquerading as an empty day: getRecoveryData uses it to mark the
          // read lockedOut so screens keep their last real snapshot instead of
          // caching zeros. Every call site already guards on err (tdee,
          // weeklyBurn, probeData, getRecoveryData, getAvailableSources, absorb).
          return cb(isProtectedDataError(err) ? err : null, []);
        }
        const buckets = bucketByDayAndSource(raw ?? [], scale);
        // An empty result here is itself the symptom worth knowing about: the
        // query succeeded but HealthKit returned nothing for a range the user
        // has data in.
        if (!buckets.length) {
          logError(`useHealthKit.samplesFallback.${type}.empty`,
            new Error(`getSamples returned 0 samples (raw=${Array.isArray(raw) ? raw.length : typeof raw})`));
        }
        cb(null, buckets);
      }
    );
  } catch (e) {
    logError(`useHealthKit.samplesFallback.${type}.threw`, e);
    cb(null, []);
  }
}

function safeGetDailyStepCountSamples(opts: any, cb: (err: any, data: any[]) => void) {
  if (STATISTICS_COLLECTION_UNSAFE) { samplesFallback('StepCount', opts, cb); return; }
  (AppleHealthKit as any).getDailyStepCountSamples(opts, cb);
}
function safeGetActiveEnergyBurned(opts: any, cb: (err: any, data: any[]) => void) {
  if (STATISTICS_COLLECTION_UNSAFE) { samplesFallback('ActiveEnergyBurned', opts, cb); return; }
  AppleHealthKit.getActiveEnergyBurned(opts, cb);
}
function safeGetBasalEnergyBurned(opts: any, cb: (err: any, data: any[]) => void) {
  if (STATISTICS_COLLECTION_UNSAFE) { samplesFallback('BasalEnergyBurned', opts, cb); return; }
  (AppleHealthKit as any).getBasalEnergyBurned(opts, cb);
}

// --- Shared authorization state (M1) ---
// `initHealthKit` only needs to succeed once per app session. Previously each
// screen instantiated useHealthKit() with its own `isAuthorized` flag, so a
// screen that hadn't yet re-run initHealthKit would silently skip reads/writes
// (e.g. ProgressScreen dropping a weight save). We hoist the flag to module
// scope and notify all mounted hook instances when it flips.
let moduleAuthorized = false;
const authListeners = new Set<(v: boolean) => void>();
const setModuleAuthorized = (v: boolean) => {
  moduleAuthorized = v;
  authListeners.forEach((fn) => fn(v));
};

// --- Preferred tracker / source-of-truth (Recovery + Train data discrepancy fix) ---
// AsyncStorage key for the user's global "Preferred fitness tracker" choice
// (Profile screen). Value is '' / 'auto' for Automatic, or a HealthKit
// sourceName (e.g. "Whoop", "Apple Watch") to prefer everywhere unless a
// screen-level/per-metric override (e.g. Recovery's Customize sheet) is set.
export const STORAGE_PREFERRED_TRACKER = 'health_preferred_tracker';
// Per-metric source preferences set in ProfileScreen's "Data Sources" section.
// Layered between global tracker and RecoveryScreen's fine-grained overrides.
export const STORAGE_HK_SOURCES = 'fuelog_healthkit_sources';
// ISO timestamp (ms string) written after each successful getRecoveryData() call.
export const STORAGE_LAST_SYNC = 'fuelog_healthkit_last_sync';

export const SOURCE_PREF_KEYS = ['hrv', 'rhr', 'sleep', 'steps', 'activeCal', 'basalCal', 'bloodO2', 'respRate', 'vo2', 'workouts'] as const;

// Merge the global "preferred tracker" default with per-metric overrides
// (e.g. from Recovery's Customize sheet). Per-metric overrides always win.
export function buildSourcePrefs(
  preferredTracker: string | null | undefined,
  overrides: Record<string, string> = {}
): Record<string, string> {
  const out: Record<string, string> = {};
  if (preferredTracker && preferredTracker !== 'auto') {
    SOURCE_PREF_KEYS.forEach((k) => { out[k] = preferredTracker; });
  }
  Object.entries(overrides).forEach(([k, v]) => {
    if (v) out[k] = v;
    else delete out[k];
  });
  return out;
}

const PERMISSIONS: HealthKitPermissions = {
  permissions: {
    read: [
      AppleHealthKit.Constants.Permissions.Weight,
      AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
      AppleHealthKit.Constants.Permissions.BasalEnergyBurned, // resting energy — for TDEE / "calories needed" (L2)
      AppleHealthKit.Constants.Permissions.Workout,
      AppleHealthKit.Constants.Permissions.HeartRate,
      AppleHealthKit.Constants.Permissions.RestingHeartRate,
      AppleHealthKit.Constants.Permissions.HeartRateVariability,
      AppleHealthKit.Constants.Permissions.StepCount,
      AppleHealthKit.Constants.Permissions.SleepAnalysis,
      AppleHealthKit.Constants.Permissions.OxygenSaturation,
      AppleHealthKit.Constants.Permissions.RespiratoryRate,
      AppleHealthKit.Constants.Permissions.Vo2Max,
    ],
    write: [
      AppleHealthKit.Constants.Permissions.Weight,
      AppleHealthKit.Constants.Permissions.EnergyConsumed,
      AppleHealthKit.Constants.Permissions.Protein,
      AppleHealthKit.Constants.Permissions.Carbohydrates,
      (AppleHealthKit.Constants.Permissions as any).TotalFat,
      AppleHealthKit.Constants.Permissions.Water,
      AppleHealthKit.Constants.Permissions.Workout,
    ] as any,
  },
};

export interface HealthKitWorkout {
  id: string;
  type: number;
  name: string;
  startDate: string;
  endDate: string;
  duration: number;      // minutes
  calories: number | null;
  distance: number | null; // km
  source: string;
}

export interface WeeklyTrainingLoad {
  totalMinutes: number;
  totalCalories: number;
  dailyLoad: { date: string; minutes: number; calories: number }[];
}

const WORKOUT_TYPE_NAMES: Record<number, string> = {
  1: 'Football', 3: 'Australian Football', 4: 'Badminton', 5: 'Baseball',
  6: 'Basketball', 7: 'Bowling', 8: 'Boxing', 9: 'Climbing', 10: 'Cricket',
  11: 'Cross Training', 13: 'Cycling', 16: 'Elliptical', 20: 'Functional Strength',
  24: 'Golf', 25: 'Gymnastics', 28: 'Hiking', 29: 'Hockey', 33: 'Martial Arts',
  34: 'Mind & Body', 35: 'HIIT', 37: 'Running', 38: 'Rugby', 41: 'Skating',
  43: 'Snow Sports', 44: 'Soccer', 46: 'Swimming', 48: 'Tennis',
  49: 'Track & Field', 50: 'Strength Training', 52: 'Yoga', 53: 'Water Sports',
  54: 'Racquetball', 55: 'Squash', 57: 'Wrestling', 58: 'Rowing',
  60: 'Dance', 63: 'Walking', 3000: 'Other',
};

// Map a free-text workout name to the closest HealthKit activity type (L1).
// Falls back to strength training so saved workouts are never mislabeled as
// generic when we can do better.
const activityTypeForName = (name: string): string => {
  const A = AppleHealthKit.Constants.Activities;
  const n = (name || '').toLowerCase();
  if (/(run|jog|sprint)/.test(n)) return A.Running;
  if (/(walk|ruck)/.test(n)) return A.Walking;
  if (/(cycl|bike|spin|ride)/.test(n)) return A.Cycling;
  if (/(swim)/.test(n)) return A.Swimming;
  if (/(row)/.test(n)) return A.Rowing;
  if (/(hiit|interval)/.test(n)) return A.HighIntensityIntervalTraining;
  if (/(yoga)/.test(n)) return A.Yoga;
  if (/(hike|hiking|trail)/.test(n)) return A.Hiking;
  if (/(elliptical)/.test(n)) return A.Elliptical;
  if (/(stair|climb)/.test(n)) return A.StairClimbing;
  if (/(core|abs)/.test(n)) return A.CoreTraining;
  if (/(functional|crossfit|wod)/.test(n)) return A.FunctionalStrengthTraining;
  if (/(cardio|conditioning)/.test(n)) return A.MixedCardio;
  return A.TraditionalStrengthTraining;
};

// Two workout samples logged by different sources (e.g. Whoop's iPhone app
// AND Apple Watch both syncing the same session to Apple Health) that
// overlap significantly in time almost certainly represent the SAME
// real-world workout. Counting both inflates weekly training load /
// calories burned. Keep one per overlapping group, preferring whichever
// has calorie data (and otherwise the longer/first-seen entry).
function dedupeOverlappingWorkouts(workouts: HealthKitWorkout[]): HealthKitWorkout[] {
  const sorted = [...workouts].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  const kept: HealthKitWorkout[] = [];
  for (const w of sorted) {
    const wStart = new Date(w.startDate).getTime();
    const wEnd = new Date(w.endDate).getTime();
    const wDur = Math.max(wEnd - wStart, 1);

    const dupIdx = kept.findIndex((k) => {
      if (k.source === w.source) return false; // same device/app — not a cross-source dup
      const kStart = new Date(k.startDate).getTime();
      const kEnd = new Date(k.endDate).getTime();
      const overlap = Math.max(0, Math.min(wEnd, kEnd) - Math.max(wStart, kStart));
      const kDur = Math.max(kEnd - kStart, 1);
      // Overlapping by more than half of the shorter workout's duration
      return overlap / Math.min(wDur, kDur) > 0.5;
    });

    if (dupIdx === -1) {
      kept.push(w);
    } else if (kept[dupIdx].calories == null && w.calories != null) {
      // Prefer the duplicate that actually has a calorie figure
      kept[dupIdx] = w;
    }
  }
  return kept;
}

export interface RecoveryData {
  hrv: number | null;           // ms, latest overnight
  restingHR: number | null;     // bpm
  sleepHours: number | null;    // hours
  sleepDeepHours: number | null;
  sleepRemHours: number | null;
  steps: number | null;         // today
  activeCalories: number | null;
  basalCalories: number | null; // BMR from single preferred source
  bloodOxygen: number | null;   // %, latest
  respiratoryRate: number | null; // breaths/min
  vo2Max: number | null;
  hrvTrend: { date: string; value: number }[];
  rhrTrend: { date: string; value: number }[];
  sleepTrend: { date: string; value: number }[];
  stepsTrend: { date: string; value: number }[];
  sources: Record<string, string>; // metric key → sourceName that provided the value
  /**
   * True when HealthKit refused reads because the device was locked
   * (Code=6 "Protected health data is inaccessible") — the values in this
   * object are UNKNOWN, not zero. Callers must not render or cache them.
   */
  lockedOut?: boolean;
}

// Standalone functions — callable from utility code outside React components.
// They use the module-scoped `moduleAuthorized` flag which is set once any
// screen has called requestPermissions() via the hook.

export async function getTodayBurn(): Promise<{ bmr: number | null; active: number | null }> {
  if (!isHealthAvailable || !moduleAuthorized) return { bmr: null, active: null };

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [bmr, active] = await Promise.all([
    new Promise<number | null>((resolve) => {
      try {
        safeGetBasalEnergyBurned(
          { startDate: todayStart.toISOString(), endDate: now.toISOString() },
          (err: any, data: any[]) => {
            if (err) { logError('useHealthKit.tdee.basal', err); return resolve(null); }
            if (!data?.length) {
              logError('useHealthKit.tdee.basal.empty', new Error('no basal energy samples today'));
              return resolve(null);
            }
            const total = data.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
            resolve(total > 0 ? Math.round(total) : null);
          }
        );
      } catch (e) { logError('useHealthKit.tdee.basal.threw', e); resolve(null); }
    }),
    new Promise<number | null>((resolve) => {
      try {
        safeGetActiveEnergyBurned(
          { startDate: todayStart.toISOString(), endDate: now.toISOString() },
          (err: any, data: any[]) => {
            if (err) { logError('useHealthKit.tdee.active', err); return resolve(null); }
            if (!data?.length) {
              logError('useHealthKit.tdee.active.empty', new Error('no active energy samples today'));
              return resolve(null);
            }
            const bySource: Record<string, number> = {};
            data.forEach((s: any) => {
              const src = s.sourceName ?? 'unknown';
              bySource[src] = (bySource[src] ?? 0) + (s.value ?? 0);
            });
            const top = Object.values(bySource).reduce((m, v) => Math.max(m, v), 0);
            resolve(top > 0 ? Math.round(top) : null);
          }
        );
      } catch (e) { logError('useHealthKit.tdee.active.threw', e); resolve(null); }
    }),
  ]);

  return { bmr, active };
}

export async function getWeeklyBurnData(): Promise<{ date: string; burned: number }[]> {
  if (!isHealthAvailable || !moduleAuthorized) return [];

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const [bmrSamples, activeSamples] = await Promise.all([
    new Promise<any[]>((resolve) => {
      try {
        safeGetBasalEnergyBurned(
          { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
          (err: any, data: any[]) => resolve(err ? [] : (data ?? []))
        );
      } catch { resolve([]); }
    }),
    new Promise<any[]>((resolve) => {
      try {
        safeGetActiveEnergyBurned(
          { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
          (err: any, data: any[]) => resolve(err ? [] : (data ?? []))
        );
      } catch { resolve([]); }
    }),
  ]);

  const bmrByDay: Record<string, number> = {};
  bmrSamples.forEach((s: any) => {
    const day = s.startDate ? toLocalDateString(new Date(s.startDate)) : '';
    if (day) bmrByDay[day] = (bmrByDay[day] ?? 0) + (s.value ?? 0);
  });

  const activeByDay: Record<string, Record<string, number>> = {};
  activeSamples.forEach((s: any) => {
    const day = s.startDate ? toLocalDateString(new Date(s.startDate)) : '';
    if (!day) return;
    if (!activeByDay[day]) activeByDay[day] = {};
    const src = s.sourceName ?? 'unknown';
    activeByDay[day][src] = (activeByDay[day][src] ?? 0) + (s.value ?? 0);
  });

  const allDays = new Set([...Object.keys(bmrByDay), ...Object.keys(activeByDay)]);
  const result: { date: string; burned: number }[] = [];

  allDays.forEach((day) => {
    const bmr = bmrByDay[day] ?? 0;
    const activeMap = activeByDay[day] ?? {};
    const topActive = Object.values(activeMap).length > 0
      ? Math.max(...Object.values(activeMap)) : 0;
    const total = Math.round(bmr + topActive);
    if (total > 0) result.push({ date: day, burned: total });
  });

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function useHealthKit() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(moduleAuthorized);

  useEffect(() => {
    if (!isHealthAvailable) return;
    AppleHealthKit.isAvailable((err, available) => {
      if (!err && available) setIsAvailable(true);
    });
  }, []);

  // Stay in sync with the shared module flag (M1): once any screen authorizes,
  // every mounted instance sees isAuthorized=true.
  useEffect(() => {
    const fn = (v: boolean) => setIsAuthorized(v);
    authListeners.add(fn);
    setIsAuthorized(moduleAuthorized);
    return () => { authListeners.delete(fn); };
  }, []);

  const requestPermissions = (): Promise<{ ok: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (Platform.OS !== 'ios') return resolve({ ok: false, error: 'Not iOS' });
      try {
        if (!AppleHealthKit || typeof AppleHealthKit.initHealthKit !== 'function') {
          return resolve({ ok: false, error: 'AppleHealthKit module not loaded' });
        }
        AppleHealthKit.initHealthKit(PERMISSIONS, (err) => {
          if (err) { resolve({ ok: false, error: JSON.stringify(err) }); return; }
          setModuleAuthorized(true);
          resolve({ ok: true });
        });
      } catch (e: any) {
        resolve({ ok: false, error: e?.message || String(e) });
      }
    });
  };

  // Read-access probe (H2). initHealthKit reports success even when the user
  // denied READ access (Apple privacy: denied reads are indistinguishable from
  // "no data"). This checks whether ANY core metric has data over the last 30
  // days, so the UI can tell "granted but empty" from a real permission problem.
  const probeData = (): Promise<{ hasData: boolean }> => {
    return new Promise(async (resolve) => {
      if (!moduleAuthorized) return resolve({ hasData: false });
      const now = new Date();
      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);
      const opts = { startDate: monthAgo.toISOString(), endDate: now.toISOString(), limit: 1 };
      const any = (fn: (cb: (e: any, d: any) => void) => void) =>
        new Promise<boolean>((res) => {
          try { fn((err, data) => res(!err && !!data && (Array.isArray(data) ? data.length > 0 : data.value != null))); }
          catch { res(false); }
        });
      const checks = await Promise.all([
        any((cb) => safeGetDailyStepCountSamples(opts, cb)),
        any((cb) => AppleHealthKit.getLatestWeight({ unit: AppleHealthKit.Constants.Units.pound }, cb)),
        any((cb) => AppleHealthKit.getHeartRateVariabilitySamples(opts, cb)),
        any((cb) => (AppleHealthKit as any).getSamples({ type: 'Workout', ...opts }, cb)),
      ]);
      resolve({ hasData: checks.some(Boolean) });
    });
  };

  const saveWeight = (weightLbs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!moduleAuthorized) return resolve(false);
      AppleHealthKit.saveWeight(
        { value: weightLbs, unit: AppleHealthKit.Constants.Units.pound },
        (err) => resolve(!err)
      );
    });
  };

  const getLatestWeight = (): Promise<number | null> => {
    return new Promise((resolve) => {
      if (!moduleAuthorized) return resolve(null);
      AppleHealthKit.getLatestWeight(
        { unit: AppleHealthKit.Constants.Units.pound },
        (err, result: HealthValue) => {
          if (err || !result) return resolve(null);
          resolve(result.value);
        }
      );
    });
  };

  const saveNutrition = (data: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal: string;
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!moduleAuthorized) return resolve(false);
      const now = new Date().toISOString();
      AppleHealthKit.saveFood(
        {
          foodName: data.meal,
          calories: data.calories,
          protein: data.protein,
          carbohydrates: data.carbs,
          totalFat: data.fat,
          startDate: now,
        } as any,
        (err) => resolve(!err)
      );
    });
  };

  const saveWorkout = (data: {
    name: string;
    startDate: Date;
    endDate: Date;
    calories?: number;
  }): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!moduleAuthorized) return resolve(false);
      AppleHealthKit.saveWorkout(
        {
          type: activityTypeForName(data.name),
          startDate: data.startDate.toISOString(),
          endDate: data.endDate.toISOString(),
          energyBurned: data.calories || 0,
          energyBurnedUnit: 'calorie',
        } as any,
        (err) => resolve(!err)
      );
    });
  };

  const getAvailableSources = (): Promise<Record<string, string[]>> => {
    return new Promise(async (resolve) => {
      if (!moduleAuthorized) return resolve({});
      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const out: Record<string, string[]> = {};
      const addSources = (key: string, data: any[]) => {
        const names = [...new Set(data.map((s: any) => s.sourceName).filter(Boolean))] as string[];
        if (names.length > 0) out[key] = names;
      };

      await Promise.allSettled([
        new Promise<void>((res) => {
          AppleHealthKit.getHeartRateVariabilitySamples(
            { startDate: thirtyDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('hrv', data); res(); }
          );
        }),
        new Promise<void>((res) => {
          (AppleHealthKit as any).getHeartRateSamples(
            { startDate: thirtyDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('rhr', data); res(); }
          );
        }),
        new Promise<void>((res) => {
          AppleHealthKit.getSleepSamples(
            { startDate: thirtyDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('sleep', data); res(); }
          );
        }),
        new Promise<void>((res) => {
          safeGetDailyStepCountSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('steps', data); res(); }
          );
        }),
        new Promise<void>((res) => {
          (AppleHealthKit as any).getOxygenSaturationSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('bloodO2', data); res(); }
          );
        }),
        new Promise<void>((res) => {
          (AppleHealthKit as any).getRespiratoryRateSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('respRate', data); res(); }
          );
        }),
        new Promise<void>((res) => {
          (AppleHealthKit as any).getVo2MaxSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('vo2', data); res(); }
          );
        }),
        // Active Energy — look back 7 days so sources are detected even on
        // days the user didn't open the app (M3/scoping follow-up: this key
        // was previously missing, so the Customize sheet never showed source
        // pills for "Active Calories" even though getRecoveryData supports
        // filtering it by source).
        new Promise<void>((res) => {
          safeGetActiveEnergyBurned(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('activeCal', data); res(); }
          );
        }),
        // Workouts — look back 30 days. Lets the Customize sheet (and a
        // future "Preferred fitness tracker" setting) offer a source choice
        // for the Train screen's weekly training load / recent activity.
        new Promise<void>((res) => {
          (AppleHealthKit as any).getSamples(
            { type: 'Workout', startDate: thirtyDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('workouts', data); res(); }
          );
        }),
        // Basal energy — 7 days so sources are detected even on days the user
        // didn't open the app.
        new Promise<void>((res) => {
          safeGetBasalEnergyBurned(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => { if (!err && data?.length) addSources('basalCal', data); res(); }
          );
        }),
      ]);

      resolve(out);
    });
  };

  const getRecoveryData = (sourcePrefs: Record<string, string> = {}): Promise<RecoveryData> => {
    const filterBySource = (data: any[], key: string) => {
      const pref = sourcePrefs[key];
      if (!pref || !data?.length) return data ?? [];
      // Tolerant match: prefs can be stale or generic ("Whoop" vs the real
      // sourceName "WHOOP", "Apple Watch" vs "Zack's Apple Watch"). Exact
      // equality silently matched nothing, fell back to ALL sources, and the
      // newest sample won - which is how an Apple Watch spot-check HRV beat
      // the Whoop overnight value the user explicitly asked for.
      // Match only name-contains-pref: pref "Apple Watch" matches source
      // "Zack's Apple Watch". The reverse direction (pref-contains-name) let
      // an empty sourceName pass every pref and let pref "Zack's Apple Watch"
      // admit any bare "Apple Watch" source. (Review-council finding.)
      const p = pref.toLowerCase();
      const filtered = data.filter((s: any) => {
        const n = String(s.sourceName ?? '').toLowerCase();
        return n !== '' && (n === p || n.includes(p));
      });
      return filtered.length > 0 ? filtered : data;
    };

    return new Promise(async (resolve) => {
      if (!moduleAuthorized) {
        return resolve({
          hrv: null, restingHR: null, sleepHours: null, sleepDeepHours: null,
          sleepRemHours: null, steps: null, activeCalories: null, basalCalories: null,
          bloodOxygen: null, respiratoryRate: null, vo2Max: null,
          hrvTrend: [], rhrTrend: [], sleepTrend: [], stepsTrend: [], sources: {},
        });
      }

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      // 36 hours ago for sleep — catches Whoop/Garmin delayed syncs
      const yesterday = new Date(now);
      yesterday.setHours(yesterday.getHours() - 36);

      // 7 days ago for trend data
      const sevenDaysAgo = new Date(todayStart);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      let sawProtectedError = false;
      const results: RecoveryData = {
        hrv: null, restingHR: null, sleepHours: null, sleepDeepHours: null,
        sleepRemHours: null, steps: null, activeCalories: null, basalCalories: null,
        bloodOxygen: null, respiratoryRate: null, vo2Max: null,
        hrvTrend: [], rhrTrend: [], sleepTrend: [], stepsTrend: [], sources: {},
      };

      await Promise.allSettled([
        // HRV — latest sample from last 24 hours
        new Promise<void>((res) => {
          AppleHealthKit.getHeartRateVariabilitySamples(
            { startDate: yesterday.toISOString(), endDate: now.toISOString(), ascending: false, limit: 20 },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'hrv');
              if (!err && filtered?.length > 0) {
                // Was filtered[0] — one instantaneous SDNN reading. HRV swings
                // widely across a day, so a single sample bore little relation
                // to the daily figure Apple Health shows, and none at all to
                // the trend below, which took the day's MAX. Headline and chart
                // were computed differently and could visibly disagree.
                //
                // Average the most recent day's samples instead: that is the
                // daily statistic Health itself reports, and the trend now uses
                // the same one so the number always sits on its own line.
                const latestDay = toLocalDateString(new Date(filtered[0].startDate));
                const sameDay = filtered.filter(
                  (s: any) => s.startDate && toLocalDateString(new Date(s.startDate)) === latestDay,
                );
                const pool = sameDay.length > 0 ? sameDay : [filtered[0]];
                const mean = pool.reduce((sum: number, s: any) => sum + s.value, 0) / pool.length;
                results.hrv = Math.round(mean * 1000); // s → ms
                results.sources['hrv'] = filtered[0].sourceName ?? '';
              }
              res();
            }
          );
        }),

        // HRV trend — last 7 days
        new Promise<void>((res) => {
          AppleHealthKit.getHeartRateVariabilitySamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString(), ascending: true },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'hrv');
              if (!err && filtered?.length > 0) {
                // Daily MEAN, matching the headline above. This previously took
                // the day's maximum, which is why the big number could sit
                // below its own chart line for the same day.
                const sums: Record<string, { total: number; n: number }> = {};
                filtered.forEach((s: any) => {
                  const day = s.startDate ? toLocalDateString(new Date(s.startDate)) : '';
                  if (!day) return;
                  const bucket = (sums[day] ||= { total: 0, n: 0 });
                  bucket.total += s.value;
                  bucket.n += 1;
                });
                const byDay: Record<string, number> = {};
                Object.entries(sums).forEach(([day, { total, n }]) => {
                  byDay[day] = Math.round((total / n) * 1000);
                });
                // Object.entries preserves insertion order, which here is
                // whatever order HealthKit returned samples in — frequently
                // newest-first. Unsorted, the chart draws right-to-left and the
                // axis reads backwards. sleepTrend below already sorts; this
                // and rhrTrend were missed, so which charts looked wrong varied
                // by day depending on how the samples happened to arrive.
                results.hrvTrend = Object.entries(byDay)
                  .map(([date, value]) => ({ date, value }))
                  .sort((a, b) => a.date.localeCompare(b.date));
              }
              res();
            }
          );
        }),

        /**
         * Resting heart rate.
         *
         * This used to query raw getHeartRateSamples, filter to 22:00-08:00 and
         * take pool.reduce(min) — the single lowest beat across the WHOLE seven
         * day window, despite the comment claiming "most recent day". A real
         * user saw 44 here while Whoop said 54 and Apple said 56, because both
         * of those compute a resting rate from a night's distribution and we
         * were reporting the lowest single reading of the week. It also drifted
         * as the window rolled, for no reason the user could perceive.
         *
         * HealthKit publishes RestingHeartRate as its own type, already
         * computed by Apple, and we have always requested permission for it —
         * it simply was not being read. Use it, and keep the old heuristic only
         * as a fallback for sources that never write that type.
         */
        new Promise<void>((res) => {
          (AppleHealthKit as any).getRestingHeartRateSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString(), ascending: false },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'rhr');
              if (!err && filtered?.length > 0) {
                // ascending: false, so index 0 is the most recent day.
                results.restingHR = Math.round(filtered[0].value);
                results.sources['rhr'] = filtered[0].sourceName ?? '';

                // One value per day. These are already daily figures, so the
                // last one written for a given day is the one to keep.
                const byDay: Record<string, number> = {};
                filtered.forEach((s: any) => {
                  const day = s.startDate ? toLocalDateString(new Date(s.startDate)) : '';
                  if (!day || byDay[day] !== undefined) return;
                  byDay[day] = Math.round(s.value);
                });
                results.rhrTrend = Object.entries(byDay)
                  .map(([date, value]) => ({ date, value }))
                  .sort((a, b) => a.date.localeCompare(b.date));
                res();
                return;
              }

              // Fallback: no RestingHeartRate samples at all. Estimate from
              // overnight raw beats, but per-day rather than across the window,
              // and from a low percentile rather than the outright minimum — a
              // single spurious low beat should not define the number.
              (AppleHealthKit as any).getHeartRateSamples(
                { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString(), ascending: false },
                (err2: any, raw: any[]) => {
                  const rawFiltered = filterBySource(raw, 'rhr');
                  if (!err2 && rawFiltered?.length > 0) {
                    const byDay: Record<string, number[]> = {};
                    rawFiltered.forEach((s: any) => {
                      if (!s.startDate) return;
                      const d = new Date(s.startDate);
                      const h = d.getHours();
                      if (h < 22 && h >= 8) return; // overnight only
                      const day = toLocalDateString(d);
                      (byDay[day] ||= []).push(s.value);
                    });
                    const perDay = Object.entries(byDay).map(([date, values]) => {
                      const sorted = [...values].sort((a, b) => a - b);
                      // 10th percentile: resting, without chasing one outlier.
                      const idx = Math.floor(sorted.length * 0.1);
                      return { date, value: Math.round(sorted[idx] ?? sorted[0]) };
                    }).sort((a, b) => a.date.localeCompare(b.date));

                    if (perDay.length) {
                      results.rhrTrend = perDay;
                      results.restingHR = perDay[perDay.length - 1].value;
                      results.sources['rhr'] = rawFiltered[0].sourceName ?? '';
                    }
                  }
                  res();
                }
              );
            }
          );
        }),

        // Sleep — last night
        new Promise<void>((res) => {
          AppleHealthKit.getSleepSamples(
            { startDate: yesterday.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'sleep');
              if (!err && filtered?.length > 0) {
                let totalMs = 0, deepMs = 0, remMs = 0;
                filtered.forEach((s: any) => {
                  const start = new Date(s.startDate).getTime();
                  const end = new Date(s.endDate).getTime();
                  const dur = end - start;
                  // value: 0=InBed, 1=Asleep, 2=Awake, 3=Core, 4=Deep, 5=REM
                  if (s.value === 1 || s.value === 3) totalMs += dur;
                  if (s.value === 4) { totalMs += dur; deepMs += dur; }
                  if (s.value === 5) { totalMs += dur; remMs += dur; }
                });
                if (totalMs > 0) {
                  results.sleepHours = Math.round(totalMs / 36000) / 100;
                  results.sleepDeepHours = Math.round(deepMs / 36000) / 100;
                  results.sleepRemHours = Math.round(remMs / 36000) / 100;
                  results.sources['sleep'] = filtered[0].sourceName ?? '';
                }
              }
              res();
            }
          );
        }),

        // Sleep trend — last 7 days
        new Promise<void>((res) => {
          AppleHealthKit.getSleepSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'sleep');
              if (!err && filtered?.length > 0) {
                const byDay: Record<string, number> = {};
                filtered.forEach((s: any) => {
                  const day = s.startDate ? toLocalDateString(new Date(s.startDate)) : '';
                  if (!day) return;
                  const start = new Date(s.startDate).getTime();
                  const end = new Date(s.endDate).getTime();
                  const dur = end - start;
                  if (!isFinite(dur)) return;
                  if (s.value === 1 || s.value === 3 || s.value === 4 || s.value === 5) {
                    byDay[day] = (byDay[day] ?? 0) + dur;
                  }
                });
                results.sleepTrend = Object.entries(byDay)
                  .map(([date, ms]) => ({ date, value: Math.round(ms / 36000) / 100 }))
                  .sort((a, b) => a.date.localeCompare(b.date));
              }
              res();
            }
          );
        }),

        // Steps — today, filtered by preferred source.
        // getStepCount() returns an aggregated total that merges all sources (Apple
        // Watch + iPhone + Garmin), which inflates the count when multiple devices
        // are worn simultaneously. getDailyStepCountSamples() returns per-source
        // entries so we can apply the same filterBySource logic used elsewhere.
        new Promise<void>((res) => {
          safeGetDailyStepCountSamples(
            { startDate: todayStart.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
              if (err && isProtectedDataError(err)) sawProtectedError = true;
              const filtered = filterBySource(data, 'steps');
              if (!err && filtered?.length > 0) {
                // Sum all entries for the preferred source (may have multiple segments)
                const total = filtered.reduce((s: number, d: any) => s + (d.value ?? 0), 0);
                results.steps = Math.round(total);
                results.sources['steps'] = filtered[0].sourceName ?? '';
              }
              res();
            }
          );
        }),

        // Steps trend — last 7 days
        new Promise<void>((res) => {
          safeGetDailyStepCountSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
              if (err && isProtectedDataError(err)) sawProtectedError = true;
              const filtered = filterBySource(data, 'steps');
              if (!err && filtered?.length > 0) {
                results.stepsTrend = filtered
                  .filter((s: any) => !!s.startDate)
                  .map((s: any) => ({
                    date: toLocalDateString(new Date(s.startDate)),
                    value: Math.round(s.value),
                  }));
              }
              res();
            }
          );
        }),

        // Active Calories — today.
        // Sum PER SOURCE and keep the largest total rather than summing across
        // all sources (M3): Apple Watch + iPhone + Whoop each write active
        // energy, so a naive sum double-counts and inflates today's burn.
        // Respects an explicit source preference if the user set one.
        new Promise<void>((res) => {
          safeGetActiveEnergyBurned(
            { startDate: todayStart.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
              if (err && isProtectedDataError(err)) sawProtectedError = true;
              const filtered = filterBySource(data, 'activeCal');
              if (!err && filtered?.length > 0) {
                const bySource: Record<string, number> = {};
                filtered.forEach((s: any) => {
                  const src = s.sourceName ?? 'unknown';
                  bySource[src] = (bySource[src] ?? 0) + (s.value ?? 0);
                });
                const [topSource, topTotal] = Object.entries(bySource)
                  .reduce((max, cur) => (cur[1] > max[1] ? cur : max), ['', 0] as [string, number]);
                results.activeCalories = Math.round(topTotal);
                results.sources['activeCal'] = topSource;
              }
              res();
            }
          );
        }),

        // Blood Oxygen — latest
        new Promise<void>((res) => {
          (AppleHealthKit as any).getOxygenSaturationSamples(
            { startDate: yesterday.toISOString(), endDate: now.toISOString(), ascending: false, limit: 20 },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'bloodO2');
              if (!err && filtered?.length > 0) {
                results.bloodOxygen = Math.round(filtered[0].value * 100);
                results.sources['bloodO2'] = filtered[0].sourceName ?? '';
              }
              res();
            }
          );
        }),

        // Respiratory Rate — latest
        new Promise<void>((res) => {
          (AppleHealthKit as any).getRespiratoryRateSamples(
            { startDate: yesterday.toISOString(), endDate: now.toISOString(), ascending: false, limit: 20 },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'respRate');
              if (!err && filtered?.length > 0) {
                results.respiratoryRate = Math.round(filtered[0].value);
                results.sources['respRate'] = filtered[0].sourceName ?? '';
              }
              res();
            }
          );
        }),

        // Basal Energy (BMR) — today, single preferred source.
        // Always pull from one source only: Apple estimates BMR from body metrics
        // and Whoop/Garmin each compute it independently. Summing them double-counts.
        new Promise<void>((res) => {
          safeGetBasalEnergyBurned(
            { startDate: todayStart.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
              if (err && isProtectedDataError(err)) sawProtectedError = true;
              const filtered = filterBySource(data, 'basalCal');
              if (!err && filtered?.length > 0) {
                const bySource: Record<string, number> = {};
                filtered.forEach((s: any) => {
                  const src = s.sourceName ?? 'unknown';
                  bySource[src] = (bySource[src] ?? 0) + (s.value ?? 0);
                });
                const [topSource, topTotal] = Object.entries(bySource)
                  .reduce((max, cur) => (cur[1] > max[1] ? cur : max), ['', 0] as [string, number]);
                results.basalCalories = Math.round(topTotal);
                results.sources['basalCal'] = topSource;
              }
              res();
            }
          );
        }),

        // VO2 Max — latest
        new Promise<void>((res) => {
          (AppleHealthKit as any).getVo2MaxSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString(), ascending: false, limit: 20 },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'vo2');
              if (!err && filtered?.length > 0) {
                results.vo2Max = Math.round(filtered[0].value * 10) / 10;
                results.sources['vo2'] = filtered[0].sourceName ?? '';
              }
              res();
            }
          );
        }),
      ]);

      if (sawProtectedError) {
        // Device was locked for at least one query: the nulls in this result
        // mean "couldn't look", not "nothing there". Don't stamp a sync time
        // for a read that never happened.
        results.lockedOut = true;
      } else {
        AsyncStorage.setItem(STORAGE_LAST_SYNC, Date.now().toString());
      }
      resolve(results);
    });
  };

  // `sourcePrefs['workouts']`, if set, restricts results to a single
  // HealthKit source (e.g. "Whoop" or "Apple Watch") — falls back to all
  // sources if that source has no workouts in range. Regardless of the
  // filter, overlapping cross-source duplicates (Whoop + Apple Watch both
  // syncing the same session) are collapsed via dedupeOverlappingWorkouts so
  // weekly totals aren't doubled.
  const getWorkoutHistory = (days: number, sourcePrefs: Record<string, string> = {}): Promise<HealthKitWorkout[]> => {
    return new Promise(async (resolve) => {
      if (!moduleAuthorized) return resolve([]);
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      // react-native-health's Workout samples expose: start, end, calories
      // (kcal), activityId (number), activityName (string), distance (MILES),
      // sourceName, id. The previous code read HealthKit-native names
      // (startDate/endDate/totalEnergyBurned/totalDistance/workoutActivityType/
      // uuid) which are all undefined here — producing NaN durations, null
      // calories and "Other" for every workout (M2).
      const MILES_TO_KM = 1.60934;
      (AppleHealthKit as any).getSamples(
        { type: 'Workout', startDate: start.toISOString(), endDate: now.toISOString(), ascending: false },
        (err: any, data: any[]) => {
          // Same rule as samplesFallback: fail soft for the UI, but never fail
          // silently. `fetchSamplesOfType` builds each workout into an
          // NSDictionary literal and wraps it in @try/@catch — so a single nil
          // field (productType, metadata) throws, gets NSLogged, and that
          // workout vanishes with no error and no gap in the array. A source
          // that writes one nil field disappears entirely and looks to us
          // exactly like "the user didn't train". See patches/.
          if (err) {
            logError('useHealthKit.getWorkoutHistory', err);
            return resolve([]);
          }
          if (!data?.length) {
            logError('useHealthKit.getWorkoutHistory.empty',
              new Error(`0 workouts over ${days}d (raw=${Array.isArray(data) ? data.length : typeof data})`));
            return resolve([]);
          }
          let workouts: HealthKitWorkout[] = data.map((w: any) => {
            const startDate = w.start ?? w.startDate;
            const endDate = w.end ?? w.endDate;
            const startMs = new Date(startDate).getTime();
            const endMs = new Date(endDate).getTime();
            const durationMin = (isFinite(startMs) && isFinite(endMs))
              ? Math.round((endMs - startMs) / 60000) : 0;
            const typeNum = w.activityId ?? 3000;
            const name = w.activityName || WORKOUT_TYPE_NAMES[typeNum] || 'Workout';
            const miles = w.distance;
            return {
              id: w.id ?? startDate,
              type: typeNum,
              name,
              startDate,
              endDate,
              duration: durationMin,
              calories: (w.calories != null && w.calories > 0) ? Math.round(w.calories) : null,
              distance: (miles != null && miles > 0) ? Math.round(miles * MILES_TO_KM * 10) / 10 : null,
              source: w.sourceName ?? '',
            };
          });

          const pref = sourcePrefs['workouts'];
          if (pref) {
            const filtered = workouts.filter((w) => w.source === pref);
            if (filtered.length > 0) workouts = filtered;
          }

          resolve(dedupeOverlappingWorkouts(workouts));
        }
      );
    });
  };

  const getWeeklyTrainingLoad = (sourcePrefs: Record<string, string> = {}): Promise<WeeklyTrainingLoad> => {
    return new Promise(async (resolve) => {
      if (!moduleAuthorized) return resolve({ totalMinutes: 0, totalCalories: 0, dailyLoad: [] });
      const workouts = await getWorkoutHistory(7, sourcePrefs);
      const byDay: Record<string, { minutes: number; calories: number }> = {};
      workouts.forEach(w => {
        const day = w.startDate ? toLocalDateString(new Date(w.startDate)) : '';
        if (!day) return;
        if (!byDay[day]) byDay[day] = { minutes: 0, calories: 0 };
        byDay[day].minutes += w.duration;
        byDay[day].calories += w.calories ?? 0;
      });
      const dailyLoad = Object.entries(byDay)
        .map(([date, d]) => ({ date, minutes: d.minutes, calories: d.calories }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const totalMinutes = dailyLoad.reduce((s, d) => s + d.minutes, 0);
      const totalCalories = dailyLoad.reduce((s, d) => s + d.calories, 0);
      resolve({ totalMinutes, totalCalories, dailyLoad });
    });
  };

  // Returns the most recent sample timestamp (ms) per HealthKit source name
  // across all metrics — used by ProfileScreen to show "last synced X min ago".
  const getSourceSyncTimes = (): Promise<Record<string, number>> => {
    return new Promise(async (resolve) => {
      if (!moduleAuthorized) return resolve({});
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const opts = { startDate: thirtyDaysAgo.toISOString(), endDate: now.toISOString() };

      const syncTimes: Record<string, number> = {};
      const absorb = (samples: any[]) => {
        (samples ?? []).forEach((s: any) => {
          if (!s.sourceName) return;
          const ts = new Date(s.startDate ?? s.start ?? '').getTime();
          if (!isNaN(ts) && (!syncTimes[s.sourceName] || ts > syncTimes[s.sourceName])) {
            syncTimes[s.sourceName] = ts;
          }
        });
      };

      await Promise.allSettled([
        new Promise<void>((res) => {
          AppleHealthKit.getHeartRateVariabilitySamples(opts, (e: any, d: any[]) => { absorb(d); res(); });
        }),
        new Promise<void>((res) => {
          (AppleHealthKit as any).getHeartRateSamples(opts, (e: any, d: any[]) => { absorb(d); res(); });
        }),
        new Promise<void>((res) => {
          AppleHealthKit.getSleepSamples(opts, (e: any, d: any[]) => { absorb(d); res(); });
        }),
        new Promise<void>((res) => {
          safeGetDailyStepCountSamples(opts, (e: any, d: any[]) => { absorb(d); res(); });
        }),
        new Promise<void>((res) => {
          safeGetActiveEnergyBurned(opts, (e: any, d: any[]) => { absorb(d); res(); });
        }),
        new Promise<void>((res) => {
          (AppleHealthKit as any).getSamples(
            { type: 'Workout', ...opts },
            (e: any, d: any[]) => { absorb(d); res(); }
          );
        }),
      ]);

      resolve(syncTimes);
    });
  };

  // Register HealthKit observer queries for data types the react-native-health
  // library supports. Calls onNewData immediately after observers are set up so
  // the caller can kick off an initial data fetch; subsequent live updates rely
  // on the 30-second polling + AppState foreground refresh in the caller since
  // react-native-health's setObserver does not expose a per-sample JS callback.
  // Full background delivery requires the HealthKit background delivery
  // entitlement in Xcode and is handled at the native layer.
  // HRV, sleep, and steps observers are not available via this API.
  const registerObservers = (onNewData: () => void): void => {
    if (!moduleAuthorized || Platform.OS !== 'ios') return;
    const types = ['Workout', 'HeartRate', 'RestingHeartRate'];
    types.forEach((type) => {
      try { (AppleHealthKit as any).setObserver({ type }); } catch (e) { logError('useHealthKit.registerObservers', e); }
    });
    // Trigger an immediate refresh so the caller's data is current after setup.
    onNewData();
  };

  return {
    isAvailable,
    isAuthorized,
    requestPermissions,
    probeData,
    saveWeight,
    getLatestWeight,
    saveNutrition,
    saveWorkout,
    getRecoveryData,
    getAvailableSources,
    getSourceSyncTimes,
    registerObservers,
    getWorkoutHistory,
    getWeeklyTrainingLoad,
  };
}
