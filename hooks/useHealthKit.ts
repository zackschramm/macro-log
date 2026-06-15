import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AppleHealthKit, {
  HealthKitPermissions,
  HealthValue,
} from 'react-native-health';

const isHealthAvailable = Platform.OS === 'ios' && AppleHealthKit && typeof AppleHealthKit.isAvailable === 'function';

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

export const SOURCE_PREF_KEYS = ['hrv', 'rhr', 'sleep', 'steps', 'activeCal', 'bloodO2', 'respRate', 'vo2', 'workouts'] as const;

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
  bloodOxygen: number | null;   // %, latest
  respiratoryRate: number | null; // breaths/min
  vo2Max: number | null;
  hrvTrend: { date: string; value: number }[];
  rhrTrend: { date: string; value: number }[];
  sleepTrend: { date: string; value: number }[];
  stepsTrend: { date: string; value: number }[];
  sources: Record<string, string>; // metric key → sourceName that provided the value
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
        any((cb) => (AppleHealthKit as any).getDailyStepCountSamples(opts, cb)),
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
          (AppleHealthKit as any).getDailyStepCountSamples(
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
          AppleHealthKit.getActiveEnergyBurned(
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
      ]);

      resolve(out);
    });
  };

  const getRecoveryData = (sourcePrefs: Record<string, string> = {}): Promise<RecoveryData> => {
    const filterBySource = (data: any[], key: string) => {
      const pref = sourcePrefs[key];
      if (!pref || !data?.length) return data ?? [];
      const filtered = data.filter((s: any) => s.sourceName === pref);
      return filtered.length > 0 ? filtered : data;
    };

    return new Promise(async (resolve) => {
      if (!moduleAuthorized) {
        return resolve({
          hrv: null, restingHR: null, sleepHours: null, sleepDeepHours: null,
          sleepRemHours: null, steps: null, activeCalories: null,
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

      const results: RecoveryData = {
        hrv: null, restingHR: null, sleepHours: null, sleepDeepHours: null,
        sleepRemHours: null, steps: null, activeCalories: null,
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
                results.hrv = Math.round(filtered[0].value * 1000); // s → ms
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
                const byDay: Record<string, number> = {};
                filtered.forEach((s: any) => {
                  const day = s.startDate.split('T')[0];
                  const ms = Math.round(s.value * 1000);
                  if (!byDay[day] || ms > byDay[day]) byDay[day] = ms;
                });
                results.hrvTrend = Object.entries(byDay).map(([date, value]) => ({ date, value }));
              }
              res();
            }
          );
        }),

        // Resting Heart Rate — use heart rate samples (works with Whoop/Garmin/Apple Watch)
        // Take the minimum overnight value (10pm–8am) as the resting estimate
        new Promise<void>((res) => {
          (AppleHealthKit as any).getHeartRateSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString(), ascending: false },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'rhr');
              if (!err && filtered?.length > 0) {
                // Overnight samples only (10pm–8am) for resting estimate
                const overnight = filtered.filter((s: any) => {
                  const h = new Date(s.startDate).getHours();
                  return h >= 22 || h < 8;
                });
                const pool = overnight.length > 0 ? overnight : filtered;
                // Take minimum from most recent day available
                const latest = pool.reduce((min: any, s: any) =>
                  (!min || s.value < min.value) ? s : min, null);
                if (latest) {
                  results.restingHR = Math.round(latest.value);
                  results.sources['rhr'] = latest.sourceName ?? '';
                }
                // Trend: min per day across all samples
                const byDay: Record<string, { value: number; source: string }> = {};
                filtered.forEach((s: any) => {
                  const day = s.startDate.split('T')[0];
                  if (!byDay[day] || s.value < byDay[day].value) {
                    byDay[day] = { value: Math.round(s.value), source: s.sourceName ?? '' };
                  }
                });
                results.rhrTrend = Object.entries(byDay).map(([date, d]) => ({ date, value: d.value }));
              }
              res();
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
                  const day = s.startDate.split('T')[0];
                  const start = new Date(s.startDate).getTime();
                  const end = new Date(s.endDate).getTime();
                  const dur = end - start;
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

        // Steps — today
        new Promise<void>((res) => {
          AppleHealthKit.getStepCount(
            { startDate: todayStart.toISOString(), endDate: now.toISOString() },
            (err: any, data: any) => {
              if (!err && data?.value != null) {
                results.steps = Math.round(data.value);
                results.sources['steps'] = data.sourceName ?? '';
              }
              res();
            }
          );
        }),

        // Steps trend — last 7 days
        new Promise<void>((res) => {
          (AppleHealthKit as any).getDailyStepCountSamples(
            { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
              const filtered = filterBySource(data, 'steps');
              if (!err && filtered?.length > 0) {
                results.stepsTrend = filtered.map((s: any) => ({
                  date: s.startDate.split('T')[0],
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
          AppleHealthKit.getActiveEnergyBurned(
            { startDate: todayStart.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
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
          if (err || !data?.length) return resolve([]);
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
        const day = w.startDate.split('T')[0];
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
    getWorkoutHistory,
    getWeeklyTrainingLoad,
  };
}
