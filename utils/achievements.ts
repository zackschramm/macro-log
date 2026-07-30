import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';

const EARNED_KEY = 'fuelog_earned_badges';
const CACHE_KEY = 'fuelog_achievements_cache';
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
}

export interface EarnedBadge {
  id: string;
  earnedAt: string;
}

export interface BadgeStatus {
  badge: BadgeDef;
  earned: boolean;
  earnedAt?: string;
  progressLabel?: string;
}

export const ALL_BADGES: BadgeDef[] = [
  { id: 'first_step',    name: 'First Step',    description: 'Log your first food entry' },
  { id: 'consistent',    name: 'Consistent',    description: 'Achieve a 7-day logging streak' },
  { id: 'on_fire',       name: 'On Fire',       description: 'Achieve a 30-day logging streak' },
  { id: 'legend',        name: 'Legend',        description: 'Achieve a 100-day logging streak' },
  { id: 'iron',          name: 'Iron',          description: 'Log your first workout' },
  { id: 'century',       name: 'Century',       description: 'Log 100 total workout days' },
  { id: 'scanner',       name: 'Scanner',       description: 'Complete your first InBody scan' },
  { id: 'body_recomped', name: 'Body Recomped', description: 'Complete 5 InBody scans' },
  { id: 'lab_rat',       name: 'Lab Rat',       description: 'Complete your first blood work scan' },
  { id: 'pr_machine',    name: 'PR Machine',    description: 'Hit 10 personal records' },
  { id: 'coaches_pet',   name: "Coach's Pet",   description: 'Send 10 AI Coach messages' },
  { id: 'macro_master',  name: 'Macro Master',  description: 'Hit all 4 macro targets within 10% on one day' },
];

interface RawData {
  totalFoodLogs: number;
  streakCount: number;
  totalWorkoutDays: number;
  totalInBodyScans: number;
  totalBloodworkScans: number;
  coachMessageCount: number;
  macroMasterEarned: boolean;
}

async function fetchRawData(
  userId: string,
  profile: { calories: number; protein: number; carbs: number; fat: number },
): Promise<RawData>{
  const [
    foodCountResult,
    workoutResult,
    inBodyCountResult,
    bloodworkCountResult,
    streakRaw,
    coachCountRaw,
    macroLogsResult,
  ] = await Promise.all([
    supabase.from('macro_logs').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('workout_logs').select('date').eq('user_id', userId).eq('done', true),
    supabase.from('inbody_logs').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('bloodwork').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    AsyncStorage.getItem('fuelog_streak_count'),
    AsyncStorage.getItem('fuelog_coach_message_count'),
    supabase.from('macro_logs').select('date, calories, protein, carbs, fat').eq('user_id', userId),
  ]);

  const workoutDates = new Set<string>();
  (workoutResult.data || []).forEach((r: any) => workoutDates.add(r.date));

  let macroMasterEarned = false;
  if (macroLogsResult.data && profile.calories) {
    const byDate: Record<string, { calories: number; protein: number; carbs: number; fat: number }> = {};
    macroLogsResult.data.forEach((row: any) => {
      if (!byDate[row.date]) byDate[row.date] = { calories: 0, protein: 0, carbs: 0, fat: 0 };
      byDate[row.date].calories += row.calories || 0;
      byDate[row.date].protein += row.protein || 0;
      byDate[row.date].carbs += row.carbs || 0;
      byDate[row.date].fat += row.fat || 0;
    });
    const within10 = (val: number, target: number) =>
      target > 0 && Math.abs(val - target) / target <= 0.1;
    macroMasterEarned = Object.values(byDate).some(day =>
      within10(day.calories, profile.calories) &&
      within10(day.protein, profile.protein) &&
      within10(day.carbs, profile.carbs) &&
      within10(day.fat, profile.fat),
    );
  }

  return {
    totalFoodLogs: foodCountResult.count ?? 0,
    streakCount: parseInt(streakRaw || '0', 10),
    totalWorkoutDays: workoutDates.size,
    totalInBodyScans: inBodyCountResult.count ?? 0,
    totalBloodworkScans: bloodworkCountResult.count ?? 0,
    coachMessageCount: parseInt(coachCountRaw || '0', 10),
    macroMasterEarned,
  };
}

