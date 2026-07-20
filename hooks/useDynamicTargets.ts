import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { getTodayTDEE, TDEEResult } from '../utils/tdee';
import { deriveMacrosFromCalories } from '../constants/data';

export type MacroTargets = { calories: number; protein: number; carbs: number; fat: number };

/**
 * Dynamic daily macro targets driven by measured calorie burn.
 *
 * Pulls today's burn (HealthKit basal + active energy — Whoop/Garmin data
 * arrives through the same HealthKit source-deduped path), projects it to a
 * full-day TDEE, applies the user's goal adjustment, and derives P/C/F from
 * the resulting calorie budget.
 *
 * Priority rule: users who set custom macro goals (profile.custom_goals)
 * keep their own numbers — burn data is still fetched (for the burn strip)
 * but dynamicTargets stays null so their macros are never overridden.
 */
export function useDynamicTargets({
  userId,
  profile,
  enabled,
}: {
  userId: string | undefined;
  profile: any;
  enabled: boolean; // HealthKit authorized
}): {
  dynamicTargets: MacroTargets | null;
  tdeeData: TDEEResult | null;
  refresh: () => void;
} {
  const [tdeeData, setTdeeData] = useState<TDEEResult | null>(null);
  const isCustom = !!profile?.custom_goals;
  const active = !!userId && enabled;
  const dayKey = useRef(new Date().toDateString());

  const refresh = useCallback(() => {
    if (!active || !userId) return;
    getTodayTDEE(userId).then(setTdeeData).catch(() => {});
  }, [active, userId]);

  useEffect(() => {
    if (!active) { setTdeeData(null); return; }
    refresh();
  }, [active, refresh]);

  // Burn data goes stale while backgrounded — refresh on foreground, and
  // reset entirely when the app comes back on a new day
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const today = new Date().toDateString();
      if (today !== dayKey.current) {
        dayKey.current = today;
        setTdeeData(null);
      }
      refresh();
    });
    return () => sub.remove();
  }, [active, refresh]);

  const dynamicTargets =
    active && !isCustom && tdeeData?.goalCalories != null
      ? deriveMacrosFromCalories(tdeeData.goalCalories, profile)
      : null;

  return { dynamicTargets, tdeeData, refresh };
}
