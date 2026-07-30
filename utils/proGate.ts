import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../constants/supabase';
import { hasPro } from '../constants/purchases';
import { logError } from './logError';

/**
 * Single source of truth for what Fuelog Pro unlocks.
 *
 * PACKAGING (Option A — "AI is the product", chosen 2026-07-27):
 *   Free  → manual + barcode logging, macro/calorie tracking, weight trend,
 *           Recovery, workouts, body measurements, plate calculator, social
 *   Pro   → every AI-powered feature, after a small free trial of each
 *
 * The reasoning is cost, not just positioning: 8 of 14 AI surfaces used to be
 * ungated, including vision (food photo — the most expensive call type) and
 * AddFoodModal (the highest-volume one). A free user could generate unbounded
 * Anthropic spend. Under this map, serving a free user is close to free.
 *
 * Gates used to be 8 scattered `hasPro()` calls with hand-rolled AsyncStorage
 * counters. Everything now goes through requireAIAccess() so the tier map can't
 * drift again — and so the trial counts live server-side, where deleting the app
 * can't reset them.
 */

export type AIFeature =
  | 'coach'            // AI Coach conversation
  | 'food_photo'       // vision — most expensive per call
  | 'food_text'        // natural-language food entry (AddFoodModal) — highest volume
  | 'voice_log'        // voice → macros
  | 'meal_plan'
  | 'recipe'
  | 'grocery_list'
  | 'workout_program'
  | 'workout_fill'
  | 'bloodwork_scan'
  | 'micronutrients'
  | 'glucose_insight'
  | 'memory_import'      // one-time import of another AI's context
  | 'inbody_scan'        // vision — reads an InBody result sheet
  | 'inbody_segmental';

/** Free uses granted before the paywall. 0 = Pro-only, no trial. */
export const TRIAL_LIMITS: Record<AIFeature, number> = {
  coach:            3,
  food_photo:       3,
  food_text:        10,  // highest volume — a stingy limit here would gut onboarding
  voice_log:        5,
  meal_plan:        1,
  recipe:           2,
  grocery_list:     2,
  workout_program:  1,
  workout_fill:     3,
  bloodwork_scan:   3,
  micronutrients:   3,
  glucose_insight:  3,
  memory_import:    2,   // onboarding moment — enough for one go plus a retry
  inbody_scan:      2,
  inbody_segmental: 0,   // Pro-only: premium analysis, low volume
};

/** Copy shown on the paywall when each feature runs out. */
export const FEATURE_LABELS: Record<AIFeature, string> = {
  coach:            'AI coaching',
  food_photo:       'food photo scanning',
  food_text:        'AI food logging',
  voice_log:        'voice logging',
  meal_plan:        'AI meal plans',
  recipe:           'AI recipes',
  grocery_list:     'AI grocery lists',
  workout_program:  'AI workout programs',
  workout_fill:     'AI workout fill',
  bloodwork_scan:   'blood work scanning',
  micronutrients:   'micronutrient analysis',
  glucose_insight:  'glucose insights',
  memory_import:    'AI coach import',
  inbody_scan:      'InBody scanning',
  inbody_segmental: 'InBody segmental analysis',
};

export interface GateResult {
  allowed: boolean;
  /** True when access came from a paid entitlement rather than the trial. */
  isPro: boolean;
  remaining: number;
  limit: number;
  /** Ready-to-show paywall copy when `allowed` is false. */
  message?: string;
}

/**
 * Check-and-consume before an AI call.
 *
 * Pro users pass through without touching the counter. Free users consume one
 * trial use atomically (server-side, so double-taps can't overspend).
 *
 * FAIL-OPEN: if the network or RPC is unavailable this ALLOWS the call. A user
 * who can't reach Supabase shouldn't be told they've hit a paywall they may not
 * have hit — the worst case is a handful of extra free calls, which is far
 * cheaper than a false accusation and a 1-star review.
 */
