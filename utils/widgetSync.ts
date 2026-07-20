import { Platform } from 'react-native';
import {
  writeWidgetData,
  getPendingFoodLog as nativeGetPendingFoodLog,
  type WidgetData,
  type PendingFoodLog,
} from 'fuelog-native';
import { toLocalDateString } from './dateUtils';

type Macros = { calories: number; protein: number; carbs: number; fat: number };

/**
 * Write the current day's macro summary to the shared App Group container so
 * the WidgetKit extension can display it. Also triggers an immediate widget
 * timeline reload via WidgetCenter.
 *
 * No-ops silently on Android, in Expo Go, and in simulators where the native
 * module is absent.
 */
export async function syncWidgetData(totals: Macros, targets: Macros): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const payload: WidgetData = {
    date:         toLocalDateString(),
    calories:     Math.round(totals.calories),
    caloriesGoal: Math.round(targets.calories),
    protein:      Math.round(totals.protein * 10) / 10,
    proteinGoal:  Math.round(targets.protein),
    carbs:        Math.round(totals.carbs * 10) / 10,
    carbsGoal:    Math.round(targets.carbs),
    fat:          Math.round(totals.fat * 10) / 10,
    fatGoal:      Math.round(targets.fat),
  };
  try {
    await writeWidgetData(payload);
  } catch {
    // Native module unavailable (Expo Go, simulator without the module)
  }
}

/**
 * Checks whether the "Log <food> in Fuelog" Siri App Intent has handed off a
 * food description since the app was last foregrounded. Call on launch and
 * on every foreground transition.
 */
export async function getPendingSiriFoodLog(): Promise<PendingFoodLog | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    return await nativeGetPendingFoodLog();
  } catch {
    return null;
  }
}
