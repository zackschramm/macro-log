/**
 * Weight trend regression tests.  Run with:  npm run test:trend
 *
 * The whole point of this module is that it must stay calm when the raw data
 * doesn't, so most of these feed it deliberately noisy or awkward input and
 * assert the trend stays sane.
 */
import assert from 'node:assert/strict';
import {
  WeighIn, smoothWeights, analyzeWeightTrend, describeTrend,
  explainDeviation, detectMilestones,
} from '../weightTrend';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

/** Build a series starting `days` ago, one reading per day. */
function series(weights: number[], startDaysAgo = weights.length - 1): WeighIn[] {
  const out: WeighIn[] = [];
  for (let i = 0; i < weights.length; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (startDaysAgo - i));
    out.push({ date: d.toISOString().slice(0, 10), weight: weights[i] });
  }
  return out;
}

/** Linear loss with alternating water-weight noise on top. */
function noisyLoss(days: number, start: number, lbPerDay: number, noise = 2) {
  return Array.from({ length: days }, (_, i) =>
    start - i * lbPerDay + (i % 2 === 0 ? noise : -noise));
}

console.log('\nSmoothing');

test('empty input returns empty, never throws', () => {
  assert.deepEqual(smoothWeights([]), []);
  const t = analyzeWeightTrend([]);
  assert.equal(t.current, null);
  assert.equal(t.hasEnoughData, false);
});

test('single reading: trend equals the reading', () => {
  const p = smoothWeights(series([180]));
  assert.equal(p.length, 1);
  assert.equal(p[0].trend, 180);
});

test('smoothing damps noise far below the raw swing', () => {
  const raw = noisyLoss(30, 200, 0.2, 3);   // ±3 lb daily swing
  const pts = smoothWeights(series(raw));
  const trendVals = pts.slice(10).map(p => p.trend);
  // Consecutive trend moves should be much smaller than the 6 lb raw swings.
  for (let i = 1; i < trendVals.length; i++) {
    assert.ok(Math.abs(trendVals[i] - trendVals[i - 1]) < 1.5,
      `trend jumped ${Math.abs(trendVals[i] - trendVals[i - 1]).toFixed(2)} lb in one day`);
  }
});

test('unsorted input is handled (dates sorted internally)', () => {
  const s = series([200, 199, 198, 197]);
  const shuffled = [s[2], s[0], s[3], s[1]];
  assert.deepEqual(
    smoothWeights(shuffled).map(p => p.date),
    smoothWeights(s).map(p => p.date)
  );
});

test('junk readings are dropped, not smoothed in', () => {
  const s = series([200, 199, 198]);
  const dirty = [...s, { date: s[0].date, weight: 0 }, { date: s[1].date, weight: NaN }];
  assert.equal(smoothWeights(dirty).length, 3);
});

test('a long gap gives the new reading more weight than a same-day one', () => {
  const near = smoothWeights([
    { date: '2026-01-01', weight: 200 }, { date: '2026-01-02', weight: 190 },
  ]);
  const far = smoothWeights([
    { date: '2026-01-01', weight: 200 }, { date: '2026-03-01', weight: 190 },
  ]);
  assert.ok(far[1].trend < near[1].trend,
    'reading after a 2-month gap should pull the trend further');
});

console.log('\nRate and direction');

test('steady 1 lb/week loss is detected within 0.2 lb/week', () => {
  const t = analyzeWeightTrend(series(
    Array.from({ length: 42 }, (_, i) => 200 - i * (1 / 7))
  ));
  assert.ok(t.hasEnoughData);
  assert.equal(t.direction, 'losing');
  assert.ok(Math.abs(t.ratePerWeek! + 1) < 0.2, `got ${t.ratePerWeek} lb/week`);
});

test('rate survives heavy daily noise', () => {
  const t = analyzeWeightTrend(series(noisyLoss(42, 200, 1 / 7, 3)));
  assert.equal(t.direction, 'losing');
  assert.ok(Math.abs(t.ratePerWeek! + 1) < 0.35, `got ${t.ratePerWeek} lb/week`);
});

