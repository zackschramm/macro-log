/**
 * Thin, provider-agnostic analytics wrapper.
 *
 * The app currently has NO analytics backend wired up, so by design this file
 * is a no-op until one is configured. That is deliberate: instrumenting the
 * call sites is the expensive, spread-out part of the work, and it can land
 * now; picking Amplitude vs PostHog vs Segment is a one-line change later.
 *
 * ── HOW TO TURN IT ON ────────────────────────────────────────────────────────
 *  Option A — any HTTP collector (PostHog capture, Segment, your own edge fn):
 *      .env / EAS:  EXPO_PUBLIC_ANALYTICS_ENDPOINT=https://…/capture
 *                   EXPO_PUBLIC_ANALYTICS_KEY=<write key>        (optional)
 *      or app.json: expo.extra.analyticsEndpoint / expo.extra.analyticsKey
 *
 *  Option B — a real SDK: replace the body of `deliver()` below with e.g.
 *      posthog.capture(event, props)  /  amplitude.track(event, props)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Rules this file obeys:
 *  • never throws — analytics must not be able to break a user flow
 *  • never blocks — every send is fire-and-forget
 *  • never sends PII — pass ids and counts, not names, emails, or food photos
 */

import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isErrorReportingEnabled, logError } from './logError';

export type AnalyticsProps = Record<string, unknown>;

/** Canonical event names. Use these constants rather than raw strings. */
export const EVENTS = {
  ONBOARDING_STARTED:       'onboarding_started',
  ONBOARDING_STEP_COMPLETED:'onboarding_step_completed',
  ONBOARDING_COMPLETED:     'onboarding_completed',
  FIRST_FOOD_LOGGED:        'first_food_logged',
  FIRST_WEIGH_IN:           'first_weigh_in',
  COACH_OPENED:             'coach_opened',
  COACH_MESSAGE_SENT:       'coach_message_sent',
  PAYWALL_SHOWN:            'paywall_shown',
  PAYWALL_CONVERTED:        'paywall_converted',
  TRIAL_ENDING_SHOWN:       'trial_ending_shown',
  TRIAL_ENDING_CTA:         'trial_ending_cta',
  RACE_PLAN_GENERATED:      'race_plan_generated',
  RACE_PLAN_SHARED:         'race_plan_shared',
  EVENT_PLAN_GENERATED:     'event_plan_generated',
  WEIGHT_MILESTONE_SHOWN:   'weight_milestone_shown',
  STATS_BACKFILL_SHOWN:     'stats_backfill_shown',
  STATS_BACKFILL_COMPLETED: 'stats_backfill_completed',
} as const;

export type AnalyticsEvent = (typeof EVENTS)[keyof typeof EVENTS] | (string & {});

function extra<T = string>(key: string): T | undefined {
  return (Constants?.expoConfig?.extra as any)?.[key];
}

const ENDPOINT =
  (process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT || extra<string>('analyticsEndpoint') || '').trim();
const WRITE_KEY =
  (process.env.EXPO_PUBLIC_ANALYTICS_KEY || extra<string>('analyticsKey') || '').trim();

let distinctId: string | null = null;

/** Attach the signed-in user to subsequent events. Pass null on logout. */
export function identify(userId: string | null): void {
  distinctId = userId;
}

export function isAnalyticsEnabled(): boolean {
  return !!ENDPOINT;
}

function deliver(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!ENDPOINT) return;
  // Fire-and-forget. No await, no retry — a dropped event is always preferable
  // to a delayed or broken user interaction.
  fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(WRITE_KEY ? { Authorization: `Bearer ${WRITE_KEY}` } : {}),
    },
    body: JSON.stringify({
      event,
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
      properties: props ?? {},
    }),
  }).catch(e => logError('analytics.deliver', e, { event }));
}

/**
 * Record a product event.
 *
 * Safe to call from anywhere, including render paths and catch blocks.
 */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  try {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[analytics]', event, props ?? '');
    }

    // Even without an analytics backend, funnel events are valuable as Sentry
    // breadcrumbs — they show what the user did in the seconds before a crash.
    if (isErrorReportingEnabled()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const S = require('@sentry/react-native');
        S?.addBreadcrumb?.({ category: 'analytics', message: event, level: 'info', data: props });
      } catch {
        /* Sentry not installed — ignore */
      }
    }

    deliver(event, props);
  } catch {
    // Analytics must never break a user flow.
  }
}

/**
 * Fire an event at most once per install (first_food_logged, first_weigh_in…).
 * Resolves to true if this call was the one that fired it.
 */
export async function trackOnce(event: AnalyticsEvent, props?: AnalyticsProps): Promise<boolean> {
  const key = `fuelog_analytics_once_${event}`;
  try {
    const seen = await AsyncStorage.getItem(key);
    if (seen) return false;
    await AsyncStorage.setItem(key, String(Date.now()));
    track(event, props);
    return true;
  } catch (e) {
    logError('analytics.trackOnce', e, { event });
    return false;
  }
}

export default track;
