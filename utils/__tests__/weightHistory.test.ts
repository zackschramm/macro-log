/**
 * Weight history merge tests.  Run with:  npm test
 *
 * Covers the dedupe/priority logic that unifies the three weight tables.
 * getWeightHistory() itself needs Supabase, so the pure parts are exported
 * separately and tested here.
 */
import assert from 'node:assert/strict';
import { dedupeByDate, toWeighIns, latestWeight, WeightEntry } from '../weightHistory';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

const e = (date: string, weight: number, source: WeightEntry['source']): WeightEntry =>
  ({ date, weight, source });

console.log('\nMerging the three weight sources');

test('entries from different days all survive', () => {
  const out = dedupeByDate([
    e('2026-07-01', 200, 'manual'),
    e('2026-07-02', 199, 'measurements'),
    e('2026-07-03', 198, 'inbody'),
  ]);
  assert.equal(out.length, 3);
});

test('output is sorted oldest first regardless of input order', () => {
  const out = dedupeByDate([
    e('2026-07-03', 198, 'manual'),
    e('2026-07-01', 200, 'manual'),
    e('2026-07-02', 199, 'manual'),
  ]);
  assert.deepEqual(out.map(x => x.date), ['2026-07-01', '2026-07-02', '2026-07-03']);
});

test('InBody wins over both other sources on the same day', () => {
  const out = dedupeByDate([
    e('2026-07-01', 200, 'manual'),
    e('2026-07-01', 201, 'measurements'),
    e('2026-07-01', 202, 'inbody'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'inbody');
  assert.equal(out[0].weight, 202);
});

test('measurements beats a manual Stats entry on the same day', () => {
  const out = dedupeByDate([
    e('2026-07-01', 200, 'manual'),
    e('2026-07-01', 205, 'measurements'),
  ]);
  assert.equal(out[0].source, 'measurements');
  assert.equal(out[0].weight, 205);
});

test('priority does not depend on input order', () => {
  const a = dedupeByDate([e('2026-07-01', 202, 'inbody'), e('2026-07-01', 200, 'manual')]);
  const b = dedupeByDate([e('2026-07-01', 200, 'manual'), e('2026-07-01', 202, 'inbody')]);
  assert.equal(a[0].weight, b[0].weight);
  assert.equal(a[0].weight, 202);
});

test('empty input gives empty output', () => {
  assert.deepEqual(dedupeByDate([]), []);
});

console.log('\nHelpers');

test('toWeighIns drops the source tag and keeps order', () => {
  const out = toWeighIns(dedupeByDate([
    e('2026-07-02', 199, 'manual'),
    e('2026-07-01', 200, 'inbody'),
  ]));
  assert.deepEqual(out, [
    { date: '2026-07-01', weight: 200 },
    { date: '2026-07-02', weight: 199 },
  ]);
});

test('latestWeight returns the newest, not the largest', () => {
  const out = dedupeByDate([
    e('2026-07-01', 220, 'manual'),
    e('2026-07-05', 210, 'manual'),
    e('2026-07-03', 215, 'manual'),
  ]);
  assert.equal(latestWeight(out), 210);
});

test('latestWeight on empty is null', () => {
  assert.equal(latestWeight([]), null);
});

// This is the scenario that was broken: a user logs weight on the Stats tab,
// then later logs one in Body Measurements. Before the merge, the trend only
// ever saw one of the two.
test('a Stats entry and a Measurements entry both reach the trend', () => {
  const merged = toWeighIns(dedupeByDate([
    e('2026-07-01', 200, 'manual'),
    e('2026-07-08', 197, 'measurements'),
    e('2026-07-15', 195, 'manual'),
  ]));
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map(m => m.weight), [200, 197, 195]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
