/**
 * Macro math regression tests.
 *
 * Run with:  npm test
 *
 * These exist because the BMR formula and goal adjustments were duplicated
 * across three files and drifted apart unnoticed. Every test below pins a
 * behaviour that was actually broken at some point — if one fails, a real
 * user-facing number has changed.
 *
 * Plain node:assert + tsx so there's no jest/babel/RN test harness to maintain.
 * constants/data.ts has zero imports, which is what makes this possible.
 */
import assert from 'node:assert/strict';
import {
  GOAL_ADJUSTMENTS,
  USER_GOAL_ADJUSTMENTS,
  ACTIVITY_MULTIPLIERS,
  mifflinBmr,
  katchMcArdleBmr,
  leanMassLb,
  estimateBmr,
  calculateTargets,
  deriveMacrosFromCalories,
} from '../../constants/data';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`);
  }
}

const kcal = (m: { protein: number; carbs: number; fat: number }) =>
  m.protein * 4 + m.carbs * 4 + m.fat * 9;

console.log('\nMifflin-St Jeor');

test('male: 185 lb / 70 in / 30 yr → 1805', () => {
  assert.equal(mifflinBmr({ weight_lbs: 185, height_in: 70, age: 30, sex: 'male' }), 1805);
});

test('female: 140 lb / 65 in / 28 yr → 1366', () => {
  assert.equal(mifflinBmr({ weight_lbs: 140, height_in: 65, age: 28, sex: 'female' }), 1366);
});

test('male constant is exactly 166 above female for identical stats', () => {
  const p = { weight_lbs: 185, height_in: 70, age: 30 };
  const m = mifflinBmr({ ...p, sex: 'male' })!;
  const f = mifflinBmr({ ...p, sex: 'female' })!;
  assert.equal(m - f, 166);
});

// BUG 2 REGRESSION: data.ts defaulted unknown sex to female, tdee.ts to male —
// a 166 cal swing for the same person depending on which code path ran.
test('unknown sex resolves to the midpoint, not silently male or female', () => {
  const p = { weight_lbs: 185, height_in: 70, age: 30 };
  const male = mifflinBmr({ ...p, sex: 'male' })!;
  const female = mifflinBmr({ ...p, sex: 'female' })!;
  for (const sex of [null, undefined, 'other', '']) {
    const got = mifflinBmr({ ...p, sex } as any)!;
    assert.ok(got > female && got < male, `sex=${sex} gave ${got}, expected between ${female} and ${male}`);
    assert.equal(got, Math.round((male + female) / 2));
  }
});

test('incomplete stats return null rather than NaN', () => {
  assert.equal(mifflinBmr(null), null);
  assert.equal(mifflinBmr({ weight_lbs: 185, height_in: 70 }), null);
  assert.equal(mifflinBmr({ weight_lbs: 0, height_in: 70, age: 30, sex: 'male' }), null);
});

console.log('\nGoal adjustments (single source of truth)');

// BUG 1 REGRESSION: three separate copies existed (-300/+300 vs -400/+250 vs
// -400/+250) so the target moved 100 cal/day based on HealthKit authorization.
test('UserGoal labels map to the same numbers as the raw goal keys', () => {
  assert.equal(USER_GOAL_ADJUSTMENTS.lose_fat, GOAL_ADJUSTMENTS.lose);
  assert.equal(USER_GOAL_ADJUSTMENTS.build_muscle, GOAL_ADJUSTMENTS.gain);
  assert.equal(USER_GOAL_ADJUSTMENTS.maintain, GOAL_ADJUSTMENTS.maintain);
});

test('values are the agreed −400 / 0 / +250', () => {
  assert.deepEqual({ ...GOAL_ADJUSTMENTS }, { lose: -400, maintain: 0, gain: 250 });
});

test('deficit is negative, surplus positive, maintain zero', () => {
  assert.ok(GOAL_ADJUSTMENTS.lose < 0);
  assert.ok(GOAL_ADJUSTMENTS.gain > 0);
  assert.equal(GOAL_ADJUSTMENTS.maintain, 0);
});

console.log('\nMacros reconstruct the calorie target');

const PROFILES = [
  { weight_lbs: 185, height_in: 70, age: 30, sex: 'male', activity: 'moderate', goal: 'maintain', sport: 'none' },
  { weight_lbs: 185, height_in: 70, age: 30, sex: 'male', activity: 'moderate', goal: 'maintain', sport: 'bodybuilding' },
  { weight_lbs: 150, height_in: 68, age: 25, sex: 'male', activity: 'light', goal: 'lose', sport: 'wrestling' },
  { weight_lbs: 220, height_in: 74, age: 35, sex: 'male', activity: 'very_active', goal: 'gain', sport: 'triathlon' },
  { weight_lbs: 140, height_in: 65, age: 28, sex: 'female', activity: 'moderate', goal: 'lose', sport: 'running' },
  { weight_lbs: 165, height_in: 67, age: 41, sex: 'female', activity: 'active', goal: 'gain', sport: 'crossfit' },
];

// BUG 3 REGRESSION: sport multipliers were applied to calories AND to each
// macro separately, so the macros summed up to 4.9% (~116 cal) above the
// stated calorie target and the rings visibly disagreed.
for (const p of PROFILES) {
  test(`${p.weight_lbs}lb ${p.sex} ${p.activity}/${p.goal}/${p.sport} — macros sum to target`, () => {
    const t = calculateTargets(p as any);
    const diff = Math.abs(kcal(t) - t.calories);
    assert.ok(diff <= 10, `macros = ${kcal(t)} but calories = ${t.calories} (off by ${diff})`);
  });
}

test('calculateTargets respects the activity multiplier', () => {
  const base = { weight_lbs: 185, height_in: 70, age: 30, sex: 'male', goal: 'maintain', sport: 'none' };
  const sed = calculateTargets({ ...base, activity: 'sedentary' } as any).calories;
  const vig = calculateTargets({ ...base, activity: 'very_active' } as any).calories;
  const bmr = mifflinBmr(base)!;
  assert.equal(sed, Math.round(bmr * ACTIVITY_MULTIPLIERS.sedentary));
  assert.equal(vig, Math.round(bmr * ACTIVITY_MULTIPLIERS.very_active));
  assert.ok(vig > sed);
});

test('lose target is exactly 650 below gain target (−400 vs +250)', () => {
  const base = { weight_lbs: 185, height_in: 70, age: 30, sex: 'male', activity: 'moderate', sport: 'none' };
  const lose = calculateTargets({ ...base, goal: 'lose' } as any).calories;
  const gain = calculateTargets({ ...base, goal: 'gain' } as any).calories;
  assert.equal(gain - lose, 650);
});

test('incomplete profile returns zeros, never NaN', () => {
  const t = calculateTargets({ weight_lbs: 0, height_in: 70, age: 30, sex: 'male', activity: 'moderate', goal: 'lose' } as any);
  assert.deepEqual(t, { calories: 0, protein: 0, carbs: 0, fat: 0 });
});

console.log('\nderiveMacrosFromCalories');

test('never exceeds the budget, even on an aggressive cut for a heavy user', () => {
  // BUG 4 REGRESSION: 1200 @ 300 lb previously produced 1257 cal of macros
  // because carbs floored at 0 while protein and fat kept full values.
  const cases: Array<[number, number]> = [
    [1200, 300], [1000, 280], [1400, 250], [900, 320], [1600, 185], [2800, 185],
  ];
  for (const [cal, w] of cases) {
    const m = deriveMacrosFromCalories(cal, { weight_lbs: w });
    assert.ok(kcal(m) <= cal + 10, `budget ${cal} @ ${w}lb produced ${kcal(m)} cal of macros`);
    assert.ok(m.protein >= 0 && m.carbs >= 0 && m.fat >= 0, 'negative macro');
  }
});

test('macros sum to the budget across a wide calorie sweep', () => {
  for (let cal = 1200; cal <= 5000; cal += 100) {
    const m = deriveMacrosFromCalories(cal, { weight_lbs: 185, sport: 'none' });
    assert.ok(Math.abs(kcal(m) - cal) <= 10, `${cal} → ${kcal(m)}`);
  }
});

test('protein scales with bodyweight at 0.8 g/lb', () => {
  assert.equal(deriveMacrosFromCalories(2800, { weight_lbs: 185 }).protein, 148);
  assert.equal(deriveMacrosFromCalories(2800, { weight_lbs: 200 }).protein, 160);
});

test('falls back to 30% of calories when weight is unknown', () => {
  assert.equal(deriveMacrosFromCalories(2000).protein, 150);
});

test('sport protein multiplier is applied', () => {
  const none = deriveMacrosFromCalories(3000, { weight_lbs: 185, sport: 'none' }).protein;
  const bb = deriveMacrosFromCalories(3000, { weight_lbs: 185, sport: 'bodybuilding' }).protein;
  assert.equal(bb, Math.round(none * 1.3));
});

test('handles zero and negative budgets without producing garbage', () => {
  for (const cal of [0, -500]) {
    const m = deriveMacrosFromCalories(cal, { weight_lbs: 185 });
    assert.equal(m.calories, 0);
    assert.ok(m.protein >= 0 && m.carbs >= 0 && m.fat >= 0);
    assert.ok(kcal(m) <= 10);
  }
});

console.log('\nKatch-McArdle / body composition');

test('lean mass = weight x (1 - bf%)', () => {
  assert.equal(leanMassLb(200, 20), 160);
  assert.equal(leanMassLb(150, 10), 135);
});

test('implausible or missing body fat returns null (no silent garbage)', () => {
  for (const bf of [null, undefined, 0, -5, 75, 120]) {
    assert.equal(leanMassLb(200, bf as any), null, `bf=${bf}`);
    assert.equal(katchMcArdleBmr(200, bf as any), null, `bf=${bf}`);
  }
  assert.equal(katchMcArdleBmr(null, 20), null);
});

test('Katch-McArdle: 200 lb @ 20% bf → 370 + 21.6 x 72.6 kg ≈ 1938', () => {
  const lbmKg = 200 * 0.8 * 0.453592;
  assert.equal(katchMcArdleBmr(200, 20), Math.round(370 + 21.6 * lbmKg));
  assert.equal(katchMcArdleBmr(200, 20), 1938);
});

test('estimateBmr prefers Katch when body fat is known, Mifflin otherwise', () => {
  const base = { weight_lbs: 200, height_in: 72, age: 30, sex: 'male' };
  const withBf = estimateBmr({ ...base, body_fat_pct: 15 });
  assert.equal(withBf.method, 'katch-mcardle');
  assert.equal(withBf.bmr, katchMcArdleBmr(200, 15));

  const withoutBf = estimateBmr(base);
  assert.equal(withoutBf.method, 'mifflin-st-jeor');
  assert.equal(withoutBf.bmr, mifflinBmr(base));

  assert.deepEqual(estimateBmr({ sex: 'male' }), { bmr: null, method: null });
});

// Mifflin is documented to underestimate muscular athletes; Katch should read
// higher for a lean, heavy user — that's the whole reason to prefer it.
test('Katch reads higher than Mifflin for a lean muscular user', () => {
  const p = { weight_lbs: 200, height_in: 70, age: 28, sex: 'male' };
  assert.ok(katchMcArdleBmr(200, 10)! > mifflinBmr(p)!);
});

test('Katch reads lower than Mifflin for a high body-fat user', () => {
  const p = { weight_lbs: 280, height_in: 70, age: 45, sex: 'male' };
  assert.ok(katchMcArdleBmr(280, 40)! < mifflinBmr(p)!);
});

console.log('\nGoal-aware protein (ISSN position stand)');

test('cutting prescribes more protein than maintaining or gaining', () => {
  const base = { weight_lbs: 185, sport: 'none' };
  const lose = deriveMacrosFromCalories(2400, { ...base, goal: 'lose' }).protein;
  const maint = deriveMacrosFromCalories(2400, { ...base, goal: 'maintain' }).protein;
  const gain = deriveMacrosFromCalories(2400, { ...base, goal: 'gain' }).protein;
  assert.ok(lose > gain && gain > maint, `lose=${lose} gain=${gain} maint=${maint}`);
  assert.equal(lose, 185); // 1.0 g/lb
  assert.equal(maint, 148); // 0.8 g/lb
});

test('cut protein lands in the ISSN 2.3-3.1 g/kg band for a lean user', () => {
  const w = 185;
  const p = deriveMacrosFromCalories(2400, { weight_lbs: w, goal: 'lose' }).protein;
  const gPerKg = p / (w * 0.453592);
  assert.ok(gPerKg >= 2.0 && gPerKg <= 3.1, `${gPerKg.toFixed(2)} g/kg outside band`);
});

test('lean-mass anchor lowers protein for a high body-fat user', () => {
  const bw = deriveMacrosFromCalories(2400, { weight_lbs: 280, goal: 'lose' }).protein;
  const lean = deriveMacrosFromCalories(2400, { weight_lbs: 280, goal: 'lose', body_fat_pct: 40 }).protein;
  assert.ok(lean < bw, `lean-anchored ${lean} should be below bodyweight-anchored ${bw}`);
});

test('lean-mass and bodyweight anchors agree for a ~15% bf user', () => {
  const bw = deriveMacrosFromCalories(2800, { weight_lbs: 185, goal: 'lose' }).protein;
  const lean = deriveMacrosFromCalories(2800, { weight_lbs: 185, goal: 'lose', body_fat_pct: 15 }).protein;
  assert.ok(Math.abs(lean - bw) <= 15, `bodyweight ${bw} vs lean ${lean} diverge too much`);
});

test('macros still sum to target with the new protein rules', () => {
  const cases = [
    { weight_lbs: 185, goal: 'lose', body_fat_pct: 15 },
    { weight_lbs: 280, goal: 'lose', body_fat_pct: 40 },
    { weight_lbs: 150, goal: 'gain', sport: 'wrestling' },
    { weight_lbs: 220, goal: 'lose', sport: 'bodybuilding', body_fat_pct: 12 },
  ];
  for (const p of cases) {
    for (const cal of [1400, 2000, 3200]) {
      const m = deriveMacrosFromCalories(cal, p as any);
      assert.ok(Math.abs(kcal(m) - cal) <= 10, `${JSON.stringify(p)} @ ${cal} → ${kcal(m)}`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
