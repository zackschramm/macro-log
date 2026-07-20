import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { callAI } from '../constants/ai';
import { toLocalDateString } from './dateUtils';

const INSIGHT_DATE_KEY = 'fuelog_weekly_insight_date';
const INSIGHT_CACHE_KEY = 'fuelog_weekly_insight_cache';

export function getMondayISODate(from = new Date()): string {
  const d = new Date(from);
  const day = d.getDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDateString(d);
}

export function isToday(dayOfWeek: number): boolean {
  return new Date().getDay() === dayOfWeek;
}

function getLastWeekRange(mondayStr: string): { start: string; end: string } {
  const monday = new Date(mondayStr + 'T12:00:00');
  const lastMonday = new Date(monday);
  lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday);
  lastSunday.setDate(monday.getDate() - 1);
  return {
    start: toLocalDateString(lastMonday),
    end: toLocalDateString(lastSunday),
  };
}

export type WeeklyHealthData = {
  avgHrv?: number;
  weightChangeLbs?: number;
};

export async function generateWeeklyInsight(
  userId: string,
  healthData?: WeeklyHealthData
): Promise<string | null> {
  const thisMonday = getMondayISODate();

  const cachedDate = await AsyncStorage.getItem(INSIGHT_DATE_KEY);
  if (cachedDate === thisMonday) {
    const cached = await AsyncStorage.getItem(INSIGHT_CACHE_KEY);
    if (cached) return cached;
  }

  const { start, end } = getLastWeekRange(thisMonday);

  const [macroResult, workoutResult, profileResult] = await Promise.all([
    supabase
      .from('macro_logs')
      .select('date, calories, protein')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end),
    supabase
      .from('workout_logs')
      .select('date')
      .eq('user_id', userId)
      .eq('done', true)
      .gte('date', start)
      .lte('date', end),
    supabase
      .from('profiles')
      .select('calories')
      .eq('id', userId)
      .single(),
  ]);

  const dayMacros: Record<string, { calories: number; protein: number }> = {};
  (macroResult.data || []).forEach((row: any) => {
    if (!dayMacros[row.date]) dayMacros[row.date] = { calories: 0, protein: 0 };
    dayMacros[row.date].calories += row.calories;
    dayMacros[row.date].protein += row.protein;
  });

  const macrodays = Object.values(dayMacros);
  const loggedDays = macrodays.length;
  const avgCalories = loggedDays
    ? Math.round(macrodays.reduce((a, d) => a + d.calories, 0) / loggedDays)
    : 0;
  const avgProtein = loggedDays
    ? Math.round(macrodays.reduce((a, d) => a + d.protein, 0) / loggedDays)
    : 0;

  const workoutDates = new Set((workoutResult.data || []).map((r: any) => r.date));
  const workoutCount = workoutDates.size;

  const calorieTarget: number = profileResult.data?.calories || 0;
  const daysGoalHit = calorieTarget
    ? macrodays.filter(d => Math.abs(d.calories - calorieTarget) / calorieTarget <= 0.1).length
    : 0;

  if (!loggedDays && workoutCount === 0) return null;

  const parts: string[] = [
    `Logged ${loggedDays} of 7 days`,
    avgCalories ? `avg ${avgCalories} kcal/day` : '',
    avgProtein ? `avg ${avgProtein}g protein/day` : '',
    `${workoutCount} workout day${workoutCount !== 1 ? 's' : ''}`,
    daysGoalHit ? `${daysGoalHit} days within 10% of calorie goal` : '',
    healthData?.avgHrv ? `avg HRV ${healthData.avgHrv}ms` : '',
    healthData?.weightChangeLbs != null
      ? `weight ${healthData.weightChangeLbs >= 0 ? '+' : ''}${healthData.weightChangeLbs.toFixed(1)} lbs over the week`
      : '',
  ].filter(Boolean);

  const system = `You are a concise, encouraging fitness coach. Write a 3–4 sentence weekly summary: acknowledge what went well, then give one specific actionable focus for the coming week. No bullet points, no headers. Keep it warm and direct.`;

  const insight = await callAI(
    [{ role: 'user', content: `My week (${start} to ${end}): ${parts.join(', ')}.` }],
    system,
    300
  );

  if (insight) {
    await AsyncStorage.setItem(INSIGHT_DATE_KEY, thisMonday);
    await AsyncStorage.setItem(INSIGHT_CACHE_KEY, insight);
  }

  return insight || null;
}
