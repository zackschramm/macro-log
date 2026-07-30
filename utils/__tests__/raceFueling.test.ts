/**
 * Race-day fuelling tests.  Run with:  npm test
 *
 * The safety-critical property under test is that the plan NEVER prescribes a
 * carbohydrate rate the athlete has not trained, no matter what the guideline
 * for the distance says.
 */
import assert from 'node:assert/strict';
import {
  baseCarbRate, needsMixedCarbSource, buildRacePlan, estimateSplits,
  sweatRateLPerH, planGutTraining, shouldCarbLoad, carbLoadGPerKg,
  TRI_COURSES, MIXED_CARB_THRESHOLD_G_PER_H, FLUID_REPLACEMENT_FRACTION,
  type LegSplit,
} from '../raceFueling';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e: any) { failed++; console.log(`✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const between = (v: number, lo: number, hi: number, label = '') =>
  assert.ok(v >= lo && v <= hi, `${label} ${v} not in [${lo}, ${hi}]`);

console.log('\nCarb rate by duration');

test('sub-hour races need no in-race carbohydrate', () => {
  assert.equal(baseCarbRate(0.75), 0);
});

test('rates match the published bands', () => {
  between(baseCarbRate(1.5), 30, 60, '1.5 h');
  between(baseCarbRate(2.5), 60, 90, '2.5 h');
  between(baseCarbRate(11), 90, 120, 'Ironman');
});

test('rate is non-decreasing with duration', () => {
  let prev = -1;
  for (let h = 0.5; h <= 16; h += 0.5) {
    const r = baseCarbRate(h);
    assert.ok(r >= prev, `dropped at ${h} h`);
    prev = r;
  }
});

test('mixed glucose:fructose kicks in above the transport ceiling', () => {
  assert.equal(needsMixedCarbSource(MIXED_CARB_THRESHOLD_G_PER_H), false);
  assert.equal(needsMixedCarbSource(MIXED_CARB_THRESHOLD_G_PER_H + 1), true);
});

console.log('\nRace plan');

const imSplits: LegSplit[] = [
  { leg: 'swim', hours: 1.2 },
  { leg: 'bike', hours: 6.0 },
  { leg: 'run', hours: 4.5 },
];

test('a well-trained Ironman athlete gets the full rate', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 110 });
  assert.equal(p.limitedByTolerance, false);
  assert.equal(p.prescribedRateGPerH, 105);
});

test('an untrained gut caps the plan — the whole point', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 60 });
  assert.equal(p.limitedByTolerance, true);
  assert.equal(p.prescribedRateGPerH, 60);
  for (const leg of p.legs) {
    assert.ok(leg.carbRateGPerH <= 60 * 1.05 + 1, `${leg.leg} exceeded tolerance`);
  }
});

test('the cap is explained, not silent', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 60 });
  assert.ok(p.notes.some(n => /trained/i.test(n)), 'no note about the cap');
});

test('nothing is consumed on the swim', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 100 });
  const swim = p.legs.find(l => l.leg === 'swim')!;
  assert.equal(swim.carbG, 0);
  assert.equal(swim.fluidL, 0);
});

test('the bike carries a higher rate than the run', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 100 });
  const bike = p.legs.find(l => l.leg === 'bike')!;
  const run = p.legs.find(l => l.leg === 'run')!;
  assert.ok(bike.carbRateGPerH > run.carbRateGPerH, 'fuel the bike, save the run');
});

test('totals are the sum of the legs', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 100 });
  assert.equal(p.totalCarbG, p.legs.reduce((s, l) => s + l.carbG, 0));
  assert.equal(p.totalSodiumMg, p.legs.reduce((s, l) => s + l.sodiumMg, 0));
});

test('an Ironman plan lands at a realistic total carb load', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 100 });
  // ~10.5 h of racing at 75-105 g/h, nothing on the swim
  between(p.totalCarbG, 700, 1200, 'total carbs');
});

test('fluid replaces most but deliberately not all of sweat losses', () => {
  const p = buildRacePlan({
    splits: imSplits, massKg: 72, trainedToleranceGPerH: 100, sweatRateLPerH: 1.0,
  });
  const ridingAndRunning = 10.5;
  between(p.totalFluidL, ridingAndRunning * FLUID_REPLACEMENT_FRACTION - 0.2,
                          ridingAndRunning * FLUID_REPLACEMENT_FRACTION + 0.2, 'total fluid');
  assert.ok(p.totalFluidL < ridingAndRunning, 'must not replace 100% of losses');
});

test('heat raises fluid and sodium', () => {
  const cool = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 100, sweatRateLPerH: 1 });
  const hot = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 100, sweatRateLPerH: 1, hot: true });
  assert.ok(hot.totalFluidL > cool.totalFluidL);
  assert.ok(hot.totalSodiumMg > cool.totalSodiumMg);
});

test('missing sweat rate falls back and says so', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 100 });
  assert.ok(p.totalFluidL > 0);
  assert.ok(p.notes.some(n => /sweat-rate test/i.test(n)));
});

test('caffeine is 3-6 mg/kg', () => {
  const p = buildRacePlan({ splits: imSplits, massKg: 70, trainedToleranceGPerH: 100 });
  assert.equal(p.caffeineMg.min, 210);
  assert.equal(p.caffeineMg.max, 420);
});

test('a sprint needs far less than an Ironman', () => {
  const sprint = buildRacePlan({
    splits: estimateSplits('sprint', 1.4), massKg: 72, trainedToleranceGPerH: 100,
  });
  const full = buildRacePlan({ splits: imSplits, massKg: 72, trainedToleranceGPerH: 100 });
  assert.ok(sprint.totalCarbG < full.totalCarbG / 8, 'sprint should be trivially fuelled');
});

test('empty or junk input does not throw', () => {
  const p = buildRacePlan({ splits: [], massKg: 0, trainedToleranceGPerH: 0 });
  assert.equal(p.totalCarbG, 0);
  assert.equal(p.totalHours, 0);
});

console.log('\nSplit estimation');

test('estimated splits sum to the target finish time', () => {
  const splits = estimateSplits('full', 11);
  const total = splits.reduce((s, x) => s + x.hours, 0);
  assert.ok(Math.abs(total - 11) < 0.01, `summed to ${total}`);
});

test('the bike is the longest leg at every distance', () => {
  for (const d of ['sprint', 'olympic', 'half', 'full'] as const) {
    const splits = estimateSplits(d, TRI_COURSES[d].typicalHours[0]);
    const bike = splits.find(s => s.leg === 'bike')!.hours;
    for (const s of splits) {
      if (s.leg !== 'bike') assert.ok(bike > s.hours, `${d}: bike not longest`);
    }
  }
});

console.log('\nSweat rate test');

test('1 kg lost plus 1 L drunk over an hour is 2 L/h', () => {
  assert.equal(sweatRateLPerH({ massBeforeKg: 72, massAfterKg: 71, fluidDrunkL: 1, durationMin: 60 }), 2);
});

test('drinking nothing still measures correctly', () => {
  assert.equal(sweatRateLPerH({ massBeforeKg: 72, massAfterKg: 71.2, fluidDrunkL: 0, durationMin: 60 }), 0.8);
});

test('a 90-minute test is scaled to the hour', () => {
  assert.equal(sweatRateLPerH({ massBeforeKg: 72, massAfterKg: 70.5, fluidDrunkL: 0, durationMin: 90 }), 1);
});

test('gaining weight returns null rather than a negative rate', () => {
  assert.equal(sweatRateLPerH({ massBeforeKg: 70, massAfterKg: 71, fluidDrunkL: 0, durationMin: 60 }), null);
});

test('a physiologically impossible result is rejected as a typo', () => {
  // 7 kg in an hour — almost certainly lb entered as kg
  assert.equal(sweatRateLPerH({ massBeforeKg: 77, massAfterKg: 70, fluidDrunkL: 0, durationMin: 60 }), null);
});

test('missing fields return null, not NaN', () => {
  assert.equal(sweatRateLPerH({ massBeforeKg: 0, massAfterKg: 70, fluidDrunkL: 0, durationMin: 60 }), null);
});

console.log('\nGut training');

test('60 to 110 g/h takes about 13 weeks', () => {
  const p = planGutTraining(60, 110);
  between(p.weeksNeeded, 12, 14, 'weeks');
});

test('an 8-week runway caps the achievable rate honestly', () => {
  const p = planGutTraining(60, 110, 8);
  assert.equal(p.achievable, false);
  assert.ok(p.achievableGPerH < 110);
  assert.ok(p.achievableGPerH > 60);
  assert.ok(/trained/i.test(p.note), 'should explain the trade-off');
});

test('the note never leaks a raw float week count', () => {
  // Callers pass days/7, so `available` is routinely 6.285714285714286.
  const p = planGutTraining(70, 105, 44 / 7);
  assert.ok(!/\d\.\d{3}/.test(p.note), `float leaked into copy: ${p.note}`);
});

test('a long runway reaches the target', () => {
  const p = planGutTraining(60, 110, 20);
  assert.equal(p.achievable, true);
  assert.equal(p.achievableGPerH, 110);
});

test('steps ramp by 10 g/h and never overshoot', () => {
  const p = planGutTraining(65, 100, 30);
  for (const s of p.steps) assert.ok(s.rateGPerH <= 100, 'overshot target');
  assert.equal(p.steps[p.steps.length - 1].rateGPerH, 100);
  for (let i = 1; i < p.steps.length; i++) {
    assert.ok(p.steps[i].rateGPerH > p.steps[i - 1].rateGPerH, 'non-monotonic');
    assert.ok(p.steps[i].week > p.steps[i - 1].week, 'weeks must advance');
  }
});

test('already at target is not busywork', () => {
  const p = planGutTraining(100, 100, 12);
  assert.equal(p.weeksNeeded, 0);
  assert.equal(p.steps.length, 0);
  assert.equal(p.achievable, true);
});

test('a target below current tolerance is not treated as a gap', () => {
  const p = planGutTraining(110, 90, 12);
  assert.equal(p.weeksNeeded, 0);
  assert.equal(p.achievableGPerH, 90);
});

console.log('\nCarb loading');

test('short races are not worth loading for', () => {
  assert.equal(shouldCarbLoad(1.2), false);
  assert.equal(carbLoadGPerKg(1.2), 0);
});

test('long races load in the 10-12 g/kg band', () => {
  between(carbLoadGPerKg(5), 10, 12, '70.3');
  between(carbLoadGPerKg(11), 10, 12, 'Ironman');
});

test('longer races load harder', () => {
  assert.ok(carbLoadGPerKg(11) >= carbLoadGPerKg(2.5));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