test('flat weight reads as holding, not a spurious direction', () => {
  const t = analyzeWeightTrend(series(
    Array.from({ length: 30 }, (_, i) => 180 + (i % 2 === 0 ? 1.5 : -1.5))
  ));
  assert.equal(t.direction, 'holding');
});

test('gaining is detected and signed positive', () => {
  const t = analyzeWeightTrend(series(
    Array.from({ length: 42 }, (_, i) => 160 + i * (0.5 / 7))
  ));
  assert.equal(t.direction, 'gaining');
  assert.ok(t.ratePerWeek! > 0);
});

test('refuses to claim a rate from too little data', () => {
  const t = analyzeWeightTrend(series([200, 199, 198]));
  assert.equal(t.hasEnoughData, false);
  assert.equal(t.ratePerWeek, null);
  assert.match(describeTrend(t), /more weigh-in|Keep logging/);
});

test('all readings on one day does not divide by zero', () => {
  const same = [
    { date: '2026-05-01', weight: 200 }, { date: '2026-05-01', weight: 201 },
    { date: '2026-05-01', weight: 199 }, { date: '2026-05-01', weight: 200 },
  ];
  const t = analyzeWeightTrend(same);
  assert.ok(t.ratePerWeek === null || Number.isFinite(t.ratePerWeek));
  assert.equal(t.direction, 'holding');
});

test('window trims old points but trend enters warmed up', () => {
  const long = series(Array.from({ length: 200 }, (_, i) => 250 - i * 0.1));
  const t = analyzeWeightTrend(long, 30);
  assert.ok(t.points.length < 40, `window not applied (${t.points.length} points)`);
  // If the window reset the trend to a raw value it would sit far off; it
  // should be within a pound or so of the raw reading at that point.
  assert.ok(Math.abs(t.points[0].trend - t.points[0].raw) < 3);
});

console.log('\nDeviation messaging (the anti-quitting feature)');

test('a big overnight jump is explained as water, not fat', () => {
  const w = series([...Array.from({ length: 20 }, (_, i) => 200 - i * 0.1), 203]);
  const t = analyzeWeightTrend(w);
  const msg = explainDeviation(t);
  assert.ok(msg, 'expected an explanation for a 3 lb spike');
  assert.match(msg!, /water/i);
  assert.ok(t.deviation! > 1.5, `deviation was ${t.deviation}`);
});

test('a reading near the trend gets no message (no crying wolf)', () => {
  const t = analyzeWeightTrend(series(Array.from({ length: 20 }, (_, i) => 200 - i * 0.1)));
  assert.equal(explainDeviation(t), null);
});

test('describeTrend reads naturally', () => {
  const t = analyzeWeightTrend(series(Array.from({ length: 42 }, (_, i) => 200 - i * (1 / 7))));
  const s = describeTrend(t);
  assert.match(s, /Down [\d.]+ lbs\/week over \d+ weeks?/);
});

console.log('\nMilestones');

test('nothing is celebrated without enough data', () => {
  assert.deepEqual(detectMilestones(analyzeWeightTrend(series([200, 199]))), []);
});

test('5 lb of smoothed change earns a review-worthy milestone', () => {
  const t = analyzeWeightTrend(series(Array.from({ length: 60 }, (_, i) => 200 - i * 0.15)));
  const ms = detectMilestones(t);
  const change = ms.find(m => m.kind === 'weight_change');
  assert.ok(change, 'expected a weight_change milestone');
  assert.ok(change!.reviewWorthy);
  assert.match(change!.key, /^weight_down_\d+lbs$/);
});

test('milestone keys are stable so nothing is celebrated twice', () => {
  const w = series(Array.from({ length: 60 }, (_, i) => 200 - i * 0.15));
  const a = detectMilestones(analyzeWeightTrend(w)).map(m => m.key);
  const b = detectMilestones(analyzeWeightTrend(w)).map(m => m.key);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, 'duplicate keys in one run');
});

