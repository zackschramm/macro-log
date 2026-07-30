// Android health data via Health Connect — the Android counterpart to
// useHealthKit. Exposes the SAME shape (RecoveryData / WeeklyTrainingLoad and
// the isAuthorized/requestPermissions/getRecoveryData/... methods) so the
// Recovery screen can consume either one through hooks/useHealth.ts.
//
// Requires the Health Connect app (bundled on Android 14+, a Play install on
// 13 and below) and the react-native-health-connect native module — so every
// call is guarded and degrades to "no data" when unavailable (Expo Go, iOS,
// unsupported device).
import { useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RecoveryData, WeeklyTrainingLoad } from './useHealthKit';
import { STORAGE_LAST_SYNC } from './useHealthKit';
import { logError } from '../utils/logError';

// Optional native module — absent on iOS / Expo Go, so require lazily.
let HC: any = null;
if (Platform.OS === 'android') {
  try { HC = require('react-native-health-connect'); } catch { HC = null; }
}

const isHCAvailable = Platform.OS === 'android' && !!HC;

// The Health Connect record + permission types the Recovery screen needs.
const READ_RECORD_TYPES = [
  'HeartRateVariabilityRmssd', 'RestingHeartRate', 'HeartRate',
  'SleepSession', 'Steps', 'ActiveCaloriesBurned', 'TotalCaloriesBurned',
  'BasalMetabolicRate', 'OxygenSaturation', 'RespiratoryRate',
  'Vo2Max', 'ExerciseSession',
] as const;

let hcInitialized = false;
let moduleAuthorized = false;

const EMPTY: RecoveryData = {
  hrv: null, restingHR: null, sleepHours: null, sleepDeepHours: null,
  sleepRemHours: null, steps: null, activeCalories: null, basalCalories: null,
  bloodOxygen: null, respiratoryRate: null, vo2Max: null,
  hrvTrend: [], rhrTrend: [], sleepTrend: [], stepsTrend: [], sources: {},
};

const HC_SOURCE = 'Health Connect';

async function ensureInit(): Promise<boolean> {
  if (!isHCAvailable) return false;
  if (hcInitialized) return true;
  try {
    // SDK_AVAILABLE = 3 in react-native-health-connect's SdkAvailabilityStatus.
    const status = await HC.getSdkStatus();
    const AVAILABLE = HC.SdkAvailabilityStatus?.SDK_AVAILABLE ?? 3;
    if (status !== AVAILABLE) return false;
    hcInitialized = await HC.initialize();
    return hcInitialized;
  } catch {
    return false;
  }
}

function isoRange(daysBack: number): { operator: 'between'; startTime: string; endTime: string } {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86400000);
  return { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() };
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function readRecords(recordType: string, daysBack: number): Promise<any[]> {
  try {
    const res = await HC.readRecords(recordType, { timeRangeFilter: isoRange(daysBack) });
    return res?.records ?? [];
  } catch {
    return [];
  }
}

// Latest numeric value from a record list, via a picker fn, newest-first.
function latest<T>(records: any[], timeKey: string, pick: (r: any) => number | null): number | null {
  const sorted = [...records].sort((a, b) =>
    new Date(b[timeKey] ?? b.endTime ?? b.time).getTime() - new Date(a[timeKey] ?? a.endTime ?? a.time).getTime());
  for (const r of sorted) {
    const v = pick(r);
    if (v != null && isFinite(v)) return v;
  }
  return null;
}

// Sleep session → total/deep/rem hours from stage list (Health Connect stage
// enum: 5 = DEEP, 6 = REM, 4/2/3 = light/awake/out-of-bed).
function sleepFromSession(s: any): { total: number; deep: number; rem: number } | null {
  if (!s) return null;
  const total = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000;
  let deep = 0, rem = 0;
  for (const st of s.stages ?? []) {
    const h = (new Date(st.endTime).getTime() - new Date(st.startTime).getTime()) / 3600000;
    if (st.stage === 5) deep += h;
    else if (st.stage === 6) rem += h;
  }
  return { total: Math.round(total * 100) / 100, deep: Math.round(deep * 100) / 100, rem: Math.round(rem * 100) / 100 };
}

