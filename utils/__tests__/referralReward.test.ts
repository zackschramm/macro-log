/**
 * Referral reward decisions.  Run with:  npm test
 *
 * Imports the edge function's pure module directly — it has no Deno imports
 * precisely so this test can exist.
 */
import assert from 'node:assert/strict';
import {
  isPaidConversion, promoEndTimeMs, currentPromoEndFromSubscriber, REWARD_DAYS,
} from '../../supabase/functions/revenuecat-webhook/referralReward';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-17T12:00:00Z');

console.log('\nWhat counts as a conversion');

test('a free-trial start is NOT a conversion', () => {
  // Fuelog sells a 7-day trial; rewarding this turns referrals into a
  // trial-signup farm.
  assert.equal(isPaidConversion('INITIAL_PURCHASE', 'TRIAL'), false);
});

test('the first paid renewal IS a conversion', () => {
  assert.equal(isPaidConversion('RENEWAL', 'NORMAL'), true);
});

test('a direct paid purchase with no trial IS a conversion', () => {
  assert.equal(isPaidConversion('INITIAL_PURCHASE', 'NORMAL'), true);
  assert.equal(isPaidConversion('NON_RENEWING_PURCHASE', 'NORMAL'), true);
});

test('intro-price periods are not treated as full conversions', () => {
  assert.equal(isPaidConversion('RENEWAL', 'INTRO'), false);
});

test('a missing period_type is never assumed to be paid', () => {
  assert.equal(isPaidConversion('RENEWAL', null), false);
  assert.equal(isPaidConversion('RENEWAL', undefined), false);
  assert.equal(isPaidConversion('RENEWAL', ''), false);
});

test('non-purchase events never pay out', () => {
  for (const t of ['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'REFUND', 'TRANSFER', 'TEST', 'UNCANCELLATION']) {
    assert.equal(isPaidConversion(t, 'NORMAL'), false, t);
  }
  assert.equal(isPaidConversion(null, 'NORMAL'), false);
});

console.log('\nRewards stack');

test('a first reward runs 30 days from now', () => {
  assert.equal(promoEndTimeMs(NOW, null), NOW + 30 * DAY);
  assert.equal(REWARD_DAYS, 30);
});

test('THE STACKING BUG: three referrals give three months, not one', () => {
  let end: number | null = null;
  for (let i = 0; i < 3; i++) end = promoEndTimeMs(NOW, end);
  assert.equal(end, NOW + 90 * DAY, 'now+30d each time would have collapsed to 30 days');
});

test('an expired promo is not used as the anchor', () => {
  const expired = NOW - 5 * DAY;
  assert.equal(promoEndTimeMs(NOW, expired), NOW + 30 * DAY);
});

test('junk anchors fall back to now', () => {
  for (const bad of [null, undefined, NaN, Infinity] as any[]) {
    assert.equal(promoEndTimeMs(NOW, bad), NOW + 30 * DAY, String(bad));
  }
});

console.log('\nReading the referrer current grant');

const sub = (product: string, expires: string | null) => ({
  subscriber: { entitlements: { 'Fuelog Pro': { product_identifier: product, expires_date: expires } } },
});

test('an existing promotional grant is found', () => {
  const ms = currentPromoEndFromSubscriber(sub('promotional', '2026-10-17T12:00:00Z'), 'Fuelog Pro');
  assert.equal(ms, Date.parse('2026-10-17T12:00:00Z'));
});

test('A PAID subscription is NOT used as the anchor', () => {
  // RevenueCat applies a promo alongside a store transaction rather than
  // deferring it, so anchoring to a paid expiry hands a paying referrer a
  // month that runs concurrently with one they are already paying for.
  assert.equal(currentPromoEndFromSubscriber(sub('fuelog_pro_monthly', '2027-01-01T00:00:00Z'), 'Fuelog Pro'), null);
});

test('missing entitlement, dates and junk all yield null', () => {
  assert.equal(currentPromoEndFromSubscriber(sub('promotional', null), 'Fuelog Pro'), null);
  assert.equal(currentPromoEndFromSubscriber({}, 'Fuelog Pro'), null);
  assert.equal(currentPromoEndFromSubscriber(null, 'Fuelog Pro'), null);
  assert.equal(currentPromoEndFromSubscriber(sub('promotional', 'not-a-date'), 'Fuelog Pro'), null);
  assert.equal(currentPromoEndFromSubscriber(sub('promotional', '2026-10-17T12:00:00Z'), 'Other'), null);
});

test('the un-nested payload shape is also accepted', () => {
  const flat = { entitlements: { 'Fuelog Pro': { product_identifier: 'promotional', expires_date: '2026-10-17T12:00:00Z' } } };
  assert.equal(currentPromoEndFromSubscriber(flat, 'Fuelog Pro'), Date.parse('2026-10-17T12:00:00Z'));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
