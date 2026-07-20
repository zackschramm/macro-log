import { requireOptionalNativeModule } from 'expo-modules-core';

// Optional: the module only exists in iOS dev-client/production builds.
// requireNativeModule would throw at import time and crash Android/Expo Go.
const FuelogNative = requireOptionalNativeModule('FuelogNative');

export interface WidgetData {
  /** YYYY-MM-DD */
  date: string;
  calories: number;
  caloriesGoal: number;
  protein: number;
  proteinGoal: number;
  carbs: number;
  carbsGoal: number;
  fat: number;
  fatGoal: number;
}

export function writeWidgetData(data: WidgetData): Promise<void> {
  if (!FuelogNative) return Promise.resolve();
  return FuelogNative.writeWidgetData(data);
}

export type PendingFoodLog = { food: string; timestamp: number };

/**
 * Reads (and clears) the food description handed off by the "Log <food> in
 * Fuelog" Siri App Intent, if the intent has run since the last check.
 */
export function getPendingFoodLog(): Promise<PendingFoodLog | null> {
  if (!FuelogNative) return Promise.resolve(null);
  return FuelogNative.getPendingFoodLog();
}

/**
 * True when Apple's on-device model is ready (iOS 26+, supported hardware,
 * Apple Intelligence model downloaded). Cached by callers, not here.
 */
export function isLocalAIAvailable(): Promise<boolean> {
  if (!FuelogNative?.isLocalAIAvailable) return Promise.resolve(false);
  return FuelogNative.isLocalAIAvailable().catch(() => false);
}

/**
 * Runs a prompt through the on-device model. Rejects on any failure —
 * callers (constants/ai.ts) fall back to the ai-proxy edge function.
 */
export function generateLocalAI(prompt: string, system?: string, maxTokens = 1024): Promise<string> {
  if (!FuelogNative?.generateLocalAI) return Promise.reject(new Error('Local AI not available'));
  return FuelogNative.generateLocalAI(prompt, system ?? '', maxTokens);
}
