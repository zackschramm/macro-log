/**
 * Endurance engine tests.  Run with:  npm test
 *
 * The point of most of these is not "does the arithmetic work" but "does the
 * output land inside the published guideline band for this scenario". A carb
 * curve that computes cleanly and prescribes 4 g/kg for a 6-hour ride is
 * working code and broken advice.
 *
 * Import from the pure modules only — anything that reaches Supabase drags in
 * React Native and esbuild cannot parse its Flow types.
 */
import assert from 'node:assert/strict';
import {
  runEnergyKcal, bikeEnergyFromWorkKcal, metEnergyKcal,
  sessionGrossKcal, sessionNetKcal, dailyNetKcal,
  sessionLoad, dailyLoad, effectiveIntensityWeight,
  dailyEnergy, NEAT_FACTORS, RUN_KCAL_PER_KG_KM, sessionEnergy,
  type Session,
} from '../enduranceEnergy';
import {
  carbTargetGPerKg, allocateEnduranceMacros, energyAvailability,
  minimumSafeCalories, enduranceDayTargets,
  CHO_MIN_G_PER_KG, CHO_MAX_G_PER_KG, CHO_BASE_G_PER_KG, FAT_FLOOR_G_PER_KG,
  ENDURANCE_PROTEIN_FLOOR_G_PER_KG,
  phaseFromRaceDate, daysUntilRace, weeksUntilRace, isCarbLoadWindow,
} from '../enduranceFueling';
import { SPORT_PROFILES, getSportProfile } from '../../constants/sportProfiles';
import { SPORT_MULTIPLIERS, isEnduranceSport } from '../../constants/data';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e: any) { failed++; console.log(`✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const between = (v: number, lo: number, hi: number, label = '') =>
  assert.ok(v >= lo && v <= hi, `${label} ${v} not in [${lo}, ${hi}]`);

const S = (p: Partial<Session> & { discipline: Session['discipline']; durationMin: number }): Session => p as Session;

console.log('\nPer-discipline energy');

test('running costs ~1 kcal per kg per km', () => {
  // 70 kg x 10 km should land near 720 kcal gross.
  between(runEnergyKcal(70, 10), 700, 740, 'run 10k');
});

test('running energy is linear in distance and mass', () => {
  assert.equal(runEnergyKcal(70, 20), runEnergyKcal(70, 10) * 2);
  assert.equal(runEnergyKcal(140, 10), runEnergyKcal(70, 10) * 2);
});

test('climbing adds vertical work on top of flat cost', () => {
  const flat = runEnergyKcal(70, 10);
  const hilly = runEnergyKcal(70, 10, 500);
  // 70 kg lifted 500 m at ~24% efficiency ≈ 340 kcal
  between(hilly - flat, 300, 380, 'climb component');
});

test('1 kJ of bike work is almost exactly 1 kcal burned', () => {
  between(bikeEnergyFromWorkKcal(1000), 980, 1010, '1000 kJ');
});

test('bike energy from power ignores bodyweight (that is the point)', () => {
  // Same ride file, two riders — the work done is the work done.
  const a = sessionGrossKcal(S({ discipline: 'bike', durationMin: 180, workKJ: 2400 }), 60);
  const b = sessionGrossKcal(S({ discipline: 'bike', durationMin: 180, workKJ: 2400 }), 90);
  assert.equal(a, b);
});

test('MET formula matches ACSM', () => {
  // 10 METs, 70 kg, 60 min = 10 x 3.5 x 70 / 200 x 60
  assert.equal(Math.round(metEnergyKcal(10, 70, 60)), 735);
});

test('a 3800 m swim lands in a plausible range', () => {
  // ~70 min of moderate freestyle for a 70 kg athlete
  const kcal = sessionGrossKcal(S({ discipline: 'swim', durationMin: 70, zone: 'z3' }), 70);
  between(kcal, 600, 800, 'IM swim');
});

console.log('\nInput priority');

test('power beats device kcal for cycling', () => {
  const s = S({ discipline: 'bike', durationMin: 120, workKJ: 1800, deviceKcal: 999 });
  between(sessionGrossKcal(s, 70), 1750, 1850, 'power path');
});

test('the wearable beats our distance estimate for running', () => {
  // Priority is power > device > distance > METs. The watch measured this
  // athlete's heart rate against their own profile; our kcal/kg/km constant is
  // a population average. And the athlete can see the watch's number.
  const s = S({ discipline: 'run', durationMin: 60, distanceKm: 12, deviceKcal: 700 });
  const e = sessionEnergy(s, 70, 1700);
  assert.equal(e.source, 'device');
  assert.equal(e.net, 700);
  // ...but the distance-based estimate is still there to compare against.
  between(e.modelNet, 750, 830, 'retained distance estimate');
});

test('distance is used when the wearable reported nothing', () => {
  const s = S({ discipline: 'run', durationMin: 60, distanceKm: 12 });
  const e = sessionEnergy(s, 70, 1700);
  assert.equal(e.source, 'distance');
  between(e.gross, 830, 890, 'distance path');
});

test('device kcal is used when nothing better exists', () => {
  const s = S({ discipline: 'other', durationMin: 45, deviceKcal: 420 });
  assert.equal(sessionEnergy(s, 70, 0).net, 420);
});

test('METs are the last resort, never a crash', () => {
  const s = S({ discipline: 'bike', durationMin: 60 });
  assert.ok(sessionGrossKcal(s, 70) > 0);
});

test('junk input returns zero rather than NaN', () => {
  assert.equal(sessionGrossKcal(S({ discipline: 'run', durationMin: 0 }), 70), 0);
  assert.equal(sessionGrossKcal(S({ discipline: 'run', durationMin: 60 }), 0), 0);
  assert.ok(Number.isFinite(sessionGrossKcal(S({ discipline: 'run', durationMin: 60, distanceKm: NaN }), 70)));
});

console.log('\nWearable-first, computed post-workout');

test('the wearable figure is preferred over our own estimate', () => {
  const s = S({ discipline: 'bike', durationMin: 120, deviceKcal: 1400, zone: 'z2' });
  const e = sessionEnergy(s, 72, 1750);
  assert.equal(e.source, 'device');
  assert.equal(e.net, 1400);
});

test('device energy is NOT reduced by resting again', () => {
  // HKWorkout.totalEnergyBurned is already ACTIVE energy — Apple has excluded
  // the resting component. Subtracting BMR from it a second time silently lost
  // ~290 kcal on a 4-hour ride.
  const s = S({ discipline: 'bike', durationMin: 240, deviceKcal: 2400 });
  const e = sessionEnergy(s, 72, 1750);
  assert.equal(e.net, 2400, 'device kcal must pass through untouched');
  assert.ok(e.gross > e.net, 'gross should add resting back on, not subtract it');
});

test('our own gross estimates still get the resting subtraction', () => {
  const s = S({ discipline: 'bike', durationMin: 240, zone: 'z2' });
  const e = sessionEnergy(s, 72, 1750);
  assert.equal(e.source, 'met');
  assert.ok(e.net < e.gross, 'model estimates are gross and must be netted');
  between(e.gross - e.net, 270, 310, 'resting over 4 h');
});

test('power still outranks the wearable — measured work beats inferred', () => {
  const s = S({ discipline: 'bike', durationMin: 180, workKJ: 2400, deviceKcal: 900 });
  const e = sessionEnergy(s, 72, 1750);
  assert.equal(e.source, 'power');
  assert.ok(e.net > 2000, 'should use the power figure, not the low device one');
});

test('the model estimate is always retained for comparison', () => {
  const s = S({ discipline: 'bike', durationMin: 120, deviceKcal: 1400, zone: 'z2' });
  const e = sessionEnergy(s, 72, 1750);
  assert.ok(e.modelNet > 0, 'model estimate must be computed even when unused');
  assert.equal(e.deltaKcal, Math.round(1400 - e.modelNet));
});

test('no delta is claimed when there is nothing to compare against', () => {
  const e = sessionEnergy(S({ discipline: 'run', durationMin: 45, distanceKm: 9 }), 72, 1750);
  assert.equal(e.deviceKcal, null);
  assert.equal(e.deltaKcal, null);
});

test('a day reports which sources it used', () => {
  const day = dailyEnergy({
    bmr: 1750, massKg: 72, neat: 'sedentary',
    sessions: [
      S({ discipline: 'bike', durationMin: 120, deviceKcal: 1400 }),
      S({ discipline: 'run', durationMin: 30, distanceKm: 6 }),
    ],
  });
  assert.deepEqual(day.sources, ['device', 'distance']);
});

test('a partial device day refuses to report a misleading total', () => {
  // Comparing two sessions' device figures against three sessions' estimates
  // would understate the wearable every time.
  const day = dailyEnergy({
    bmr: 1750, massKg: 72,
    sessions: [
      S({ discipline: 'bike', durationMin: 120, deviceKcal: 1400 }),
      S({ discipline: 'run', durationMin: 30, distanceKm: 6 }),
    ],
  });
  assert.equal(day.deviceKcal, null);
  assert.equal(day.deltaKcal, null);
  assert.ok(day.modelKcal > 0, 'model total is still available');
});

test('a fully-reported day exposes the wearable-vs-model gap', () => {
  const day = dailyEnergy({
    bmr: 1750, massKg: 72,
    sessions: [
      S({ discipline: 'bike', durationMin: 120, deviceKcal: 1400 }),
      S({ discipline: 'run', durationMin: 30, deviceKcal: 350 }),
    ],
  });
  assert.equal(day.deviceKcal, 1750);
  assert.equal(day.exerciseComponent, 1750, 'the day uses the wearable numbers');
  assert.equal(day.deltaKcal, 1750 - day.modelKcal);
});

test('a rest day has no sources and no delta', () => {
  const day = dailyEnergy({ bmr: 1750, massKg: 72, sessions: [] });
  assert.deepEqual(day.sources, []);
  assert.equal(day.deviceKcal, null);
  assert.equal(day.deltaKcal, null);
});

console.log('\nThe double-count fix');

test('net energy is less than gross by the resting cost of the session', () => {
  const s = S({ discipline: 'bike', durationMin: 300, workKJ: 3000 });
  const gross = sessionGrossKcal(s, 70);
  const net = sessionNetKcal(s, 70, 1700);
  // 5 h at BMR 1700 = ~354 kcal of "you were alive anyway"
  between(gross - net, 330, 380, 'resting subtraction');
});

test('net never goes negative on a trivial session', () => {
  const s = S({ discipline: 'other', durationMin: 30, deviceKcal: 10 });
  assert.ok(sessionNetKcal(s, 70, 1700) >= 0);
});

test('a full Ironman day does not double count training', () => {
  // 6 h of training. Wrong way: BMR x 1.9 + gross. Right way: BMR x NEAT + net.
  const sessions = [S({ discipline: 'bike', durationMin: 300, workKJ: 3200 }),
                    S({ discipline: 'run', durationMin: 60, distanceKm: 12 })];
  const bmr = 1750;
  const right = dailyEnergy({ bmr, neat: 'sedentary', sessions, massKg: 72 }).maintenance;
  const wrong = bmr * 1.9 + sessions.reduce((s, x) => s + sessionGrossKcal(x, 72), 0);
  assert.ok(wrong - right > 700, `double count should be worth > 700 kcal, got ${Math.round(wrong - right)}`);
});

test('NEAT factors stay well below the classic activity multipliers', () => {
  assert.ok(NEAT_FACTORS.manual < 1.55, 'manual NEAT must undercut "moderate" activity');
});

console.log('\nTraining load');

test('an hour at threshold is worth more than an hour easy', () => {
  const easy = sessionLoad(S({ discipline: 'bike', durationMin: 60, zone: 'z1' }));
  const hard = sessionLoad(S({ discipline: 'bike', durationMin: 60, zone: 'z4' }));
  assert.ok(hard > easy * 2, 'z4 should be worth well over double z1');
});

test('zone breakdown is duration-weighted, not bucketed', () => {
  const mixed = effectiveIntensityWeight(S({
    discipline: 'bike', durationMin: 60,
    zoneMinutes: { z2: 30, z4: 30 },
  }));
  between(mixed, 0.95, 1.05, 'half z2 half z4');
});

test('zone breakdown beats a single zone label', () => {
  const s = S({ discipline: 'bike', durationMin: 60, zone: 'z1', zoneMinutes: { z5: 60 } });
  assert.equal(effectiveIntensityWeight(s), 1.5);
});

test('missing intensity assumes moderate, not zero', () => {
  assert.ok(sessionLoad(S({ discipline: 'run', durationMin: 60 })) > 0.5);
});

test('daily load sums sessions', () => {
  const l = dailyLoad([
    S({ discipline: 'swim', durationMin: 60, zone: 'z2' }),
    S({ discipline: 'run', durationMin: 30, zone: 'z3' }),
  ]);
  between(l, 1.1, 1.3, 'brick load');
});

console.log('\nCarb curve vs published guideline bands');

/**
 * Assert POSITION within the band, not just membership.
 *
 * "Is it in 8-12" passed happily while the curve sat at 11.9 for a 6 h ride and
 * 10.9 for a 4.5 h one — technically in band, in practice over-prescribing by
 * ~1.5 g/kg (over 100 g of carbohydrate for a 72 kg athlete) on every long day.
 * A curve that hugs the ceiling of every band is not a correct curve.
 */
const band = (load: number, lo: number, hi: number, label: string, maxPct = 60) =>
  test(`${label} lands in ${lo}-${hi} g/kg, not hugging the ceiling`, () => {
    const v = carbTargetGPerKg(load);
    between(v, lo, hi, label);
    const pct = ((v - lo) / (hi - lo)) * 100;
    assert.ok(pct <= maxPct,
      `${label}: ${v.toFixed(1)} g/kg is ${Math.round(pct)}% into the ${lo}-${hi} band (max ${maxPct}%)`);
  });

band(0, 3, 5, 'rest day');
band(0.7, 3, 5, '1 h easy Z2', 100);   // top of the easy band is fine
band(1.0, 5, 7, '1 h moderate');
band(1.3, 5, 7, '1 h threshold');
band(1.4, 6, 10, '2 h Z2');
band(2.1, 6, 10, '3 h Z2');
band(3.15, 8, 12, '4.5 h Z2');
band(4.2, 8, 12, '6 h Z2', 100);       // genuinely extreme, ceiling is correct

test('a long easy day does not prescribe more carbohydrate than the day can hold', () => {
  // The failure this catches: energy and carbohydrate are computed by separate
  // models and can diverge. A long LOW-intensity day is the worst case —
  // high load, modest calorie burn. Carbs must stay a sane share of intake.
  const massKg = 72;
  const sessions = [S({ discipline: 'bike', durationMin: 270, zone: 'z2' })];
  const energy = dailyEnergy({ bmr: 1750, neat: 'sedentary', sessions, massKg });
  const day = enduranceDayTargets({
    calories: energy.target, massKg, load: energy.load,
    exerciseKcal: energy.exerciseComponent, ffmKg: 62,
  });
  const carbShare = (day.carbs * 4) / day.calories;
  assert.ok(carbShare <= 0.72,
    `carbs are ${Math.round(carbShare * 100)}% of intake — the two models have diverged`);
  assert.ok(day.fatGPerKg >= 0.8,
    `fat squeezed to ${day.fatGPerKg} g/kg, which means carbs ate the budget`);
});

test('curve is monotonic in load', () => {
  let prev = -1;
  for (let l = 0; l <= 6; l += 0.25) {
    const v = carbTargetGPerKg(l);
    assert.ok(v >= prev, `non-monotonic at load ${l}`);
    prev = v;
  }
});

test('curve is clamped at both ends', () => {
  // Negative load is treated as zero, so it returns the base rather than the
  // hard floor — the two are deliberately different numbers now. CHO_MIN is a
  // guard against future edits, not a value the curve is expected to produce.
  assert.equal(carbTargetGPerKg(-5), CHO_BASE_G_PER_KG);
  assert.ok(carbTargetGPerKg(-5) >= CHO_MIN_G_PER_KG);
  assert.equal(carbTargetGPerKg(100), CHO_MAX_G_PER_KG);
});

test('phase shifts hard days without dropping rest days below the floor', () => {
  // Phase scales the LOAD term only. A rest day is therefore identical in every
  // phase and can never be scaled under the floor, which is the whole reason
  // for scaling the slope instead of the whole curve.
  for (const phase of ['off_season', 'base', 'build', 'peak'] as const) {
    assert.equal(carbTargetGPerKg(0, phase), CHO_BASE_G_PER_KG, `rest day moved in ${phase}`);
    assert.ok(carbTargetGPerKg(0, phase) >= CHO_MIN_G_PER_KG);
  }
  assert.ok(carbTargetGPerKg(2, 'base') < carbTargetGPerKg(2, 'peak'));
});

console.log('\nMacro allocation with carbs protected');

test('macros sum to the calorie target', () => {
  const t = allocateEnduranceMacros({ calories: 4200, massKg: 72, load: 2.6 });
  const sum = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  assert.ok(Math.abs(sum - 4200) <= 12, `sum ${sum} vs 4200`);
});

test('carbs hit the periodized target on a normal day', () => {
  const t = allocateEnduranceMacros({ calories: 4200, massKg: 72, load: 2.6 });
  assert.equal(t.carbGPerKg, Math.round(carbTargetGPerKg(2.6) * 10) / 10);
});

test('protein sits in the endurance range, not the lifter range', () => {
  const t = allocateEnduranceMacros({ calories: 4200, massKg: 72, load: 2.6, goal: 'maintain' });
  between(t.proteinGPerKg, 1.2, 2.0, 'protein g/kg');
});

test('cutting raises protein above maintaining', () => {
  const cut = allocateEnduranceMacros({ calories: 3200, massKg: 72, load: 2, goal: 'lose' });
  const maint = allocateEnduranceMacros({ calories: 3600, massKg: 72, load: 2, goal: 'maintain' });
  assert.ok(cut.proteinGPerKg > maint.proteinGPerKg);
});

test('fat clears its floor on a realistic big day', () => {
  const t = allocateEnduranceMacros({ calories: 5500, massKg: 72, load: 4.2 });
  assert.ok(t.fatGPerKg >= FAT_FLOOR_G_PER_KG, `fat ${t.fatGPerKg} g/kg`);
  assert.equal(t.underfuelled, false);
});

test('an impossible deficit is reported, not silently absorbed', () => {
  // 6 h of training on 2000 kcal — the numbers genuinely do not work.
  const t = allocateEnduranceMacros({ calories: 2000, massKg: 72, load: 4.2, goal: 'lose' });
  assert.equal(t.underfuelled, true);
  assert.ok(t.caloriesShortfall > 1000, `shortfall ${t.caloriesShortfall}`);
});

test('under duress protein gives way before fat drops below its floor', () => {
  const t = allocateEnduranceMacros({ calories: 2400, massKg: 72, load: 4.2, goal: 'lose' });
  assert.ok(t.fatGPerKg >= FAT_FLOOR_G_PER_KG - 0.05, 'fat floor held');
  assert.ok(t.proteinGPerKg >= ENDURANCE_PROTEIN_FLOOR_G_PER_KG - 0.05, 'protein floor held');
});

test('macros still sum when the budget is impossible', () => {
  const t = allocateEnduranceMacros({ calories: 2400, massKg: 72, load: 4.2, goal: 'lose' });
  const sum = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  assert.ok(Math.abs(sum - 2400) <= 25, `sum ${sum} vs 2400`);
});

test('no negative or NaN macros anywhere', () => {
  for (const cal of [0, 800, 1500, 3000, 6000, 9000]) {
    for (const load of [0, 1, 3, 6]) {
      const t = allocateEnduranceMacros({ calories: cal, massKg: 72, load, goal: 'lose' });
      for (const v of [t.protein, t.carbs, t.fat]) {
        assert.ok(Number.isFinite(v) && v >= 0, `bad macro at ${cal} kcal / load ${load}`);
      }
    }
  }
});

test('missing weight returns zeros rather than garbage', () => {
  const t = allocateEnduranceMacros({ calories: 3000, massKg: 0, load: 2 });
  assert.equal(t.carbs, 0);
  assert.equal(t.underfuelled, false);
});

console.log('\nEnergy availability (RED-S)');

test('well-fed athlete reads optimal', () => {
  const ea = energyAvailability(4500, 1800, 60);
  assert.equal(ea.status, 'optimal');
  assert.equal(ea.deficitToOptimal, 0);
});

test('the classic under-fuelled age-grouper is caught', () => {
  // 60 kg athlete, 51 kg FFM, 2800 kcal of training, eating 4150.
  const ea = energyAvailability(4150, 2800, 51);
  assert.equal(ea.status, 'low');
  assert.ok(ea.value !== null && ea.value < 30);
});

test('the 30-45 grey zone is flagged but not alarmed', () => {
  const ea = energyAvailability(30 * 60 + 1800 + 300, 1800, 60);
  assert.equal(ea.status, 'suboptimal');
});

test('deficit figures are actionable kcal, not ratios', () => {
  const ea = energyAvailability(3000, 2000, 60);
  assert.equal(ea.status, 'low');
  // needs (30 x 60 + 2000) - 3000 = 800 more kcal
  assert.equal(ea.deficitToLow, 800);
});

test('unknown body composition degrades gracefully', () => {
  const ea = energyAvailability(3000, 1000, null);
  assert.equal(ea.status, 'unknown');
  assert.equal(ea.value, null);
  assert.equal(minimumSafeCalories(1000, null), null);
});

test('minimum safe calories covers training plus the EA floor', () => {
  assert.equal(minimumSafeCalories(2000, 60), 30 * 60 + 2000);
});

console.log('\nWhole-day integration');

test('a target below the safety floor is raised, not obeyed', () => {
  const day = enduranceDayTargets({
    calories: 2400, massKg: 72, load: 4.2, goal: 'lose',
    exerciseKcal: 3400, ffmKg: 62,
  });
  assert.equal(day.caloriesRaisedForSafety, true);
  assert.ok(day.calories >= 30 * 62 + 3400);
  assert.notEqual(day.energyAvailability.status, 'low');
});

test('a sane day is left alone', () => {
  const day = enduranceDayTargets({
    calories: 5200, massKg: 72, load: 2.6, goal: 'maintain',
    exerciseKcal: 1900, ffmKg: 62,
  });
  assert.equal(day.caloriesRaisedForSafety, false);
  assert.equal(day.calories, 5200);
});

test('the safety clamp can be turned off for advanced users', () => {
  const day = enduranceDayTargets({
    calories: 2400, massKg: 72, load: 4.2, goal: 'lose',
    exerciseKcal: 3400, ffmKg: 62, enforceEnergyAvailability: false,
  });
  assert.equal(day.caloriesRaisedForSafety, false);
  assert.equal(day.energyAvailability.status, 'low');
});

test('end-to-end: real Ironman build day produces sane numbers', () => {
  const massKg = 72, bmr = 1750, ffmKg = 62;
  const sessions: Session[] = [
    S({ discipline: 'swim', durationMin: 60, zone: 'z2' }),
    S({ discipline: 'bike', durationMin: 240, workKJ: 2600 }),
    S({ discipline: 'run', durationMin: 30, distanceKm: 6 }),
  ];
  const energy = dailyEnergy({ bmr, neat: 'sedentary', sessions, massKg, goalAdjustment: 0 });
  const day = enduranceDayTargets({
    calories: energy.target, massKg, load: energy.load,
    goal: 'maintain', phase: 'build',
    exerciseKcal: energy.exerciseComponent, ffmKg,
  });

  between(energy.target, 4200, 6200, 'daily calories');
  between(day.carbGPerKg, 7, 12, 'carb g/kg');
  between(day.proteinGPerKg, 1.4, 2.0, 'protein g/kg');
  assert.ok(day.fatGPerKg >= FAT_FLOOR_G_PER_KG);
  // Eating maintenance is safe but sits in the 30-45 band by construction —
  // see the note in enduranceFueling.ts. What matters is that it does not warn.
  assert.equal(day.energyAvailability.shouldWarn, false);
});

test('EA at maintenance is independent of training load (and that is expected)', () => {
  // (maintenance - EEE)/FFM reduces to (BMR x NEAT)/FFM, which has no training
  // term. If this ever starts varying, someone has broken the double-count fix.
  const massKg = 72, bmr = 1750, ffmKg = 62;
  const day = (sessions: Session[]) => {
    const e = dailyEnergy({ bmr, neat: 'sedentary', sessions, massKg });
    return energyAvailability(e.target, e.exerciseComponent, ffmKg).value;
  };
  const rest = day([]);
  const huge = day([S({ discipline: 'bike', durationMin: 300, workKJ: 3200 })]);
  assert.equal(rest, huge);
  between(rest as number, 30, 45, 'maintenance EA');
});

test('a deficit on top of heavy training is what actually trips the warning', () => {
  const massKg = 72, bmr = 1750, ffmKg = 62;
  const sessions = [S({ discipline: 'bike', durationMin: 300, workKJ: 3200 })];
  const e = dailyEnergy({ bmr, neat: 'sedentary', sessions, massKg, goalAdjustment: -400 });
  const ea = energyAvailability(e.target, e.exerciseComponent, ffmKg);
  assert.equal(ea.shouldWarn, true);
  assert.equal(ea.status, 'low');
});

test('end-to-end: rest day drops carbs to the base', () => {
  const energy = dailyEnergy({ bmr: 1750, neat: 'sedentary', sessions: [], massKg: 72 });
  const day = enduranceDayTargets({
    calories: energy.target, massKg: 72, load: energy.load, exerciseKcal: 0, ffmKg: 62,
  });
  assert.equal(day.carbGPerKg, CHO_BASE_G_PER_KG);
  between(day.carbGPerKg, 3, 5, 'rest day carbs');
  assert.equal(energy.exerciseComponent, 0);
});

console.log('\nRace date and training phase');

test('phase walks backwards correctly from the race', () => {
  const T = '2026-08-01';
  assert.equal(phaseFromRaceDate('2026-08-03', T), 'race_week');
  assert.equal(phaseFromRaceDate('2026-08-15', T), 'taper');
  assert.equal(phaseFromRaceDate('2026-09-10', T), 'peak');
  assert.equal(phaseFromRaceDate('2026-10-20', T), 'build');
  assert.equal(phaseFromRaceDate('2027-02-01', T), 'base');
});

test('a race already run drops back to off-season', () => {
  assert.equal(phaseFromRaceDate('2026-07-01', '2026-08-01'), 'off_season');
});

test('no race date means no inferred phase', () => {
  assert.equal(phaseFromRaceDate(null, '2026-08-01'), null);
  assert.equal(daysUntilRace(null), null);
  assert.equal(weeksUntilRace(undefined), null);
});

test('day and week counts agree', () => {
  assert.equal(daysUntilRace('2026-08-15', '2026-08-01'), 14);
  assert.equal(weeksUntilRace('2026-08-15', '2026-08-01'), 2);
});

test('carb loading opens 1-2 days out, not earlier or on race day', () => {
  const R = '2026-08-10';
  assert.equal(isCarbLoadWindow(R, '2026-08-07', 11), false);
  assert.equal(isCarbLoadWindow(R, '2026-08-08', 11), true);
  assert.equal(isCarbLoadWindow(R, '2026-08-09', 11), true);
  assert.equal(isCarbLoadWindow(R, '2026-08-10', 11), false);
});

test('short races do not trigger a carb load', () => {
  assert.equal(isCarbLoadWindow('2026-08-10', '2026-08-09', 1.2), false);
});

test('carb load override lifts intake into the 10-12 g/kg band', () => {
  const t = allocateEnduranceMacros({
    calories: 4000, massKg: 72, load: 0.5, carbGPerKgOverride: 11.5,
  });
  between(t.carbGPerKg, 10, 12, 'loading day carbs');
});

console.log('\nSport profile / multiplier parity');

test('every sport with a macro multiplier has a coaching profile', () => {
  // The bug this locks out: `triathlon` and `hiking` had multipliers in
  // data.ts but no entry in sportProfiles.ts, so getSportProfile() silently
  // fell through to 'none' and triathletes were coached on bench press.
  const missing = Object.keys(SPORT_MULTIPLIERS).filter(k => !(k in SPORT_PROFILES));
  assert.deepEqual(missing, [], `no coaching profile for: ${missing.join(', ')}`);
});

test('every coaching profile has a macro multiplier', () => {
  const missing = Object.keys(SPORT_PROFILES).filter(k => !(k in SPORT_MULTIPLIERS));
  assert.deepEqual(missing, [], `no macro multiplier for: ${missing.join(', ')}`);
});

test('getSportProfile returns the real profile for every triathlon distance', () => {
  for (const key of ['triathlon', 'tri_sprint', 'tri_olympic', 'tri_70_3', 'tri_ironman', 'hiking']) {
    const p = getSportProfile(key);
    assert.notEqual(p, SPORT_PROFILES.none, `${key} still falls through to General Fitness`);
    assert.ok(p.coachingContext.length > 400, `${key} coaching context is too thin to be useful`);
  }
});

test('an unknown sport still degrades to General Fitness rather than crashing', () => {
  assert.equal(getSportProfile('underwater_basket_weaving'), SPORT_PROFILES.none);
});

test('endurance sports are correctly identified', () => {
  for (const k of ['tri_ironman', 'triathlon', 'running', 'cycling', 'hiking']) {
    assert.ok(isEnduranceSport(k), `${k} should be endurance`);
  }
  for (const k of ['powerlifting', 'bodybuilding', 'golf', 'none', null, undefined]) {
    assert.ok(!isEnduranceSport(k as any), `${k} should not be endurance`);
  }
});

test('longer triathlon distances carry higher fallback carb and calorie multipliers', () => {
  const order = ['tri_sprint', 'tri_olympic', 'tri_70_3', 'tri_ironman'] as const;
  for (let i = 1; i < order.length; i++) {
    assert.ok(SPORT_MULTIPLIERS[order[i]].carbs >= SPORT_MULTIPLIERS[order[i - 1]].carbs,
      `${order[i]} carbs should not be below ${order[i - 1]}`);
    assert.ok(SPORT_MULTIPLIERS[order[i]].cal >= SPORT_MULTIPLIERS[order[i - 1]].cal,
      `${order[i]} calories should not be below ${order[i - 1]}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
