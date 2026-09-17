/**
 * Referral reward: the decisions, with no I/O.
 *
 * Deliberately import-free so the tsx test chain can import it directly —
 * this is the part where getting the arithmetic wrong means either paying out
 * rewards nobody earned or quietly paying out none at all, and neither is
 * visible without a test.
 *
 * Verified against the RevenueCat API v1 reference (17 Sep 2026):
 *   POST /v1/subscribers/{app_user_id}/entitlements/{entitlement_id}/promotional
 *   Authorization: Bearer <SECRET key>
 *   body: { end_time_ms }        <- `duration` is DEPRECATED, do not use it
 *   -> 201
 * Two documented behaviours shape the code below:
 *   - "Does not override or defer a store transaction, applied simultaneously."
 *   - "Requests with an end_time_ms within 2 hours of an active promotional
 *      entitlement's expiration are treated as duplicates and won't extend it."
 */

export const REWARD_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Does this webhook event mean the referee actually started PAYING?
 *
 * Fuelog sells a 7-day free trial, so INITIAL_PURCHASE usually arrives with
 * period_type TRIAL — money has not moved and the trial may never convert.
 * Rewarding that is how a referral programme becomes a trial-signup farm.
 * The first paid event is a RENEWAL with period_type NORMAL (or an
 * INITIAL_PURCHASE with NORMAL when there is no trial).
 *
 * RevenueCat omits period_type on some event types; absent is NOT treated as
 * paid, because the safe failure here is a reward that needs chasing rather
 * than one that should never have been granted.
 */
export function isPaidConversion(
  type: string | null | undefined,
  periodType: string | null | undefined,
): boolean {
  const PAID_EVENTS = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE']);
  if (!type || !PAID_EVENTS.has(String(type))) return false;
  return String(periodType ?? '').toUpperCase() === 'NORMAL';
}

/**
 * When the referrer's granted month should end.
 *
 * Stacks. Refer three friends who convert and you get three months, not one
 * month three times — which is what `now + 30d` would have produced, and is
 * the kind of quiet shortchanging that gets noticed publicly.
 *
 * `currentPromoEndMs` is the referrer's existing PROMOTIONAL expiry, or null.
 * A paid subscription is deliberately NOT passed in: RevenueCat applies a
 * promotional grant alongside a store transaction rather than deferring it,
 * so anchoring to a paid expiry would hand a paying referrer a month that
 * runs concurrently with the one they are already paying for, and then vanish.
 */
export function promoEndTimeMs(
  nowMs: number,
  currentPromoEndMs: number | null | undefined,
  days: number = REWARD_DAYS,
): number {
  const anchor =
    typeof currentPromoEndMs === 'number' &&
    Number.isFinite(currentPromoEndMs) &&
    currentPromoEndMs > nowMs
      ? currentPromoEndMs
      : nowMs;
  return anchor + days * DAY_MS;
}

/**
 * The referrer's current promotional expiry from a v1 subscriber payload, in
 * epoch ms, or null.
 *
 * Only counts grants RevenueCat marks as promotional. A paid entitlement's
 * expires_date must not be used as the anchor — see promoEndTimeMs.
 */
export function currentPromoEndFromSubscriber(
  subscriber: any,
  entitlementId: string,
): number | null {
  const ent = subscriber?.subscriber?.entitlements?.[entitlementId]
    ?? subscriber?.entitlements?.[entitlementId];
  if (!ent) return null;
  // RevenueCat reports a promotional grant with the product identifier
  // "promotional"; anything else is a store purchase.
  const product = String(ent.product_identifier ?? '');
  if (product !== 'promotional') return null;
  const iso = ent.expires_date;
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  return Number.isFinite(ms) ? ms : null;
}
