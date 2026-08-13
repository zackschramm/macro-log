/**
 * Single-discipline event fuelling tests.  Run with:  npm test
 *
 * The safety-critical property under test is that the prescribed rate NEVER
 * exceeds the trained tolerance — unlike the triathlon engine, no discipline
 * factor is allowed to push past the cap, because there is one rate for the
 * whole event.
 */
import assert from 'node:assert/strict';
import {
  buildEventPlan, DISCIPLINE_RATE_FACTOR, EVENT_DISCIPLINES,
  ALTITUDE_FLUID_THRESHOLD_M, HIGH_ALTITUDE_THRESHOLD_M,
  ALTITUDE_FLUID_MULTIPLIER, UNACCUSTOMED_ALTITUDE_GAP_M,
  MAX_CREDIBLE_ALTITUDE_M, SOLID_FOOD_HOURS,
  type EventDiscipline, type EventPlan,
} from '../eventFueling';
import { MIXED_CARB_THRESHOLD_G_PER_H } from '../raceFueling';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e: any) { failed++; console.log(`✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const between = (v: number, lo: number, hi: number, label = '') =>
  assert.ok(v >= lo && v <= hi, `${label} ${v} not in [${lo}, ${hi}]`);

/** A well-trained athlete on a road bike unless a test says otherwise. */
const base = (over: Partial<Parameters<typeof buildEventPlan>[0]> = {}) =>
  buildEventPlan({
    discipline: 'road', targetHours: 10.5, weightKg: 72,
    trainedCarbTolerance: 120, ...over,
  });

const allFinite = (p: EventPlan) => {
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} is ${v}`);
  }
};

console.log('\nCarb rate by duration and discipline');

test('a sub-hour event needs no in-race carbohydrate', () => {
  assert.equal(base({ targetHours: 0.75 }).carbRateGPerH, 0);
});

test('rates track the published bands, scaled by discipline', () => {
  between(base({ targetHours: 1.5 }).carbRateGPerH, 30, 60, '1.5 h road');
  between(base({ targetHours: 2.5 }).carbRateGPerH, 60, 90, '2.5 h road');
  between(base({ targetHours: 11 }).carbRateGPerH, 90, 120, '11 h road');
});

test('run < hike < mtb < road at the same duration', () => {
  const rate = (d: EventDiscipline) => base({ discipline: d }).carbRateGPerH;
  assert.ok(rate('run') < rate('hike'), 'run should sit below hike');
  assert.ok(rate('hike') < rate('mtb'), 'hike should sit below mtb');
  assert.ok(rate('mtb') < rate('road'), 'mtb should sit below road');
});

test('the factors themselves match the design', () => {
  assert.equal(DISCIPLINE_RATE_FACTOR.road, 1.05);
  assert.equal(DISCIPLINE_RATE_FACTOR.mtb, 1.0);
  assert.equal(DISCIPLINE_RATE_FACTOR.hike, 0.9);
  assert.equal(DISCIPLINE_RATE_FACTOR.run, 0.75);
});

console.log('\nThe trained-tolerance cap');

test('an untrained gut caps the plan — the whole point', () => {
  const p = base({ trainedCarbTolerance: 60 });
  assert.equal(p.limitedByTolerance, true);
  assert.equal(p.carbRateGPerH, 60);
});

test('the cap is NEVER exceeded, for any discipline or tolerance', () => {
  for (const d of EVENT_DISCIPLINES) {
    for (const tol of [20, 45, 60, 61, 79.5, 90, 105, 110]) {
      for (const h of [1.5, 2.5, 6, 10.5, 24]) {
        const p = buildEventPlan({
          discipline: d, targetHours: h, weightKg: 72, trainedCarbTolerance: tol,
        });
        assert.ok(p.carbRateGPerH <= tol, `${d} ${h}h @ ${tol}: got ${p.carbRateGPerH}`);
      }
    }
  }
});

test('the cap is explained, not silent', () => {
  const p = base({ trainedCarbTolerance: 60 });
  assert.ok(p.notes.some(n => /trained/i.test(n)), 'no note about the cap');
});

test('no tolerance set falls back to the guideline rate', () => {
  const p = base({ trainedCarbTolerance: null });
  assert.equal(p.carbRateGPerH, Math.round(105 * 1.05));
  assert.equal(p.limitedByTolerance, false);
});

console.log('\nAltitude');

