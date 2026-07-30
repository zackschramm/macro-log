import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { GOAL_ADJUSTMENTS, estimateBmr, USER_GOAL_ADJUSTMENTS } from '../constants/data';
import type { UserGoal } from '../constants/data';
import { getTodayBurn, getWeeklyBurnData } from '../hooks/useHealthKit';
import { toLocalDateString } from './dateUtils';

// Re-exported from constants/data so existing importers keep working. The
// definitions live there because it has no imports, which keeps the macro math
// testable without a React Native harness.
export type { UserGoal };
export { USER_GOAL_ADJUSTMENTS };

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

export async function getTodayTDEE(userId: string): Promise<TDEEResult> {
  const today = toLocalDateString();

  const [burnData, goalRaw, profileResult, logsResult, inbodyResult] = await Promise.all([
    getTodayBurn(),
    AsyncStorage.getItem('fuelog_onboarding_goal'),
    supabase.from('profiles').select('goal, weight_lbs, height_in, age, sex, sport').eq('id', userId).single(),
    supabase.from('macro_logs').select('calories').eq('user_id', userId).eq('date', today),
    // Latest body composition — enables the Katch-McArdle BMR estimate, which
    // doesn't underestimate muscular users the way Mifflin does.
    supabase.from('inbody_logs').select('body_fat_pct').eq('user_id', userId)
      .not('body_fat_pct', 'is', null)
      .order('measured_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const profile = profileResult.data
    ? { ...profileResult.data, body_fat_pct: inbodyResult.data?.body_fat_pct ?? null }
    : null;
  const rawGoal = goalRaw ?? profile?.goal ?? 'maintain';
  const adjustment =
    GOAL_ADJUSTMENTS[rawGoal as keyof typeof GOAL_ADJUSTMENTS] ?? 0;
  const goal: UserGoal =
    rawGoal === 'lose' ? 'lose_fat' : rawGoal === 'gain' ? 'build_muscle' : 'maintain';

  const caloriesLogged = Math.round(
    (logsResult.data ?? []).reduce((sum: number, r: any) => sum + (r.calories ?? 0), 0)
  );

  const { bmr, active } = burnData;
  const estimatedBmr = estimateBmr(profile).bmr;

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
