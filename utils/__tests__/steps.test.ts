/**
 * Daily steps.  Run with:  npm test
 *
 * Build 169 shipped two step bugs, both from summing or mapping samples that
 * HealthKit returns one-per-day-PER-SOURCE:
 *   - the headline added iPhone + Apple Watch together (~2x the real count)
 *   - the 7-day trend emitted two points with the same date
 */
import assert from 'node:assert/strict';
import { stepsByDay, stepsForDay } from '../steps';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
// Deterministic day key — no dependence on the test machine's timezone.
const day = (iso: string) => iso.slice(0, 10);
const S = (value: number, startDate: string, sourceName = 'iPhone') =>
  ({ value, startDate, sourceName });

console.log('\nThe two build-169 bugs');

test('THE DUPLICATION: one day with two sources yields ONE point', () => {
  const out = stepsByDay([
    S(8000, '2026-09-16T12:00:00Z', 'iPhone'),
    S(8200, '2026-09-16T12:00:00Z', "Zack's Apple Watch"),
  ], day);
  assert.equal(out.length, 1, `got ${out.length} entries for one day`);
  assert.equal(out[0].date, '2026-09-16');
});

test('THE DOUBLING: two sources are not added together', () => {
  const out = stepsByDay([
    S(8000, '2026-09-16T12:00:00Z', 'iPhone'),
    S(8200, '2026-09-16T12:00:00Z', "Zack's Apple Watch"),
  ], day);
  assert.equal(out[0].value, 8200, 'best source wins; 16200 would be the old bug');
});

test('the winning source is reported, for the caption', () => {
  const out = stepsByDay([
    S(8000, '2026-09-16T12:00:00Z', 'iPhone'),
    S(8200, '2026-09-16T12:00:00Z', "Zack's Apple Watch"),
  ], day);
  assert.equal(out[0].source, "Zack's Apple Watch");
});

console.log('\nWithin a source, segments DO add up');

test('multiple segments from one source are summed', () => {
  const out = stepsByDay([
    S(3000, '2026-09-16T08:00:00Z', 'iPhone'),
    S(2500, '2026-09-16T13:00:00Z', 'iPhone'),
    S(1500, '2026-09-16T19:00:00Z', 'iPhone'),
  ], day);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 7000);
});

test('segments are summed per source BEFORE sources are compared', () => {
  // Watch wins on total, not on any single segment.
  const out = stepsByDay([
    S(9000, '2026-09-16T12:00:00Z', 'iPhone'),
    S(5000, '2026-09-16T08:00:00Z', 'Watch'),
    S(5000, '2026-09-16T18:00:00Z', 'Watch'),
  ], day);
  assert.equal(out[0].value, 10000);
  assert.equal(out[0].source, 'Watch');
});

console.log('\nShape guarantees');

test('every date in the result is unique', () => {
  const raw = [];
  for (const d of ['14', '15', '16']) {
    for (const src of ['iPhone', 'Watch', 'WHOOP']) {
      raw.push(S(5000, `2026-09-${d}T12:00:00Z`, src));
    }
  }
  const out = stepsByDay(raw, day);
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map(o => o.date)).size, 3);
});

test('results are sorted ascending so the chart never draws backwards', () => {
  const out = stepsByDay([
    S(100, '2026-09-16T12:00:00Z'),
    S(100, '2026-09-14T12:00:00Z'),
    S(100, '2026-09-15T12:00:00Z'),
  ], day);
  assert.deepEqual(out.map(o => o.date), ['2026-09-14', '2026-09-15', '2026-09-16']);
});

test('a single filtered source behaves exactly as a plain sum', () => {
  // When the user HAS set a source preference, filterBySource returns one
  // source and the new path must not change the old correct answer.
  const out = stepsByDay([
    S(3000, '2026-09-16T08:00:00Z', 'WHOOP'),
    S(4000, '2026-09-16T18:00:00Z', 'WHOOP'),
  ], day);
  assert.equal(out[0].value, 7000);
});

console.log('\nJunk input');

test('undateable, negative, non-numeric and null samples are dropped', () => {
  const out = stepsByDay([
    S(5000, '2026-09-16T12:00:00Z', 'iPhone'),
    { value: 999, startDate: null, sourceName: 'x' } as any,
    { value: -500, startDate: '2026-09-16T12:00:00Z', sourceName: 'y' } as any,
    { value: 'abc', startDate: '2026-09-16T12:00:00Z', sourceName: 'z' } as any,
    { value: 100, startDate: 'not-a-date', sourceName: 'w' } as any,
  ], (iso) => (iso === 'not-a-date' ? '' : iso.slice(0, 10)));
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 5000);
});

test('empty and null input do not throw', () => {
  assert.deepEqual(stepsByDay([], day), []);
  assert.deepEqual(stepsByDay(null, day), []);
  assert.deepEqual(stepsByDay(undefined as any, day), []);
});

test('a missing sourceName does not collapse distinct days', () => {
  const out = stepsByDay([
    { value: 100, startDate: '2026-09-15T12:00:00Z' } as any,
    { value: 200, startDate: '2026-09-16T12:00:00Z' } as any,
  ], day);
  assert.equal(out.length, 2);
});

console.log('\nstepsForDay()');

test('picks the named day, or null', () => {
  const raw = [S(5000, '2026-09-15T12:00:00Z'), S(7000, '2026-09-16T12:00:00Z')];
  assert.equal(stepsForDay(raw, '2026-09-16', day)?.value, 7000);
  assert.equal(stepsForDay(raw, '2026-09-01', day), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
