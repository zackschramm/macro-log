/**
 * Where the user is in their free trial, straight from RevenueCat.
 *
 * The trial clock belongs to StoreKit, not to us. Anything we derive from a
 * locally stored "trial started" timestamp drifts the moment the user changes
 * device time, restores a purchase, gets an extension, or has the trial
 * inherited through Family Sharing — and a paywall that fires on the wrong day
 * is worse than one that never fires. `CustomerInfo` exposes the real
 * expiration for the entitlement, so read it and never guess.
 */

import Purchases from 'react-native-purchases';
import { ENTITLEMENT_ID } from '../constants/purchases';
import { logError } from './logError';

/** How far ahead of expiry we surface the in-app moment. */
export const TRIAL_REMINDER_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialStatus {
  /** True only while the entitlement is in its introductory free period. */
  isTrial: boolean;
  /** Trial expiry in epoch ms. Null for lifetime access or when unknown. */
  expiresAtMs: number | null;
  /**
   * Whole days remaining, rounded up — 1 means "within the next 24 hours",
   * 0 or below means it has already lapsed. Null when there's no expiry.
   */
  daysLeft: number | null;
  /** False once the user has switched off auto-renew — i.e. they've cancelled. */
  willRenew: boolean;
}

/**
 * Days from `nowMs` to `expiresAtMs`, rounded up so a trial with 30 hours left
 * reads as "2 days" rather than "1". Exported for the tests and for callers
 * that already hold a CustomerInfo.
 */
export function daysUntil(expiresAtMs: number, nowMs: number = Date.now()): number {
  return Math.ceil((expiresAtMs - nowMs) / DAY_MS);
}

export async function getTrialStatus(): Promise<TrialStatus | null> {
  try {
    const info = await Purchases.getCustomerInfo();
    const ent = info.entitlements.active[ENTITLEMENT_ID];
    if (!ent) return null;

    const expiresAtMs = ent.expirationDateMillis
      ?? (ent.expirationDate ? Date.parse(ent.expirationDate) : null);
    const valid = typeof expiresAtMs === 'number' && Number.isFinite(expiresAtMs);

    return {
      isTrial: ent.periodType === 'TRIAL',
      expiresAtMs: valid ? expiresAtMs : null,
      daysLeft: valid ? daysUntil(expiresAtMs as number) : null,
      willRenew: !!ent.willRenew,
    };
  } catch (e) {
    // Offline, StoreKit unavailable, simulator — say nothing rather than
    // showing a trial warning we can't substantiate.
    logError('trialStatus.getTrialStatus', e);
    return null;
  }
}

/**
 * Whether the trial-ending moment is due.
 *
 * Deliberately a pure function of the status so the decision is testable and
 * so the caller can re-check it on every launch without any stored countdown.
 */
export function isTrialEndingSoon(
  status: TrialStatus | null,
  reminderDays: number = TRIAL_REMINDER_DAYS
): boolean {
  if (!status || !status.isTrial) return false;
  if (status.daysLeft === null) return false;
  // `> 0` keeps it out of the window once the trial has actually lapsed —
  // at that point the user is either paying or has lost access, and either
  // way this is the wrong message.
  return status.daysLeft <= reminderDays && status.daysLeft > 0;
}