function isEarned(id: string, data: RawData): boolean {
  switch (id) {
    case 'first_step':    return data.totalFoodLogs >= 1;
    case 'consistent':    return data.streakCount >= 7;
    case 'on_fire':       return data.streakCount >= 30;
    case 'legend':        return data.streakCount >= 100;
    case 'iron':          return data.totalWorkoutDays >= 1;
    case 'century':       return data.totalWorkoutDays >= 100;
    case 'scanner':       return data.totalInBodyScans >= 1;
    case 'body_recomped': return data.totalInBodyScans >= 5;
    case 'lab_rat':       return data.totalBloodworkScans >= 1;
    case 'pr_machine':    return false; // No personal_records table yet
    case 'coaches_pet':   return data.coachMessageCount >= 10;
    case 'macro_master':  return data.macroMasterEarned;
    default:              return false;
  }
}

function progressLabel(id: string, data: RawData): string | undefined {
  switch (id) {
    case 'consistent':    return `${Math.min(data.streakCount, 7)} / 7 days`;
    case 'on_fire':       return `${Math.min(data.streakCount, 30)} / 30 days`;
    case 'legend':        return `${Math.min(data.streakCount, 100)} / 100 days`;
    case 'century':       return `${Math.min(data.totalWorkoutDays, 100)} / 100 workouts`;
    case 'body_recomped': return `${Math.min(data.totalInBodyScans, 5)} / 5 scans`;
    case 'pr_machine':    return `0 / 10 PRs`;
    case 'coaches_pet':   return `${Math.min(data.coachMessageCount, 10)} / 10 messages`;
    default:              return undefined;
  }
}

interface CheckResult {
  statuses: BadgeStatus[];
  newlyEarned: BadgeDef[];
}

interface CachedResult {
  statuses: BadgeStatus[];
  timestamp: number;
}

export async function invalidateAchievementsCache(): Promise<void>{
  await AsyncStorage.removeItem(CACHE_KEY);
}

export async function checkAchievements(
  userId: string,
  profile: { calories: number; protein: number; carbs: number; fat: number },
  { forceRefresh = false } = {},
): Promise<CheckResult>{
  if (!forceRefresh) {
    const cacheRaw = await AsyncStorage.getItem(CACHE_KEY);
    if (cacheRaw) {
      const cached: CachedResult = JSON.parse(cacheRaw);
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return { statuses: cached.statuses, newlyEarned: [] };
      }
    }
  }

  const prevEarnedRaw = await AsyncStorage.getItem(EARNED_KEY);
  const prevEarned: EarnedBadge[] = prevEarnedRaw ? JSON.parse(prevEarnedRaw) : [];
  const prevEarnedIds = new Set(prevEarned.map(e => e.id));

  const data = await fetchRawData(userId, profile);
  const now = new Date().toISOString();
  const newlyEarned: BadgeDef[] = [];
  const updatedEarned = [...prevEarned];

  const statuses: BadgeStatus[] = ALL_BADGES.map(badge => {
    const earned = isEarned(badge.id, data);
    const wasEarned = prevEarnedIds.has(badge.id);

    if (earned && !wasEarned) {
      updatedEarned.push({ id: badge.id, earnedAt: now });
      newlyEarned.push(badge);
    }

    const entry = updatedEarned.find(e => e.id === badge.id);
    return {
      badge,
      earned: earned || wasEarned,
      earnedAt: entry?.earnedAt,
      progressLabel: earned || wasEarned ? undefined : progressLabel(badge.id, data),
    };
  });

  if (newlyEarned.length > 0) {
    await AsyncStorage.setItem(EARNED_KEY, JSON.stringify(updatedEarned));
  }

  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ statuses, timestamp: Date.now() }));

  return { statuses, newlyEarned };
}