test('fluid is raised 10% at the threshold and above, not below', () => {
  const seaLevel = base({ raceAltitudeM: null });
  const justUnder = base({ raceAltitudeM: ALTITUDE_FLUID_THRESHOLD_M - 1 });
  const at = base({ raceAltitudeM: ALTITUDE_FLUID_THRESHOLD_M });
  assert.equal(justUnder.fluidLPerH, seaLevel.fluidLPerH);
  assert.equal(justUnder.altitudeFluidApplied, false);
  assert.equal(at.altitudeFluidApplied, true);
  const expected = Math.round(seaLevel.fluidLPerH * ALTITUDE_FLUID_MULTIPLIER * 100) / 100;
  between(at.fluidLPerH, expected - 0.02, expected + 0.02, 'raised fluid');
});

test('altitude raises sodium along with fluid', () => {
  const lo = base({ raceAltitudeM: 1000 });
  const hi = base({ raceAltitudeM: 3200 });
  assert.ok(hi.sodiumMgPerH > lo.sodiumMgPerH);
});

test('the altitude note appears only from 2,400 m', () => {
  assert.equal(base({ raceAltitudeM: 2000 }).notes.some(n => /altitude/i.test(n)), false);
  assert.ok(base({ raceAltitudeM: 2400 }).notes.some(n => /fuelling by schedule/i.test(n)));
});

test('3,000 m adds the stronger acclimatisation note', () => {
  const mid = base({ raceAltitudeM: 2600 });
  const high = base({ raceAltitudeM: HIGH_ALTITUDE_THRESHOLD_M });
  assert.equal(mid.notes.some(n => /acclimatis/i.test(n)), false);
  assert.ok(high.notes.some(n => /acclimatis/i.test(n)));
});

test('the home-altitude gap is called out when it is 1,500 m or more', () => {
  const flatlander = base({ raceAltitudeM: 3200, homeAltitudeM: 300 });
  const local = base({ raceAltitudeM: 3200, homeAltitudeM: 2400 });
  assert.ok(flatlander.notes.some(n => /above where you live/i.test(n)));
  assert.equal(local.notes.some(n => /above where you live/i.test(n)), false);
});

test('a sea-level home (0 m) still counts as a valid home altitude', () => {
  const p = base({ raceAltitudeM: 3200, homeAltitudeM: 0 });
  assert.ok(p.notes.some(n => /above where you live/i.test(n)));
});

test('feet entered as metres is rejected, not planned for', () => {
  // Leadville's 10,152 ft typed into a metres field.
  const p = base({ raceAltitudeM: 10152 });
  assert.equal(p.altitudeFluidApplied, false);
  assert.equal(p.notes.some(n => /altitude/i.test(n)), false);
  assert.ok(10152 > MAX_CREDIBLE_ALTITUDE_M, 'guard constant must cover this case');
});

console.log('\nDiscipline and duration notes');

test('mtb gets the eating-windows note, road does not', () => {
  const windows = (p: EventPlan) => p.notes.some(n => /eating windows/i.test(n));
  assert.ok(windows(base({ discipline: 'mtb' })));
  assert.equal(windows(base({ discipline: 'road' })), false);
});

test('six hours and up brings solid food into the plan', () => {
  const solid = (p: EventPlan) => p.notes.some(n => /solid food/i.test(n));
  assert.equal(solid(base({ targetHours: 4 })), false);
  assert.ok(solid(base({ targetHours: SOLID_FOOD_HOURS })));
});

test('big vert gets a fuel-by-time note, modest vert does not', () => {
  const byTime = (p: EventPlan) => p.notes.some(n => /by time/i.test(n));
  assert.ok(byTime(base({ vertGainM: 3300 })));
  assert.equal(byTime(base({ vertGainM: 800 })), false);
});

console.log('\nMixed carb sources');

test('rates above 60 g/h require mixed glucose:fructose', () => {
  const p = base({ trainedCarbTolerance: 90 });
  assert.ok(p.carbRateGPerH > MIXED_CARB_THRESHOLD_G_PER_H);
  assert.equal(p.mixedSourceRequired, true);
  assert.ok(p.notes.some(n => n.includes('glucose:fructose')));
});

test('no false positive when the capped rate sits at or under 60', () => {
  const p = base({ trainedCarbTolerance: 55 });
  assert.equal(p.mixedSourceRequired, false);
  assert.equal(p.notes.some(n => n.includes('glucose:fructose')), false);
});

