/**
 * Strength & power engine tests (archetype B).  Run with:  npm test
 *
 * Same standard as the endurance suite: the point is not "does the arithmetic
 * work" but "does the output land inside the published band for this scenario".
 * A carbohydrate curve that computes cleanly and prescribes 11 g/kg to a
 * powerlifter is working code and broken advice.
 *
 * Two of these tests exist purely to stop a specific future mistake:
 * `allocation stays protein-first` and `no in-event carbohydrate rate exists`.
 * The endurance work flipped allocation to carbohydrate-first and introduced a
 * g/h fuelling rate, and both are wrong for this archetype.
 *
 * Import from the pure modules only — anything that reaches Supabase drags in
 * React Native and esbuild cannot parse its Flow types.
 */
import assert from 'node:assert/strict';
import {
  strengthCarbTargetGPerKg, allocateStrengthMacros, strengthDayTargets,
  planProteinDistribution, strengthFatFloorG,
  buildMeetDayPlan, blockFromMeetDate, daysUntilMeet, shouldCarbLoadForMeet,
  BLOCK_CHO_SCALE, BLOCK_CALORIE_SCALE, BLOCK_NOTE, BLOCK_LABEL, STRENGTH_BLOCKS,
  STRENGTH_CHO_MIN_G_PER_KG, STRENGTH_CHO_MAX_G_PER_KG,
  STRENGTH_PROTEIN_G_PER_KG, STRENGTH_PROTEIN_FLOOR_G_PER_KG,
  STRENGTH_FAT_FLOOR_G_PER_KG, PROTEIN_PER_MEAL_G_PER_KG,
  CAFFEINE_DAILY_CAP_MG_PER_KG, MEET_FLUID_L_PER_H,
} from '../strengthFueling';
import { carbTargetGPerKg } from '../enduranceFueling';
import { sessionLoad, type Session } from '../sessionEnergy';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e: any) { failed++; console.log(`✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const between = (v: number, lo: number, hi: number, label = '') =>
  assert.ok(v >= lo && v <= hi, `${label} ${v} not in [${lo}, ${hi}]`);

const S = (p: Partial<Session> & { discipline: Session['discipline']; durationMin: number }): Session => p as Session;

console.log('\nStrength carbohydrate curve');

test('a rest day sits at the bottom of the strength band, not the endurance one', () => {
  assert.equal(strengthCarbTargetGPerKg(0), 3.5);
});

test('the curve stays inside 3-7 g/kg for any training day a human can do', () => {
  for (let load = 0; load <= 8; load += 0.1) {
    const g = strengthCarbTargetGPerKg(load);
    between(g, STRENGTH_CHO_MIN_G_PER_KG, STRENGTH_CHO_MAX_G_PER_KG, `load ${load.toFixed(1)}`);
  }
});

test('the strength curve is always below the endurance curve at the same load', () => {
  // A lifter does not have a low carbohydrate day and a high one. Widening the
  // endurance parameters instead of writing a flatter curve would have been
  // the wrong model, just a quieter one.
  for (const load of [0.5, 1, 1.5, 2, 3, 4]) {
    assert.ok(strengthCarbTargetGPerKg(load) < carbTargetGPerKg(load),
      `at load ${load} strength (${strengthCarbTargetGPerKg(load)}) is not below ` +
      `endurance (${carbTargetGPerKg(load)})`);
  }
});

test('the design worked example reproduces: 90 kg, 2 h heavy, accumulation', () => {
  // 2 h of strength work at z3 is load 2.0.
  const load = sessionLoad(S({ discipline: 'strength', durationMin: 120, zone: 'z3' }));
  between(load, 1.95, 2.05, 'load');
  const g = strengthCarbTargetGPerKg(load, 'accumulation');
  between(g, 5.1, 5.3, 'CHO g/kg');       // design says 5.2
  between(g, 4, 7, 'inside the strength band');
});

console.log('\nBlock periodization');

test('blocks replace base/build/peak/taper', () => {
  assert.deepEqual(STRENGTH_BLOCKS,
    ['accumulation', 'intensification', 'realization', 'deload']);
  for (const b of STRENGTH_BLOCKS) {
    assert.ok(BLOCK_LABEL[b], `no label for ${b}`);
    assert.ok(BLOCK_NOTE[b], `no note for ${b}`);
    assert.ok(Number.isFinite(BLOCK_CHO_SCALE[b]), `no carb scale for ${b}`);
    assert.ok(BLOCK_CALORIE_SCALE[b], `no calorie band for ${b}`);
  }
});

test('realization HOLDS calories — the classic pre-meet error', () => {
  // Volume drops into the meet and lifters cut calories to match. Both ends of
  // the band are maintenance so nothing can drift downward here.
  assert.equal(BLOCK_CALORIE_SCALE.realization.min, 1.0);
  assert.equal(BLOCK_CALORIE_SCALE.realization.max, 1.0);
  assert.ok(/not a reason to eat less|hold calories/i.test(BLOCK_NOTE.realization),
    'the realization note must say calories are held');
});

test('accumulation is the only block with surplus headroom', () => {
  assert.ok(BLOCK_CALORIE_SCALE.accumulation.max > 1.0);
  for (const b of ['intensification', 'realization', 'deload'] as const) {
    assert.equal(BLOCK_CALORIE_SCALE[b].max, 1.0, `${b} should not carry a surplus`);
  }
});

test('deload eases carbohydrate and nothing else does', () => {
  assert.ok(BLOCK_CHO_SCALE.deload < 1.0);
  for (const b of ['accumulation', 'intensification', 'realization'] as const) {
    assert.ok(BLOCK_CHO_SCALE[b] >= 1.0, `${b} should not scale carbohydrate down`);
  }
});

test('the block is inferred from the meet date', () => {
  const MEET = '2026-10-01';
  assert.equal(blockFromMeetDate(MEET, '2026-09-20'), 'realization');     // 11 days
  assert.equal(blockFromMeetDate(MEET, '2026-08-25'), 'intensification'); // 37 days
  assert.equal(blockFromMeetDate(MEET, '2026-06-01'), 'accumulation');    // 122 days
  assert.equal(blockFromMeetDate(MEET, '2026-10-05'), 'deload');          // 4 days after
  assert.equal(blockFromMeetDate(MEET, '2026-11-15'), 'accumulation');    // well after
  assert.equal(blockFromMeetDate(null), null);
});

test('day counting agrees with the block boundaries', () => {
  assert.equal(daysUntilMeet('2026-10-01', '2026-09-24'), 7);
  assert.equal(daysUntilMeet(null), null);
});

console.log('\nProtein distribution');

test('the per-meal dose lands in the 0.3-0.4 g/kg band at every goal', () => {
  // Areta et al. 2013: 20 g every 3 h beats 40 g every 6 h for the same daily
  // total. This is the strength athlete's structural equivalent of the
  // endurance athlete's g/h — a rate the daily total can hide.
  for (const goal of ['maintain', 'lose', 'gain'] as const) {
    const daily = STRENGTH_PROTEIN_G_PER_KG[goal] * 90;
    const d = planProteinDistribution(90, daily);
    between(d.perMealGPerKg, PROTEIN_PER_MEAL_G_PER_KG.min, PROTEIN_PER_MEAL_G_PER_KG.max,
      `${goal} per-meal`);
    assert.ok(d.inBand, `${goal} reported out of band`);
  }
});

test('meal count rises with the protein target rather than the dose', () => {
  const maintain = planProteinDistribution(90, STRENGTH_PROTEIN_G_PER_KG.maintain * 90);
  const deficit  = planProteinDistribution(90, STRENGTH_PROTEIN_G_PER_KG.lose * 90);
  assert.equal(maintain.mealCount, 4);
  assert.ok(deficit.mealCount > maintain.mealCount,
    '2.2 g/kg across four meals would be 0.55 g/kg a sitting');
  between(deficit.mealCount, 4, 6, 'meal count');
});

test('the last meal is the pre-sleep dose at 0.4 g/kg of slow protein', () => {
  const d = planProteinDistribution(90, 144);
  const last = d.meals[d.meals.length - 1];
  assert.ok(last.preSleep, 'the final meal must be flagged as pre-sleep');
  assert.equal(last.proteinG, 36);           // 0.4 x 90
  assert.equal(d.meals.filter(m => m.preSleep).length, 1, 'exactly one pre-sleep dose');
});

test('the meals add back up to the daily total', () => {
  for (const daily of [120, 144, 162, 198, 220]) {
    const d = planProteinDistribution(90, daily);
    const sum = d.meals.reduce((s, m) => s + m.proteinG, 0);
    between(sum, daily - 3, daily + 3, `sum for ${daily}g`);  // rounding only
  }
});

test('meals are spread 3-4 hours apart across a normal waking day', () => {
  for (const daily of [144, 162, 198]) {
    const d = planProteinDistribution(90, daily);
    between(d.gapHours, 3, 4, 'gap');
    const span = d.meals[d.meals.length - 1].hoursAfterFirst;
    between(span, 12, 16, `eating window for ${daily}g`);
  }
});

test('junk input returns an empty plan rather than NaN', () => {
  const d = planProteinDistribution(0, 0);
  assert.equal(d.mealCount, 0);
  assert.deepEqual(d.meals, []);
  assert.ok(Number.isFinite(d.perMealG));
});

console.log('\nAllocation');

test('allocation stays protein-first — the endurance flip does NOT propagate', () => {
  // Add 400 kcal to the day. In a carbohydrate-first model protein would be
  // untouched because carbohydrate was already reserved; here protein must be
  // untouched because it was allocated FIRST and carbohydrate is the residual
  // that absorbs the difference. The distinguishing test is what happens when
  // calories FALL: carbohydrate gives way, not protein.
  const rich = allocateStrengthMacros({ calories: 3600, massKg: 90, load: 2 });
  const lean = allocateStrengthMacros({ calories: 3200, massKg: 90, load: 2 });
  assert.equal(rich.protein, lean.protein, 'protein must not move with the budget');
  assert.ok(rich.carbs > lean.carbs, 'carbohydrate is the residual macro here');
});

test('the design worked example allocates sensibly at maintenance', () => {
  // 90 kg lifter, 2 h heavy session, ~3,290 kcal maintenance.
  const t = allocateStrengthMacros({
    calories: 3292, massKg: 90, load: 2, goal: 'maintain', block: 'accumulation',
  });
  assert.equal(t.protein, 144);                    // 1.6 x 90
  assert.equal(t.proteinGPerKg, 1.6);
  assert.ok(t.fat >= STRENGTH_FAT_FLOOR_G_PER_KG * 90, 'fat below its floor');
  between(t.carbGPerKg, 4, 7, 'delivered carbohydrate');
  between(t.carbGuidelineGPerKg, 5.1, 5.3, 'curve guideline');
  assert.equal(t.underfuelled, false);
  assert.equal(t.proteinDistribution.mealCount, 4);
});

test('fat floors at the higher of 0.8 g/kg and 20% of calories', () => {
  assert.equal(strengthFatFloorG(90, 2400), 72);            // 0.8 x 90 binds
  between(strengthFatFloorG(90, 4500), 99, 101, 'kcal share binds');  // 0.20 x 4500 / 9
  for (const cal of [1800, 2500, 3200, 4000, 5000]) {
    const t = allocateStrengthMacros({ calories: cal, massKg: 90, load: 1.5 });
    assert.ok(t.fat >= 71, `fat ${t.fat}g fell through its floor at ${cal} kcal`);
  }
});

test('protein rises in a deficit, because lean-mass sparing is the whole job', () => {
  const maintain = allocateStrengthMacros({ calories: 3000, massKg: 90, load: 1.5, goal: 'maintain' });
  const cut      = allocateStrengthMacros({ calories: 3000, massKg: 90, load: 1.5, goal: 'lose' });
  assert.ok(cut.protein > maintain.protein);
  between(cut.proteinGPerKg, 1.6, 2.2, 'deficit protein');
});

test('an impossible budget reports the conflict instead of resolving it silently', () => {
  // 90 kg on 1,800 kcal cannot hold 1.6 g/kg protein, the fat floor and 3 g/kg
  // carbohydrate at once. The honest answer is the shortfall, not a quietly
  // broken plan.
  const t = allocateStrengthMacros({ calories: 1800, massKg: 90, load: 1.5 });
  assert.equal(t.underfuelled, true);
  assert.ok(t.caloriesShortfall > 400, `shortfall ${t.caloriesShortfall} looks too small`);
  assert.ok(t.protein >= STRENGTH_PROTEIN_FLOOR_G_PER_KG * 90 - 1,
    'protein must not fall below its floor');
  assert.ok(t.fat >= STRENGTH_FAT_FLOOR_G_PER_KG * 90 - 1,
    'fat is already at its minimum and must never be shaved');
});

test('macros always reconstruct the calorie target', () => {
  // Including the override path, which is where they did not: a fixed
  // carbohydrate figure plus the protein target plus the fat FLOOR can exceed
  // the whole budget, and fat-at-floor meant the excess had nowhere to go.
  for (const cal of [1600, 2000, 2200, 2600, 3200, 3800, 4600]) {
    for (const mass of [60, 75, 90, 115]) {
      for (const override of [null, 4, 6, 7]) {
        const t = allocateStrengthMacros({
          calories: cal, massKg: mass, load: 1.8, carbGPerKgOverride: override,
        });
        const sum = t.protein * 4 + t.carbs * 4 + t.fat * 9;
        between(sum, cal - 15, cal + 15,
          `${mass}kg @ ${cal}kcal override=${override}`);
        assert.ok(t.protein >= 0 && t.carbs >= 0 && t.fat >= 0,
          `negative macro at ${mass}kg @ ${cal}kcal override=${override}`);
      }
    }
  }
});

test('carbohydrate never leaves the 3-7 g/kg band on a plausible day', () => {
  // A generous calorie target is spare energy, not a carbohydrate requirement.
  // Before the ceiling existed, 5,000 kcal for a 90 kg lifter prescribed
  // 9.2 g/kg — an endurance number handed to a strength athlete.
  for (const cal of [2600, 3200, 3800, 4400, 5000]) {
    const t = allocateStrengthMacros({ calories: cal, massKg: 90, load: 2 });
    between(t.carbGPerKg, STRENGTH_CHO_MIN_G_PER_KG, STRENGTH_CHO_MAX_G_PER_KG,
      `${cal} kcal`);
  }
});

test('a carbohydrate override is honoured and clamped to the band', () => {
  const t = allocateStrengthMacros({
    calories: 3600, massKg: 90, load: 1, carbGPerKgOverride: 6.5,
  });
  between(t.carbGPerKg, 6.4, 6.6, 'override');
  const clamped = allocateStrengthMacros({
    calories: 4200, massKg: 90, load: 1, carbGPerKgOverride: 14,
  });
  assert.ok(clamped.carbGPerKg <= STRENGTH_CHO_MAX_G_PER_KG,
    'an override must not escape the band');
});

test('an override that does not fit reports the shortfall rather than shrinking quietly', () => {
  // 6 g/kg for a 90 kg lifter is 540 g — 2,160 kcal of carbohydrate alone. On
  // 3,000 kcal it cannot coexist with 1.6 g/kg protein and the fat floor. The
  // engine must say so, not silently hand back 5.1 g/kg.
  const t = allocateStrengthMacros({
    calories: 3000, massKg: 90, load: 1, carbGPerKgOverride: 6,
  });
  assert.equal(t.underfuelled, true);
  assert.ok(t.caloriesShortfall > 0, 'a shortfall must be reported');
  const sum = t.protein * 4 + t.carbs * 4 + t.fat * 9;
  between(sum, 2985, 3015, 'macros still reconstruct the target');
});

test('junk input returns zeroes rather than NaN', () => {
  const t = allocateStrengthMacros({ calories: 0, massKg: 0, load: 0 });
  assert.equal(t.calories, 0);
  assert.equal(t.carbs, 0);
  assert.ok(Number.isFinite(t.carbGPerKg));
});

console.log('\nThe shared energy-availability guard');

test('a lifter reaches the same EA floor a triathlete does', () => {
  // This is the whole point of moving the guard out of enduranceFueling.ts.
  // 90 kg, 76 kg FFM, 800 kcal of training, dieting to 2,000 kcal. The floor is
  // 30 x 76 + 800 = 3,080.
  const d = strengthDayTargets({
    calories: 2000, massKg: 90, load: 2, goal: 'lose',
    exerciseKcal: 800, ffmKg: 76,
  });
  assert.equal(d.caloriesRaisedForSafety, true);
  assert.equal(d.calories, 3080);
  assert.equal(d.energyAvailability.shouldWarn, false, 'the raised target clears the threshold');
});

test('a well-fed day is not clamped and does not warn', () => {
  const d = strengthDayTargets({
    calories: 3400, massKg: 90, load: 2, exerciseKcal: 700, ffmKg: 76,
  });
  assert.equal(d.caloriesRaisedForSafety, false);
  assert.equal(d.calories, 3400);
  assert.equal(d.energyAvailability.shouldWarn, false);
});

test('the soft clamp can be switched off, the non-overridable one cannot', () => {
  const base = {
    calories: 2000, massKg: 90, load: 2, exerciseKcal: 800, ffmKg: 76,
  };
  const off = strengthDayTargets({ ...base, enforceEnergyAvailability: false });
  assert.equal(off.caloriesRaisedForSafety, false);
  assert.equal(off.energyAvailability.shouldWarn, true, 'it must still WARN when unclamped');

  const hard = strengthDayTargets({
    ...base, enforceEnergyAvailability: false, energyAvailabilityNonOverridable: true,
  });
  assert.equal(hard.caloriesRaisedForSafety, true, 'a hard clamp ignores the flag');
});

test('nothing is clamped when body composition is unknown', () => {
  // The honest answer, rather than inventing a body-fat estimate to justify a
  // safety number.
  const d = strengthDayTargets({ calories: 1800, massKg: 90, load: 2, exerciseKcal: 800 });
  assert.equal(d.caloriesRaisedForSafety, false);
  assert.equal(d.energyAvailability.status, 'unknown');
});

console.log('\nMeet day');

test('no in-event carbohydrate RATE exists anywhere in a meet plan', () => {
  // A meet is nine maximal attempts with twenty-minute waits, not an
  // absorption problem. If a g/h field ever appears here, the endurance model
  // has leaked into this archetype.
  const plan = buildMeetDayPlan({ massKg: 90 });
  const keys = Object.keys(plan).join(' ');
  assert.ok(!/PerH|GPerH|RateG/i.test(keys), `rate-shaped field in meet plan: ${keys}`);
  for (const step of plan.steps) {
    assert.ok(!/PerH|GPerH/i.test(Object.keys(step).join(' ')));
  }
});

test('pre-meet carbohydrate is 1-2 g/kg, low fat and low fibre', () => {
  const plan = buildMeetDayPlan({ massKg: 90 });
  assert.equal(plan.preMeetCarbG.min, 90);
  assert.equal(plan.preMeetCarbG.max, 180);
  const pre = plan.steps[0];
  assert.equal(pre.offsetMin, -180);
  between(pre.carbG, 90, 180, 'T-3h carbohydrate');
  assert.ok(/low fat, low fibre/i.test(pre.detail));
});

test('caffeine is ONE dose, timed to the opener', () => {
  const plan = buildMeetDayPlan({ massKg: 90 });
  const dosed = plan.steps.filter(s => s.caffeineMg > 0);
  assert.equal(dosed.length, 1, 'exactly one caffeine dose');
  assert.equal(dosed[0].offsetMin, -60);
  between(plan.caffeineMg, 3 * 90, 6 * 90, 'dose');
  assert.equal(plan.totalCaffeineMg, plan.caffeineMg);
});

test('caffeine stacking is capped at 6 mg/kg for the whole day', () => {
  assert.equal(CAFFEINE_DAILY_CAP_MG_PER_KG, 6);
  const plan = buildMeetDayPlan({ massKg: 90, caffeineAlreadyMg: 400 });
  assert.equal(plan.caffeineCapMg, 540);
  assert.equal(plan.caffeineMg, 140);          // 540 - 400
  assert.equal(plan.caffeineLimited, true);
  assert.ok(plan.notes.some(n => /capped/i.test(n)));

  const maxedOut = buildMeetDayPlan({ massKg: 90, caffeineAlreadyMg: 700 });
  assert.equal(maxedOut.caffeineMg, 0, 'never prescribe on top of an exceeded cap');
  assert.equal(maxedOut.totalCaffeineMg, 0);
});

test('caffeine is not prescribed to someone who is not habituated', () => {
  const plan = buildMeetDayPlan({ massKg: 90, caffeineHabituated: false });
  assert.equal(plan.totalCaffeineMg, 0);
  assert.ok(plan.notes.some(n => /not habituated/i.test(n)));
});

test('food between attempts only when the gap is worth it', () => {
  const tight = buildMeetDayPlan({ massKg: 90, attemptGapMin: 15 });
  assert.equal(tight.betweenAttemptCarbG, 0);
  assert.ok(tight.notes.some(n => /Fluid only/i.test(n)));

  const normal = buildMeetDayPlan({ massKg: 90, attemptGapMin: 25 });
  between(normal.betweenAttemptCarbG, 20, 40, 'between-attempt carbohydrate');

  const slow = buildMeetDayPlan({ massKg: 90, attemptGapMin: 45 });
  assert.ok(slow.betweenAttemptCarbG >= normal.betweenAttemptCarbG);
  between(slow.betweenAttemptCarbG, 20, 40, 'long-gap carbohydrate');
});

test('fluid is deliberately modest — the belt needs the room', () => {
  assert.equal(MEET_FLUID_L_PER_H, 0.5);
  const plan = buildMeetDayPlan({ massKg: 90, meetHours: 6 });
  between(plan.totalFluidL, 2.8, 3.2, 'six hours at 0.5 L/h');
  assert.ok(plan.notes.some(n => /intra-abdominal pressure/i.test(n)));
});

test('a long meet gets a warning about eating to schedule, not appetite', () => {
  const plan = buildMeetDayPlan({ massKg: 90, meetHours: 9 });
  assert.ok(plan.notes.some(n => /eat to the schedule/i.test(n)));
});

test('every meet plan says to rehearse it first', () => {
  for (const hours of [4, 6, 9]) {
    const plan = buildMeetDayPlan({ massKg: 90, meetHours: hours });
    assert.ok(plan.notes.some(n => /rehearse/i.test(n)), `${hours}h plan has no rehearsal note`);
  }
});

test('carb loading is refused for a normal-length meet', () => {
  // Nine singles over six hours is not a depleting event; loading just adds
  // water weight you then have to squat.
  assert.equal(shouldCarbLoadForMeet(2), false);
  assert.equal(shouldCarbLoadForMeet(6), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