async function readRecoveryData(): Promise<RecoveryData> {
  if (!(await ensureInit())) return EMPTY;

  const [hrvR, rhrR, sleepR, o2R, respR, vo2R] = await Promise.all([
    readRecords('HeartRateVariabilityRmssd', 7),
    readRecords('RestingHeartRate', 7),
    readRecords('SleepSession', 7),
    readRecords('OxygenSaturation', 2),
    readRecords('RespiratoryRate', 2),
    readRecords('Vo2Max', 30),
  ]);

  // Today's aggregates (steps + active calories).
  let steps: number | null = null, activeCalories: number | null = null, basalCalories: number | null = null;
  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const range = { operator: 'between' as const, startTime: todayStart.toISOString(), endTime: new Date().toISOString() };
    const stepAgg = await HC.aggregateRecord({ recordType: 'Steps', timeRangeFilter: range }).catch(() => null);
    steps = stepAgg?.COUNT_TOTAL ?? null;
    const calAgg = await HC.aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter: range }).catch(() => null);
    activeCalories = calAgg?.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? null;
    const bmrRecs = await readRecords('BasalMetabolicRate', 2);
    basalCalories = latest(bmrRecs, 'time', (r) => r.basalMetabolicRate?.inKilocaloriesPerDay ?? null);
  } catch (e) { logError('useHealthConnect.readRecoveryData', e); }

  // Newest scored sleep session for last night.
  const newestSleep = [...sleepR].sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())[0];
  const sleep = sleepFromSession(newestSleep);

  // Trends (7-day), one value per local day, oldest→newest.
  const dayMap = (records: any[], timeKey: string, pick: (r: any) => number | null) => {
    const byDay: Record<string, number> = {};
    for (const r of records) {
      const v = pick(r);
      if (v == null) continue;
      byDay[localDay(r[timeKey] ?? r.endTime ?? r.time)] = v;
    }
    return Object.entries(byDay).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
  };

  const result: RecoveryData = {
    hrv: latest(hrvR, 'time', (r) => r.heartRateVariabilityMillis ?? null),
    restingHR: latest(rhrR, 'time', (r) => r.beatsPerMinute ?? null),
    sleepHours: sleep?.total ?? null,
    sleepDeepHours: sleep?.deep ?? null,
    sleepRemHours: sleep?.rem ?? null,
    steps,
    activeCalories,
    basalCalories,
    bloodOxygen: latest(o2R, 'time', (r) => r.percentage ?? null),
    respiratoryRate: latest(respR, 'time', (r) => r.rate ?? null),
    vo2Max: latest(vo2R, 'time', (r) => r.vo2MillilitersPerMinuteKilogram ?? null),
    hrvTrend: dayMap(hrvR, 'time', (r) => r.heartRateVariabilityMillis ?? null),
    rhrTrend: dayMap(rhrR, 'time', (r) => r.beatsPerMinute ?? null),
    sleepTrend: sleepR
      .map((s) => ({ date: localDay(s.endTime), value: sleepFromSession(s)?.total ?? 0 }))
      .filter((x) => x.value > 0)
      .sort((a, b) => a.date.localeCompare(b.date)),
    stepsTrend: [],
    sources: { hrv: HC_SOURCE, rhr: HC_SOURCE, sleep: HC_SOURCE, steps: HC_SOURCE },
  };

  AsyncStorage.setItem(STORAGE_LAST_SYNC, String(Date.now())).catch(() => {});
  return result;
}

async function readWeeklyTrainingLoad(): Promise<WeeklyTrainingLoad> {
  const empty: WeeklyTrainingLoad = { totalMinutes: 0, totalCalories: 0, dailyLoad: [] };
  if (!(await ensureInit())) return empty;
  const sessions = await readRecords('ExerciseSession', 7);
  let totalMinutes = 0;
  const byDayMap: Record<string, { minutes: number; calories: number }> = {};
  for (const s of sessions) {
    const mins = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
    totalMinutes += mins;
    const d = localDay(s.startTime);
    if (!byDayMap[d]) byDayMap[d] = { minutes: 0, calories: 0 };
    byDayMap[d].minutes += mins;
  }
  return {
    totalMinutes: Math.round(totalMinutes),
    totalCalories: 0, // Health Connect exercise sessions don't carry calories directly.
    dailyLoad: Object.entries(byDayMap).map(([date, v]) => ({ date, minutes: Math.round(v.minutes), calories: Math.round(v.calories) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function useHealthConnect() {
  const [isAuthorized, setIsAuthorized] = useState(moduleAuthorized);

  const requestPermissions = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!isHCAvailable) return { ok: false, error: 'Health Connect not available' };
    if (!(await ensureInit())) return { ok: false, error: 'Health Connect not installed or unsupported' };
    try {
      const granted = await HC.requestPermission(
        READ_RECORD_TYPES.map((recordType) => ({ accessType: 'read', recordType })),
      );
      const ok = Array.isArray(granted) && granted.length > 0;
      moduleAuthorized = ok;
      setIsAuthorized(ok);
      return ok ? { ok: true } : { ok: false, error: 'Permissions not granted' };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? 'Permission request failed' };
    }
  };

  const probeData = async (): Promise<{ hasData: boolean }> => {
    if (!(await ensureInit())) return { hasData: false };
    for (const t of ['Steps', 'HeartRateVariabilityRmssd', 'SleepSession', 'RestingHeartRate']) {
      if ((await readRecords(t, 7)).length > 0) return { hasData: true };
    }
    return { hasData: false };
  };

  // Android's Health Connect aggregates across all writing apps, so there's no
  // per-source picker like iOS — return empty (the Recovery screen handles it).
  const getAvailableSources = async (): Promise<Record<string, string[]>> => ({});

  // No per-source sync times on Android (Health Connect abstracts sources away).
  const getSourceSyncTimes = async (): Promise<Record<string, number>> => ({});

  return {
    isAuthorized,
    requestPermissions,
    probeData,
    getRecoveryData: (_prefs?: Record<string, string>) => readRecoveryData(),
    getAvailableSources,
    getSourceSyncTimes,
    getWeeklyTrainingLoad: (_prefs?: Record<string, string>) => readWeeklyTrainingLoad(),
  };
}
