/**
 * iOS 27 HealthKit fallback bucketing.  Run with:  npm test
 *
 * These buckets stand in for what HKStatisticsCollectionQuery would have
 * returned, so the property that matters is that every existing caller keeps
 * working: ones that sum the array, ones that group by `sourceName`, and ones
 * that read per-day values.
 */
import assert from 'node:assert/strict';
import { bucketByDayAndSource, classifySleepSample, SAMPLE_UNITS, type RawSample } from '../healthBuckets';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

const S = (value: number, start: string, sourceName = 'Apple Watch'): RawSample =>
  ({ value, start, end: start, sourceName });

console.log('\nBucketing raw samples');

test('samples on the same day from the same source collapse into one bucket', () => {
  const out = bucketByDayAndSource([
    S(100, '2026-07-30T08:00:00Z'),
    S(150, '2026-07-30T12:00:00Z'),
    S(50,  '2026-07-30T18:00:00Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 300);
});

test('different days stay separate', () => {
  const out = bucketByDayAndSource([
    S(100, '2026-07-29T08:00:00Z'),
    S(200, '2026-07-30T08:00:00Z'),
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(b => b.value), [100, 200]);
});

test('different sources stay separate on the same day', () => {
  // The active-energy caller groups by sourceName and takes the largest, to
  // avoid double-counting a phone and a watch recording the same activity.
  const out = bucketByDayAndSource([
    S(300, '2026-07-30T08:00:00Z', 'Apple Watch'),
    S(120, '2026-07-30T08:05:00Z', 'iPhone'),
  ]);
  assert.equal(out.length, 2);
  const bySource = Object.fromEntries(out.map(b => [b.sourceName, b.value]));
  assert.equal(bySource['Apple Watch'], 300);
  assert.equal(bySource['iPhone'], 120);
});

test('the total is preserved — the thing every summing caller relies on', () => {
  const raw = Array.from({ length: 50 }, (_, i) =>
    S(10, `2026-07-30T${String(i % 24).padStart(2, '0')}:00:00Z`, i % 2 ? 'A' : 'B'));
  const out = bucketByDayAndSource(raw);
  assert.equal(out.reduce((s, b) => s + b.value, 0), 500);
});

test('a bucket spans from its earliest sample to its latest', () => {
  const out = bucketByDayAndSource([
    { value: 1, start: '2026-07-30T18:00:00Z', end: '2026-07-30T19:00:00Z', sourceName: 'W' },
    { value: 1, start: '2026-07-30T06:00:00Z', end: '2026-07-30T07:00:00Z', sourceName: 'W' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].startDate, '2026-07-30T06:00:00Z');
  assert.equal(out[0].endDate, '2026-07-30T19:00:00Z');
});

test('output is ordered oldest first', () => {
  const out = bucketByDayAndSource([
    S(1, '2026-07-30T08:00:00Z'), S(1, '2026-07-28T08:00:00Z'), S(1, '2026-07-29T08:00:00Z'),
  ]);
  assert.deepEqual(out.map(b => b.startDate.slice(0, 10)),
                   ['2026-07-28', '2026-07-29', '2026-07-30']);
});

console.log('\nShape compatibility with the native API');

test('the aggregated API shape (startDate/endDate) is accepted too', () => {
  const out = bucketByDayAndSource([
    { value: 42, startDate: '2026-07-30T08:00:00Z', endDate: '2026-07-30T09:00:00Z', sourceName: 'W' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 42);
});

test('buckets expose startDate/endDate, not start/end', () => {
  const out = bucketByDayAndSource([S(1, '2026-07-30T08:00:00Z')]);
  assert.ok('startDate' in out[0] && 'endDate' in out[0]);
});

console.log('\nUnit scaling — the bug that blanked Stats on iOS 27');

test('energy types ask for `calorie`, never `kilocalorie`', () => {
  // react-native-health's TS enum exports `kilocalorie`, but its native unit
  // parser does not recognise that string. It silently falls back to a count
  // unit, every energy sample throws "incompatible units" internally, each
  // throw is caught and skipped, and the query returns [] with NO error.
  for (const type of ['ActiveEnergyBurned', 'BasalEnergyBurned']) {
    assert.equal(SAMPLE_UNITS[type].unit, 'calorie',
      `${type} must not request an unparseable unit string`);
  }
  const accepted = new Set([
    'gram', 'kg', 'stone', 'pound', 'meter', 'cm', 'inch', 'mile', 'foot',
    'second', 'minute', 'hour', 'day', 'joule', 'calorie', 'count', 'percent',
    'bpm', 'fahrenheit', 'celsius', 'mmhg', 'mmolPerL', 'literPerMinute',
    'mgPerdL', 'mlPerKgMin',
  ]);
  for (const [type, { unit }] of Object.entries(SAMPLE_UNITS)) {
    assert.ok(accepted.has(unit), `${type} requests "${unit}", which hkUnitFromOptions cannot parse`);
  }
});

test('gram calories are scaled to kcal — 1 kcal = 1000 cal', () => {
  // A 500 kcal ride comes back as 500,000 from HealthKit's calorieUnit.
  const { scale } = SAMPLE_UNITS.ActiveEnergyBurned;
  const out = bucketByDayAndSource([S(500_000, '2026-07-30T08:00:00Z')], scale);
  assert.equal(out[0].value, 500);
});

test('steps are not scaled', () => {
  const { scale } = SAMPLE_UNITS.StepCount;
  const out = bucketByDayAndSource([S(8421, '2026-07-30T08:00:00Z')], scale);
  assert.equal(out[0].value, 8421);
});

test('scaling applies to every sample in a bucket, not just the first', () => {
  const out = bucketByDayAndSource([
    S(120_000, '2026-07-30T08:00:00Z'),
    S(80_000,  '2026-07-30T12:00:00Z'),
  ], 1 / 1000);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 200);
});

test('omitting scale leaves values untouched — existing callers are unaffected', () => {
  const out = bucketByDayAndSource([S(300, '2026-07-30T08:00:00Z')]);
  assert.equal(out[0].value, 300);
});

console.log('\nJunk tolerance — this runs against live device data');

test('undateable samples are dropped, not counted at epoch', () => {
  const out = bucketByDayAndSource([
    { value: 999, sourceName: 'W' },
    S(10, '2026-07-30T08:00:00Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 10);
});

test('missing or non-numeric values count as zero, never NaN', () => {
  const out = bucketByDayAndSource([
    { start: '2026-07-30T08:00:00Z', sourceName: 'W' },
    { value: NaN, start: '2026-07-30T09:00:00Z', sourceName: 'W' },
    S(25, '2026-07-30T10:00:00Z', 'W'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 25);
  assert.ok(Number.isFinite(out[0].value));
});

test('a missing source name is grouped, not dropped', () => {
  const out = bucketByDayAndSource([{ value: 5, start: '2026-07-30T08:00:00Z' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceName, 'unknown');
});

test('null, undefined and non-arrays return empty', () => {
  assert.deepEqual(bucketByDayAndSource(null), []);
  assert.deepEqual(bucketByDayAndSource(undefined), []);
  assert.deepEqual(bucketByDayAndSource([] as RawSample[]), []);
  assert.deepEqual(bucketByDayAndSource('nope' as any), []);
});

test('an end date earlier than the start does not corrupt the bucket span', () => {
  const out = bucketByDayAndSource([
    { value: 1, start: '2026-07-30T10:00:00Z', end: '2026-07-30T09:00:00Z', sourceName: 'W' },
  ]);
  assert.ok(out[0].endDate >= out[0].startDate || out[0].endDate === '2026-07-30T09:00:00Z');
  assert.equal(out.length, 1);
});


// ---------------------------------------------------------------------------
// The key the native bridge ACTUALLY uses.
//
// react-native-health's index.d.ts types getSamples as HealthValue{value}, but
// RCTAppleHealthKit+Queries.m writes `quantity` (:371) — or `distance` (:373)
// for mile/metre units — and only the quantity-sample path used by HRV writes
// `value` (:264). Reading `value` alone therefore zeroed every step and
// energy bucket while HRV kept working, with no error anywhere. These tests
// exist so that never silently regresses again.

test('quantity is read — the key getSamples actually returns for steps', () => {
  const out = bucketByDayAndSource([
    { quantity: 1200, start: '2026-08-01T08:00:00Z', end: '2026-08-01T09:00:00Z', sourceName: 'iPhone' },
    { quantity: 800,  start: '2026-08-01T18:00:00Z', end: '2026-08-01T19:00:00Z', sourceName: 'iPhone' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 2000);
});

test('distance is read — the key used for mile and metre units', () => {
  const out = bucketByDayAndSource([
    { distance: 5.5, start: '2026-08-01T08:00:00Z', end: '2026-08-01T09:00:00Z', sourceName: 'Watch' },
  ]);
  assert.equal(out[0].value, 5.5);
});

test('value still wins when present, so the HRV path is untouched', () => {
  const out = bucketByDayAndSource([
    { value: 42, quantity: 999, start: '2026-08-01T08:00:00Z', sourceName: 'Watch' },
  ]);
  assert.equal(out[0].value, 42);
});

test('quantity is scaled like value — gram calories become kcal', () => {
  const out = bucketByDayAndSource(
    [{ quantity: 450_000, start: '2026-08-01T08:00:00Z', sourceName: 'Watch' }],
    SAMPLE_UNITS.ActiveEnergyBurned.scale,
  );
  assert.equal(out[0].value, 450);
});

test('a sample with no magnitude under any key counts as zero, never NaN', () => {
  const out = bucketByDayAndSource([
    { start: '2026-08-01T08:00:00Z', sourceName: 'Watch' } as any,
  ]);
  assert.equal(out[0].value, 0);
  assert.ok(Number.isFinite(out[0].value));
});


// ---------------------------------------------------------------------------
// Sleep staging. getSleepSamples returns STRINGS, not the HKCategoryValue enum
// (RCTAppleHealthKit+Queries.m:612-643). Comparing them to 1/3/4/5 is always
// false, which zeroed sleep on every device until this was found.

test('the strings the bridge actually returns are recognised as sleep', () => {
  for (const v of ['ASLEEP', 'CORE', 'DEEP', 'REM']) {
    assert.equal(classifySleepSample(v).asleep, true, `${v} should count as sleep`);
  }
});

test('in-bed and awake are NOT sleep', () => {
  assert.equal(classifySleepSample('INBED').asleep, false);
  assert.equal(classifySleepSample('AWAKE').asleep, false);
  assert.equal(classifySleepSample('UNKNOWN').asleep, false);
});

test('deep and REM are flagged separately AND counted in the total', () => {
  const deep = classifySleepSample('DEEP');
  assert.deepEqual(deep, { asleep: true, deep: true, rem: false });
  const rem = classifySleepSample('REM');
  assert.deepEqual(rem, { asleep: true, deep: false, rem: true });
});

test('the numeric enum still works, so a future bridge cannot re-zero sleep', () => {
  assert.equal(classifySleepSample(1).asleep, true);   // ASLEEP
  assert.equal(classifySleepSample(3).asleep, true);   // CORE
  assert.equal(classifySleepSample(4).deep, true);     // DEEP
  assert.equal(classifySleepSample(5).rem, true);      // REM
  assert.equal(classifySleepSample(0).asleep, false);  // INBED
  assert.equal(classifySleepSample(2).asleep, false);  // AWAKE
});

test('casing and junk are handled without throwing', () => {
  assert.equal(classifySleepSample('deep').deep, true);
  assert.equal(classifySleepSample(null).asleep, false);
  assert.equal(classifySleepSample(undefined).asleep, false);
  assert.equal(classifySleepSample({}).asleep, false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
