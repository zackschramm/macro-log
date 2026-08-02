/**
 * Meal plan validation tests.  Run with:  npm test
 *
 * These pin the failure modes a local model (Qwen3.6-27B on the 3090) is most
 * likely to produce: truncated output, totals that don't sum, and days that
 * miss the calorie target while looking perfectly well-formed.
 */
import assert from 'node:assert/strict';
import {
  validateMealPlan, parseMealPlanResponse, summarizeIssues, correctionFor, Macros,
} from '../validateMealPlan';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

const TARGETS: Macros = { calories: 2800, protein: 170, carbs: 300, fat: 90 };

/** A day whose four meals sum exactly to the targets. */
function goodDay(name: string): any {
  const meal = (m: string, cal: number, p: number, c: number, f: number) => ({
    meal: m,
    items: [{ name: `${m} food`, serving: '1 serving', calories: cal, protein: p, carbs: c, fat: f }],
    totals: { calories: cal, protein: p, carbs: c, fat: f },
  });
  return {
    day: name,
    meals: [
      meal('Breakfast', 700, 42, 75, 22),
      meal('Lunch',     700, 43, 75, 23),
      meal('Dinner',    900, 55, 95, 29),
      meal('Snack',     500, 30, 55, 16),
    ],
    totals: { calories: 2800, protein: 170, carbs: 300, fat: 90 },
  };
}
const WEEK = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const goodWeek = () => WEEK.map(goodDay);

console.log('\nHappy path');

test('a correct week validates clean', () => {
  const r = validateMealPlan(goodWeek(), TARGETS);
  assert.equal(r.ok, true, summarizeIssues(r));
  assert.equal(r.issues.length, 0);
  assert.equal(r.repaired.length, 7);
});

test('totals are recomputed from items, not trusted', () => {
  const week = goodWeek();
  week[0].meals[0].totals = { calories: 99999, protein: 0, carbs: 0, fat: 0 };  // lie
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.repaired[0].meals[0].totals!.calories, 700, 'should use the item sum');
  assert.ok(r.issues.some(i => i.code === 'meal_total_mismatch'));
});

console.log('\nTruncation — the main long-output failure');

test('a short week is fatal, not silently accepted', () => {
  const r = validateMealPlan(goodWeek().slice(0, 4), TARGETS);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'missing_days'));
});

test('parse REFUSES truncated JSON instead of patching a bracket', () => {
  // This is what the old code did: append ']' and save an incomplete plan.
  const truncated = '[{"day":"Monday","meals":[{"meal":"Breakfast","items":[{"name":"Oats"';
  assert.equal(parseMealPlanResponse(truncated), null);
});

test('parse handles markdown fences and surrounding prose', () => {
  const wrapped = 'Here you go!\n```json\n[{"day":"Monday","meals":[]}]\n```\nEnjoy.';
  const parsed = parseMealPlanResponse(wrapped) as any[];
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].day, 'Monday');
});

test('parse is not fooled by brackets inside strings', () => {
  const tricky = '[{"day":"Monday]","meals":[]}]';
  const parsed = parseMealPlanResponse(tricky) as any[];
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].day, 'Monday]');
});

test('parse returns null on junk', () => {
  assert.equal(parseMealPlanResponse('I cannot help with that.'), null);
  assert.equal(parseMealPlanResponse(''), null);
});

console.log('\nArithmetic and target drift');

test('a day far off the calorie target is fatal', () => {
  const week = goodWeek();
  week[2].meals.forEach((m: any) => {
    m.items[0].calories = Math.round(m.items[0].calories * 0.5);   // ~50% under
  });
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'target_way_off' && i.day === 'Wednesday'));
});

test('mild drift is a warning, not a rejection', () => {
  const week = goodWeek();
  week[1].meals[0].items[0].calories += 250;   // ~9% over
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.ok, true, summarizeIssues(r));
});

test('badly missed protein is fatal (it is the macro that matters most)', () => {
  const week = goodWeek();
  week[0].meals.forEach((m: any) => { m.items[0].protein = Math.round(m.items[0].protein * 0.4); });
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'protein_way_off'));
});

console.log('\nMalformed output');

test('non-numeric macros are caught, not coerced to NaN totals', () => {
  const week = goodWeek();
  week[0].meals[0].items[0].calories = 'about 700' as any;
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'bad_item'));
  assert.ok(Number.isFinite(r.repaired[0].totals!.calories), 'totals must never be NaN');
});

test('negative macros are rejected', () => {
  const week = goodWeek();
  week[3].meals[1].items[0].fat = -10;
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'negative_macro'));
});

test('an empty meal is fatal', () => {
  const week = goodWeek();
  week[0].meals[1].items = [];
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'empty_meal'));
});

test('duplicated days are caught (models repeat under long output)', () => {
  const week = goodWeek();
  week[5] = goodDay('Monday');
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.code === 'duplicate_day'));
});

test('a non-array response fails cleanly', () => {
  const r = validateMealPlan({ oops: true } as any, TARGETS);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, 'not_array');
  assert.deepEqual(r.repaired, []);
});

test('validates without targets (targets optional)', () => {
  const r = validateMealPlan(goodWeek());
  assert.equal(r.ok, true, summarizeIssues(r));
});

console.log('\nRetry correction — the retry used to resend an identical prompt');

test('a valid plan produces no correction text', () => {
  assert.equal(correctionFor(validateMealPlan(goodWeek(), TARGETS)), '');
});

test('warnings alone produce no correction — only fatals are worth a retry', () => {
  const week = goodWeek();
  // Nudge one day into the warning band (>12%) but under fatal (25%).
  week[0].meals[0].items[0].calories += Math.round(TARGETS.calories * 0.15);
  const r = validateMealPlan(week, TARGETS);
  assert.ok(r.ok, 'should still be savable');
  assert.ok(r.issues.some(i => i.severity === 'warning'));
  assert.equal(correctionFor(r), '');
});

test('fatal misses become an instruction naming the day and the gap', () => {
  const week = goodWeek();
  week[1].meals[0].items[0].calories -= Math.round(TARGETS.calories * 0.4);
  const r = validateMealPlan(week, TARGETS);
  assert.equal(r.ok, false);
  const c = correctionFor(r);
  assert.ok(c.includes('REJECTED'), 'must tell the model the attempt failed');
  assert.ok(c.includes('Tuesday'), 'must name the offending day');
  assert.ok(/\d+% off/.test(c), 'must quantify the miss');
});

test('the correction asks for a tighter band than the validator enforces', () => {
  // Asking for exactly the fatal threshold would put every near-miss back
  // over the line on the retry.
  const week = goodWeek();
  week[2].meals[0].items[0].protein -= Math.round(TARGETS.protein * 0.5);
  const c = correctionFor(validateMealPlan(week, TARGETS));
  assert.ok(c.includes('10%'));
});

test('a wholesale failure is truncated rather than dumping every day', () => {
  const week = goodWeek().map(d => {
    d.meals[0].items[0].calories -= Math.round(TARGETS.calories * 0.4);
    return d;
  });
  const r = validateMealPlan(week, TARGETS);
  const c = correctionFor(r, 3);
  assert.equal((c.match(/^- /gm) ?? []).length, 4, '3 issues + the "and N more" line');
  assert.ok(c.includes('more of the same kind'));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
