import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { getTodayBurn, getWeeklyBurnData } from '../hooks/useHealthKit';
import { toLocalDateString } from './dateUtils';

const GOAL_ADJUSTMENTS: Record<string, number> = {
  lose: -400,
  gain: 250,
  maintain: 0,
};

export type UserGoal = 'lose_fat' | 'build_muscle' | 'maintain';

export interface TDEEResult {
  bmr: number | null;           // basal calories burned so far today
  active: number | null;        // active calories burned so far today
  tdee: number | null;          // total burned so far today (bmr + active)
  projectedTdee: number | null; // full-day projection: full-day BMR + active so far
  goalCalories: number | null;  // projectedTdee + goal adjustment
  surplus: number | null;       // goalCalories - caloriesLogged (positive = need to eat more)
  caloriesLogged: number;
  goal: UserGoal;
}

// Mifflin-St Jeor full-day BMR from profile stats; null if stats are incomplete
function mifflinBmr(p: {
  weight_lbs?: number | null; height_in?: number | null;
  age?: number | null; sex?: string | null;
} | null | undefined): number | null {
  if (!p?.weight_lbs || !p?.height_in || !p?.age) return null;
  const kg = p.weight_lbs * 0.453592;
  const cm = p.height_in * 2.54;
  return Math.round(
    p.sex === 'female'
      ? 10 * kg + 6.25 * cm - 5 * p.age - 161
      : 10 * kg + 6.25 * cm - 5 * p.age + 5
  );
}

export async function getTodayTDEE(userId: string): Promise<TDEEResult> {
  const today = toLocalDateString();

  const [burnData, goalRaw, profileResult, logsResult] = await Promise.all([
    getTodayBurn(),
    AsyncStorage.getItem('fuelog_onboarding_goal'),
    supabase.from('profiles').select('goal, weight_lbs, height_in, age, sex').eq('id', userId).single(),
    supabase.from('macro_logs').select('calories').eq('user_id', userId).eq('date', today),
  ]);

  const profile = profileResult.data;
  const rawGoal = goalRaw ?? profile?.goal ?? 'maintain';
  const adjustment = GOAL_ADJUSTMENTS[rawGoal] ?? 0;
  const goal: UserGoal =
    rawGoal === 'lose' ? 'lose_fat' : rawGoal === 'gain' ? 'build_muscle' : 'maintain';

  const caloriesLogged = Math.round(
    (logsResult.data ?? []).reduce((sum: number, r: any) => sum + (r.calories ?? 0), 0)
  );

  const { bmr, active } = burnData;
  const estimatedBmr = mifflinBmr(profile);

  // Require at least one real burn signal from HealthKit — a pure formula
  // estimate adds nothing over the static profile target
  if (bmr === null && active === null) {
    return {
      bmr: null, active: null, tdee: null, projectedTdee: null,
      goalCalories: null, surplus: null, caloriesLogged, goal,
    };
  }

  const now = new Date();
  const dayFraction = (now.getHours() * 60 + now.getMinutes()) / 1440;

  // Full-day BMR: extrapolate HealthKit's basal-so-far once enough of the day
  // has elapsed for the rate to be stable; otherwise use the profile estimate
  let fullDayBmr: number | null = null;
  if (bmr !== null && dayFraction >= 0.25) fullDayBmr = Math.round(bmr / dayFraction);
  else if (estimatedBmr !== null) fullDayBmr = estimatedBmr;
  else if (bmr !== null && dayFraction > 0.05) fullDayBmr = Math.round(bmr / dayFraction);

  // Basal burned so far: HealthKit value, or the estimate scaled to time of day
  const basalSoFar =
    bmr ?? (estimatedBmr !== null ? Math.round(estimatedBmr * dayFraction) : null);

  const tdee = basalSoFar !== null ? Math.round(basalSoFar + (active ?? 0)) : null;
  const projectedTdee =
    fullDayBmr !== null ? Math.round(fullDayBmr + (active ?? 0)) : null;
  const goalCalories =
    projectedTdee !== null ? Math.round(projectedTdee + adjustment) : null;
  const surplus = goalCalories !== null ? goalCalories - caloriesLogged : null;

  return { bmr: basalSoFar, active, tdee, projectedTdee, goalCalories, surplus, caloriesLogged, goal };
}

export async function getWeeklyAvgTDEE(): Promise<number | null> {
  const weeklyData = await getWeeklyBurnData();
  if (weeklyData.length === 0) return null;
  const avg = weeklyData.reduce((s, d) => s + d.burned, 0) / weeklyData.length;
  return Math.round(avg);
}