/**
 * Dev-only paywall bypass.
 *
 * `__DEV__` is TRUE only in Expo Go and dev-client builds. EAS preview,
 * TestFlight, and App Store builds all compile with __DEV__ === false, so this
 * CANNOT ship enabled — there is no runtime flag or env var that turns it on in
 * a release binary, deliberately.
 *
 * Set to false if you want to exercise the real paywall while developing.
 */
const DEV_BYPASS_PAYWALL = true;

function devBypassActive(): boolean {
  return __DEV__ && DEV_BYPASS_PAYWALL;
}

export async function requireAIAccess(feature: AIFeature): Promise<GateResult> {
  const limit = TRIAL_LIMITS[feature] ?? 0;

  if (devBypassActive()) {
    return { allowed: true, isPro: true, remaining: Infinity, limit };
  }

  let isPro = false;
  try {
    isPro = await hasPro();
  } catch (e) {
    logError('proGate.hasPro', e, { feature });
  }
  if (isPro) return { allowed: true, isPro: true, remaining: Infinity, limit };

  if (limit === 0) {
    return {
      allowed: false, isPro: false, remaining: 0, limit,
      message: `${capitalize(FEATURE_LABELS[feature])} is a Pro feature.`,
    };
  }

  try {
    const { data, error } = await supabase.rpc('consume_ai_trial', {
      p_feature: feature,
      p_limit: limit,
    });
    if (error) throw error;

    const r = (data ?? {}) as { allowed?: boolean; remaining?: number };
    if (r.allowed) {
      return { allowed: true, isPro: false, remaining: r.remaining ?? 0, limit };
    }
    return {
      allowed: false, isPro: false, remaining: 0, limit,
      message:
        `You've used your ${limit} free ${FEATURE_LABELS[feature]} ` +
        `${limit === 1 ? 'use' : 'uses'}. Upgrade to Pro for unlimited access.`,
    };
  } catch (e) {
    logError('proGate.consumeTrial', e, { feature });
    return { allowed: true, isPro: false, remaining: 0, limit };   // fail open
  }
}

/** Remaining free uses without consuming one — for "2 left" badges. */
export async function getTrialRemaining(feature: AIFeature): Promise<number | null> {
  try {
    if (devBypassActive()) return Infinity;
    if (await hasPro()) return Infinity;
    const { data, error } = await supabase.rpc('get_ai_trial_status', {
      p_limit: TRIAL_LIMITS[feature] ?? 0,
    });
    if (error) throw error;
    const row = (data ?? []).find((r: any) => r.feature === feature);
    if (!row) return TRIAL_LIMITS[feature] ?? 0;
    return row.remaining ?? 0;
  } catch (e) {
    logError('proGate.getTrialRemaining', e, { feature });
    return null;
  }
}

/**
 * One-time migration of the old device-local counters.
 *
 * Existing users already spent free uses in AsyncStorage. Without this they'd
 * get a full fresh allowance on the first launch after updating. seed_ai_trial
 * takes the higher of the two values, so this can never *reduce* a count.
 * Safe to call on every launch; it no-ops after the first success.
 */
const LEGACY_KEYS: Array<[string, AIFeature]> = [
  ['fuelog_coach_message_count',     'coach'],
  ['fuelog_ai_workout_fill_count',   'workout_fill'],
  ['fuelog_bloodwork_scan_count',    'bloodwork_scan'],
];
const MIGRATED_KEY = 'fuelog_trial_counts_migrated';

export async function migrateLegacyTrialCounts(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(MIGRATED_KEY)) return;

    for (const [key, feature] of LEGACY_KEYS) {
      const raw = await AsyncStorage.getItem(key);
      const used = raw ? parseInt(raw, 10) : 0;
      if (!used || Number.isNaN(used)) continue;
      const { error } = await supabase.rpc('seed_ai_trial', {
        p_feature: feature,
        p_used: used,
      });
      if (error) throw error;
    }

    await AsyncStorage.setItem(MIGRATED_KEY, Date.now().toString());
  } catch (e) {
    // Leave the flag unset so it retries next launch.
    logError('proGate.migrateLegacyTrialCounts', e);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
