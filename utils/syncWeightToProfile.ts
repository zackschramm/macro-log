import { supabase } from '../constants/supabase';
import { calculateTargets } from '../constants/data';
import { WeightTrend } from './weightTrend';

/**
 * Keeps profiles.weight_lbs — and therefore the calorie/macro targets — in step
 * with what the user actually weighs.
 *
 * Before this existed, weigh-ins were written to body_measurements and nowhere
 * else, so BMR stayed pinned to the weight entered at onboarding. Someone who
 * lost 25 lbs kept eating for their starting bodyweight (~150 cal/day too many
 * at that size) and stalled with no visible cause. This is the most common way
 * calorie apps quietly stop working.
 */

/** Ignore sub-pound wobble; only meaningful moves are worth a profile write. */
const MIN_DELTA_LB = 1.0;

export interface WeightSyncResult {
  updated: boolean;
  previousWeight: number | null;
  newWeight: number | null;
  /** Change in daily calorie target, if targets were recalculated. */
  calorieDelta: number | null;
  reason?: 'no-change' | 'custom-goals' | 'insufficient-data' | 'no-profile' | 'error';
}

/**
 * Syncs the user's current weight and recalculates targets.
 *
 * Deliberately uses the SMOOTHED trend weight, not the raw reading — updating
 * BMR off a dehydrated Tuesday morning would make targets jitter day to day and
 * destroy trust in the number.
 *
 * Respects the same priority order the app uses everywhere else: users with
 * `custom_goals` keep their own macros untouched (weight still syncs, so the
 * Coach and body-comp math stay correct — only the targets are left alone).
 */
export async function syncWeightToProfile(
  userId: string,
  trend: WeightTrend,
  opts?: { bodyFatPct?: number | null }
): Promise<WeightSyncResult> {
  const base: WeightSyncResult = {
    updated: false, previousWeight: null, newWeight: null, calorieDelta: null,
  };

  if (!trend.hasEnoughData || trend.current === null) {
    return { ...base, reason: 'insufficient-data' };
  }

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('weight_lbs, height_in, age, sex, activity, goal, sport, custom_goals, calories')
      .eq('id', userId)
      .single();

    if (error || !profile) return { ...base, reason: 'no-profile' };

    const previousWeight = (profile.weight_lbs as number) ?? null;
    const newWeight = Math.round(trend.current * 10) / 10;

    if (previousWeight !== null && Math.abs(newWeight - previousWeight) < MIN_DELTA_LB) {
      return { ...base, previousWeight, newWeight, reason: 'no-change' };
    }

    // Custom-goal users: sync the weight, never touch their macros.
    if (profile.custom_goals) {
      await supabase.from('profiles')
        .update({ weight_lbs: newWeight, updated_at: new Date().toISOString() })
        .eq('id', userId);
      return {
        updated: true, previousWeight, newWeight, calorieDelta: null,
        reason: 'custom-goals',
      };
    }

    // Can't recalculate without the full stat set — still sync the weight so
    // the Coach and body-comp features see the truth.
    if (!profile.height_in || !profile.age) {
      await supabase.from('profiles')
        .update({ weight_lbs: newWeight, updated_at: new Date().toISOString() })
        .eq('id', userId);
      return { updated: true, previousWeight, newWeight, calorieDelta: null };
    }

    const targets = calculateTargets({
      weight_lbs: newWeight,
      height_in: profile.height_in as number,
      age: profile.age as number,
      sex: (profile.sex as string) ?? 'male',
      activity: (profile.activity as string) ?? 'moderate',
      goal: (profile.goal as string) ?? 'maintain',
      sport: (profile.sport as string) ?? 'none',
      body_fat_pct: opts?.bodyFatPct ?? null,
    });

    if (targets.calories <= 0) {
      return { ...base, previousWeight, newWeight, reason: 'error' };
    }

    const { error: updateError } = await supabase.from('profiles')
      .update({
        weight_lbs: newWeight,
        calories: targets.calories,
        protein: targets.protein,
        carbs: targets.carbs,
        fat: targets.fat,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) return { ...base, previousWeight, newWeight, reason: 'error' };

    const oldCalories = (profile.calories as number) ?? null;
    return {
      updated: true,
      previousWeight,
      newWeight,
      calorieDelta: oldCalories === null ? null : targets.calories - oldCalories,
    };
  } catch {
    return { ...base, reason: 'error' };
  }
}

/**
 * User-facing explanation of a target change.
 *
 * Silently shrinking someone's calories after they lose weight feels like a
 * punishment and reads as a bug. Saying why turns it into evidence the app is
 * paying attention.
 */
export function describeTargetChange(
  result: WeightSyncResult,
  unit = 'lbs'
): string | null {
  if (!result.updated || result.calorieDelta === null || result.calorieDelta === 0) return null;
  if (Math.abs(result.calorieDelta) < 25) return null;   // not worth a message

  const { previousWeight, newWeight, calorieDelta } = result;
  const lost = previousWeight !== null && newWeight !== null && newWeight < previousWeight;
  const change = Math.abs(calorieDelta);
  const dir = calorieDelta < 0 ? 'lowered' : 'raised';

  const why = previousWeight !== null && newWeight !== null
    ? `You're now ${newWeight} ${unit} (was ${previousWeight}). `
    : '';

  return (
    `${why}Your daily target has been ${dir} by ${change} calories to match — ` +
    `a ${lost ? 'lighter' : 'heavier'} body burns ${lost ? 'less' : 'more'} at rest.`
  );
}
