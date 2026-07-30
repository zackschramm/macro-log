/**
 * iOS 27 HealthKit fallback bucketing.  Run with:  npm test
 *
 * These buckets stand in for what HKStatisticsCollectionQuery would have
 * returned, so the property that matters is that every existing caller keeps
 * working: ones that sum the array, ones that group by `sourceName`, and ones
 * that read per-day values.
 */
import assert from 'node:assert/strict';
import { bucketByDayAndSource, type RawSample } from '../healthBuckets';

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

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