console.log('\nFluid, heat and totals');

test('heat raises fluid and sodium 25%', () => {
  const cool = base({ sweatRateLPerH: 1 });
  const hot = base({ sweatRateLPerH: 1, hotRace: true });
  assert.ok(hot.fluidLPerH > cool.fluidLPerH);
  assert.ok(hot.totalSodiumMg > cool.totalSodiumMg);
  assert.ok(hot.notes.some(n => /heat/i.test(n)));
});

test('missing sweat rate falls back and says so', () => {
  const p = base({ sweatRateLPerH: null });
  assert.ok(p.fluidLPerH > 0);
  assert.ok(p.notes.some(n => /sweat-rate test/i.test(n)));
});

test('an impossible sweat rate is treated as unset, not obeyed', () => {
  const p = base({ sweatRateLPerH: 9 });
  assert.equal(p.fluidLPerH, base({ sweatRateLPerH: null }).fluidLPerH);
  assert.ok(p.notes.some(n => /sweat-rate test/i.test(n)));
});

test('totals are the per-hour numbers times the hours', () => {
  const p = base({ targetHours: 8, sweatRateLPerH: 1.2, raceAltitudeM: 3200 });
  assert.equal(p.totalCarbG, Math.round(p.carbRateGPerH * p.totalHours));
  assert.equal(p.totalFluidL, Math.round(p.fluidLPerH * p.totalHours * 10) / 10);
  assert.equal(p.totalSodiumMg, Math.round(p.sodiumMgPerH * p.totalHours));
});

test('carb loading appears for long events and scales off weight', () => {
  const p = base({ targetHours: 10.5, weightKg: 70 });
  assert.ok(p.carbLoad, 'expected a carb load for a 10.5 h event');
  between(p.carbLoad!.gPerKg, 10, 12, 'g/kg');
  assert.equal(p.carbLoad!.totalG, Math.round(p.carbLoad!.gPerKg * 70));
});

console.log('\nJunk input');

test('zero or negative hours return an empty plan, never NaN', () => {
  for (const h of [0, -3, NaN, Infinity * -1]) {
    const p = buildEventPlan({
      discipline: 'mtb', targetHours: h, weightKg: 72, trainedCarbTolerance: 90,
    });
    assert.equal(p.totalCarbG, 0);
    assert.equal(p.totalHours, 0);
    allFinite(p);
  }
});

test('zero weight still plans fuel, just without a carb load', () => {
  const p = base({ weightKg: 0 });
  assert.ok(p.carbRateGPerH > 0);
  assert.equal(p.carbLoad, null);
  allFinite(p);
});

test('absurd hours clamp instead of extrapolating', () => {
  const p = base({ targetHours: 500 });
  assert.ok(p.totalHours <= 48, `clamped to ${p.totalHours}`);
  allFinite(p);
});

test('every field survives an all-junk input', () => {
  const p = buildEventPlan({
    discipline: 'x' as any, targetHours: -1, weightKg: NaN,
    trainedCarbTolerance: -5, sweatRateLPerH: NaN,
    raceAltitudeM: -100, homeAltitudeM: NaN, vertGainM: -50,
  });
  allFinite(p);
  assert.equal(p.totalCarbG, 0);
});

console.log('\nThe race this was built for');

test('Leadville Trail 100 MTB: capped rate, altitude fluid, the right notes', () => {
  const p = buildEventPlan({
    discipline: 'mtb', targetHours: 10.5, weightKg: 78,
    trainedCarbTolerance: 90, raceAltitudeM: 3200, homeAltitudeM: 1600,
    vertGainM: 3350,
  });
  assert.equal(p.carbRateGPerH, 90, 'tolerance beats the 105 guideline');
  assert.equal(p.limitedByTolerance, true);
  assert.equal(p.mixedSourceRequired, true);
  assert.equal(p.altitudeFluidApplied, true);
  between(p.totalCarbG, 900, 1000, 'total carbs');
  assert.ok(p.notes.some(n => /fuelling by schedule/i.test(n)), 'altitude note');
  assert.ok(p.notes.some(n => /acclimatis/i.test(n)), '3000 m note');
  assert.ok(p.notes.some(n => /above where you live/i.test(n)), 'home-gap note');
  assert.ok(p.notes.some(n => /eating windows/i.test(n)), 'mtb note');
  assert.ok(p.notes.some(n => /solid food/i.test(n)), 'ultra-duration note');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