test('milestones fire on the trend, not a lucky raw reading', () => {
  // Trend only moves ~1 lb, but one raw reading dips 6 lb.
  const w = series([...Array.from({ length: 30 }, (_, i) => 200 - i * 0.03), 194]);
  const ms = detectMilestones(analyzeWeightTrend(w));
  assert.equal(ms.find(m => m.kind === 'weight_change'), undefined,
    'a single low reading should not trigger a 5 lb milestone');
});

test('goal reached fires only when the trend crosses it', () => {
  const t = analyzeWeightTrend(series(Array.from({ length: 60 }, (_, i) => 200 - i * 0.15)));
  const hit = detectMilestones(t, { goalWeight: 195, goalDirection: 'lose' });
  assert.ok(hit.find(m => m.kind === 'goal_reached'));

  const notYet = detectMilestones(t, { goalWeight: 150, goalDirection: 'lose' });
  assert.equal(notYet.find(m => m.kind === 'goal_reached'), undefined);
});

console.log('\nUnit correctness (metric users)');

test('deviation threshold scales with unit — 0.5 kg is worth flagging', () => {
  // ~0.5 kg spike: silent in lbs (below 0.8), flagged in kg (above 0.4)
  const w = series([...Array.from({ length: 20 }, (_, i) => 80 - i * 0.02), 80.5]);
  const t = analyzeWeightTrend(w);
  assert.ok(t.deviation !== null && Math.abs(t.deviation) > 0.4,
    `deviation was ${t.deviation}`);
  assert.ok(explainDeviation(t, 'kg'), 'kg user should get the message');
});

test('deviation copy is neutral — works for gaining as well as cutting', () => {
  const w = series([...Array.from({ length: 20 }, (_, i) => 160 + i * 0.1), 165]);
  const msg = explainDeviation(analyzeWeightTrend(w));
  assert.ok(msg);
  assert.doesNotMatch(msg!, /not fat\b/, 'copy should not assume the user is cutting');
  assert.match(msg!, /water/i);
});

test('milestone step is 2 kg for metric, 5 lbs for imperial', () => {
  // ~3 kg of loss: earns a 2 kg milestone, but 3 lbs would earn nothing
  const kg = analyzeWeightTrend(series(Array.from({ length: 60 }, (_, i) => 80 - i * 0.05)));
  const kgMs = detectMilestones(kg, { unit: 'kg' }).find(m => m.kind === 'weight_change');
  assert.ok(kgMs, 'expected a 2 kg milestone');
  assert.match(kgMs!.title, /kg/);
  assert.match(kgMs!.key, /kg$/);

  // Same ~3 unit drop earns nothing in lbs (step is 5), which is the point.
  const shallow = analyzeWeightTrend(series(Array.from({ length: 60 }, (_, i) => 180 - i * 0.05)));
  assert.equal(
    detectMilestones(shallow, { unit: 'lbs' }).find(m => m.kind === 'weight_change'),
    undefined,
    '3 lbs should not earn a 5 lb milestone'
  );

  const lb = analyzeWeightTrend(series(Array.from({ length: 60 }, (_, i) => 180 - i * 0.12)));
  const lbMs = detectMilestones(lb, { unit: 'lbs' }).find(m => m.kind === 'weight_change');
  assert.ok(lbMs, 'expected a 5 lbs milestone');
  assert.match(lbMs!.title, /lbs/);
});

test('unit is baked into the milestone key so switching units cannot re-celebrate', () => {
  const t = analyzeWeightTrend(series(Array.from({ length: 60 }, (_, i) => 200 - i * 0.15)));
  const inLb = detectMilestones(t, { unit: 'lbs' }).map(m => m.key);
  const inKg = detectMilestones(t, { unit: 'kg' }).map(m => m.key);
  const changeLb = inLb.find(k => k.startsWith('weight_'));
  const changeKg = inKg.find(k => k.startsWith('weight_'));
  assert.notEqual(changeLb, changeKg);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
