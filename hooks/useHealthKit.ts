import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AppleHealthKit, {
  HealthKitPermissions,
  HealthValue,
} from 'react-native-health';

const isHealthAvailable = Platform.OS === 'ios' && AppleHealthKit && typeof AppleHealthKit.isAvailable === 'function';

const PERMISSIONS: HealthKitPermissions = {
  permissions: {
    read: [
      AppleHealthKit.Constants.Permissions.Weight,
      AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
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
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!isHealthAvailable) return;
    AppleHealthKit.isAvailable((err, available) => {
      if (!err && available) setIsAvailable(true);
    });
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
          setIsAuthorized(true);
          resolve({ ok: true });
        });
      } catch (e: any) {
        resolve({ ok: false, error: e?.message || String(e) });
      }
    });
  };

  const saveWeight = (weightLbs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!isAuthorized) return resolve(false);
      AppleHealthKit.saveWeight(
        { value: weightLbs, unit: AppleHealthKit.Constants.Units.pound },
        (err) => resolve(!err)
      );
    });
  };

  const getLatestWeight = (): Promise<number | null> => {
    return new Promise((resolve) => {
      if (!isAuthorized) return resolve(null);
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
      if (!isAuthorized) return resolve(false);
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
      if (!isAuthorized) return resolve(false);
      AppleHealthKit.saveWorkout(
        {
          type: AppleHealthKit.Constants.Activities.TraditionalStrengthTraining,
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
      if (!isAuthorized) return resolve({});
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
      if (!isAuthorized) {
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

        // Active Calories — today
        new Promise<void>((res) => {
          AppleHealthKit.getActiveEnergyBurned(
            { startDate: todayStart.toISOString(), endDate: now.toISOString() },
            (err: any, data: any[]) => {
              if (!err && data?.length > 0) {
                results.activeCalories = Math.round(data.reduce((sum: number, s: any) => sum + s.value, 0));
                results.sources['activeCal'] = data[0].sourceName ?? '';
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

  const getWorkoutHistory = (days: number): Promise<HealthKitWorkout[]> => {
    return new Promise(async (resolve) => {
      if (!isAuthorized) return resolve([]);
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      (AppleHealthKit as any).getSamples(
        { type: 'Workout', startDate: start.toISOString(), endDate: now.toISOString(), ascending: false },
        (err: any, data: any[]) => {
          if (err || !data?.length) return resolve([]);
          const workouts: HealthKitWorkout[] = data.map((w: any) => {
            const startMs = new Date(w.startDate).getTime();
            const endMs = new Date(w.endDate).getTime();
            const durationMin = Math.round((endMs - startMs) / 60000);
            const typeNum = w.workoutActivityType ?? w.activityType ?? 3000;
            return {
              id: w.uuid ?? w.startDate,
              type: typeNum,
              name: WORKOUT_TYPE_NAMES[typeNum] ?? 'Workout',
              startDate: w.startDate,
              endDate: w.endDate,
              duration: durationMin,
              calories: w.totalEnergyBurned != null ? Math.round(w.totalEnergyBurned) : null,
              distance: w.totalDistance != null ? Math.round(w.totalDistance / 100) / 10 : null,
              source: w.sourceName ?? '',
            };
          });
          resolve(workouts);
        }
      );
    });
  };

  const getWeeklyTrainingLoad = (): Promise<WeeklyTrainingLoad> => {
    return new Promise(async (resolve) => {
      if (!isAuthorized) return resolve({ totalMinutes: 0, totalCalories: 0, dailyLoad: [] });
      const workouts = await getWorkoutHistory(7);
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
