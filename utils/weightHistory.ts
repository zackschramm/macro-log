import { supabase } from '../constants/supabase';
import { logError } from './logError';
import { plausible, toDay, dedupeByDate, type WeightEntry } from './weightMerge';

/**
 * ONE weight history, assembled from every place the app stores weight.
 *
 * THE BUG THIS FIXES
 * Weight was being written to three unrelated tables with three different
 * column names, and each screen read only one of them:
 *
 *   progress_logs.weight_lbs      ← ProgressScreen (the Stats tab) writes here
 *   body_measurements.weight_lb   ← BodyMeasurementsScreen writes here
 *   inbody_logs.weight_lb         ← InBody scan import writes here
 *
 * So a weight logged on the Stats tab never appeared in the weight trend,
 * never counted toward a milestone, never reached syncWeightToProfile (meaning
 * calorie targets stayed stale), and never showed up in the Coach's context —
 * and vice versa. Two users doing the same thing in different screens saw
 * different numbers.
 *
 * This reads all three and merges them. Deliberately READ-ONLY: existing writes
 * are left exactly where they are, so nothing needs migrating and no data can be
 * lost. Every weight-consuming path should use this instead of querying a single
 * table.
 *
 * The pure merge helpers live in `weightMerge.ts` so they are testable without
 * dragging React Native in through the Supabase client; they are re-exported
 * below so every existing call site keeps working.
 */
export { dedupeByDate, toWeighIns, latestWeight, type WeightEntry } from './weightMerge';

/**
 * Every known weigh-in for a user, in POUNDS, oldest first, one per day.
 *
 * Fails soft per-table: if one query errors the others still return, so a
 * permissions problem on one table degrades the trend rather than emptying it.
 */
export async function getWeightHistory(userId: string): Promise<WeightEntry[]>{
  const [progressRes, measurementsRes, inbodyRes] = await Promise.allSettled([
    supabase.from('progress_logs')
      .select('date, weight_lbs')
      .eq('user_id', userId)
      .not('weight_lbs', 'is', null),
    supabase.from('body_measurements')
      .select('date, weight_lb')
      .eq('user_id', userId)
      .not('weight_lb', 'is', null),
    supabase.from('inbody_logs')
      .select('measured_at, weight_lb')
      .eq('user_id', userId)
      .not('weight_lb', 'is', null),
  ]);

  const collected: WeightEntry[] = [];

  if (progressRes.status === 'fulfilled') {
    if (progressRes.value.error) logError('weightHistory.progress_logs', progressRes.value.error);
    for (const r of progressRes.value.data ?? []) {
      const date = toDay((r as any).date);
      const weight = (r as any).weight_lbs;
      if (date && plausible(weight)) collected.push({ date, weight, source: 'manual' });
    }
  } else {
    logError('weightHistory.progress_logs', progressRes.reason);
  }

  if (measurementsRes.status === 'fulfilled') {
    if (measurementsRes.value.error) logError('weightHistory.body_measurements', measurementsRes.value.error);
    for (const r of measurementsRes.value.data ?? []) {
      const date = toDay((r as any).date);
      const weight = (r as any).weight_lb;
      if (date && plausible(weight)) collected.push({ date, weight, source: 'measurements' });
    }
  } else {
    logError('weightHistory.body_measurements', measurementsRes.reason);
  }

  if (inbodyRes.status === 'fulfilled') {
    if (inbodyRes.value.error) logError('weightHistory.inbody_logs', inbodyRes.value.error);
    for (const r of inbodyRes.value.data ?? []) {
      const date = toDay((r as any).measured_at);
      const weight = (r as any).weight_lb;
      if (date && plausible(weight)) collected.push({ date, weight, source: 'inbody' });
    }
  } else {
    logError('weightHistory.inbody_logs', inbodyRes.reason);
  }

  return dedupeByDate(collected);
}
