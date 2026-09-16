/**
 * Open Food Facts serving basis.  Run with:  npm test
 *
 * The regression: a 30g bar whose OFF entry has only per-100g figures used to
 * come back with 100g's numbers under a "30 g" label — 3.3x high. Same shape
 * as the USDA per-100g bug fixed in ai-proxy, same root cause: values and the
 * serving they describe drifting apart.
 */
import assert from 'node:assert/strict';
import { normalizeOffProduct, parseServingGrams } from '../openFoodFacts';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

// A 30g protein bar: 400 kcal/100g, 20g protein/100g. OFF has no _serving.
const BAR_100G_ONLY = {
  product_name: 'Test Bar', brands: 'Acme',
  serving_size: '30 g', serving_quantity: 30,
  nutriments: {
    'energy-kcal_100g': 400, proteins_100g: 20, carbohydrates_100g: 45, fat_100g: 12,
    calcium_100g: 0.12, fiber_100g: 3,
  },
};

console.log('\nServing basis');

test('THE BUG: per-100g values on a 30g serving are scaled, not relabelled', () => {
  const r = normalizeOffProduct(BAR_100G_ONLY);
  assert.equal(r.basis, 'scaled-to-serving');
  assert.equal(r.serving_size, '30 g');
  assert.equal(r.calories, 120, 'was 400 — a whole bar reported as 3.3 bars');
  assert.equal(r.protein, 6);
  assert.equal(r.carbs, 13.5);
  assert.equal(r.fat, 3.6);
});

test('per-serving values from OFF are used as-is, never double-scaled', () => {
  const r = normalizeOffProduct({
    ...BAR_100G_ONLY,
    nutriments: { ...BAR_100G_ONLY.nutriments, 'energy-kcal_serving': 120, proteins_serving: 6 },
  });
  assert.equal(r.basis, 'per-serving');
  assert.equal(r.calories, 120);
  assert.equal(r.protein, 6);
});

test('unknown serving weight falls back to per-100g AND says so on the label', () => {
  const { serving_quantity, serving_size, ...noServing } = BAR_100G_ONLY;
  const r = normalizeOffProduct(noServing);
  assert.equal(r.basis, 'per-100g');
  assert.equal(r.serving_size, '100g', 'label must describe the numbers beside it');
  assert.equal(r.calories, 400);
});

test('the weight is read out of the serving_size STRING when the numeric field is absent', () => {
  const { serving_quantity, ...noQty } = BAR_100G_ONLY;
  const r = normalizeOffProduct(noQty);
  assert.equal(r.basis, 'scaled-to-serving', 'PR #1 recovers this; refusing it was lossy');
  assert.equal(r.calories, 120);
});

test('string serving_quantity (OFF sends these) is parsed', () => {
  const r = normalizeOffProduct({ ...BAR_100G_ONLY, serving_quantity: '30' });
  assert.equal(r.basis, 'scaled-to-serving');
  assert.equal(r.calories, 120);
});

console.log('\nNo mixed bases inside one food');

test("COUNCIL P1 + PR #1: the gel's weight is parsed from its label, so nothing is refused", () => {
  const r = normalizeOffProduct({
    product_name: 'Gel', serving_size: '1 sachet (40 g)',
    nutriments: {
      'energy-kcal_serving': 100, proteins_serving: 0,
      carbohydrates_100g: 60, fat_100g: 1,
    },
  });
  assert.equal(r.incomplete, false, '40 g is right there in the label');
  assert.equal(r.calories, 100);
  assert.equal(r.carbs, 24, '60g/100g scaled to the 40g sachet');
});

test('COUNCIL P1: with NO recoverable weight, the macro is refused, never zeroed', () => {
  const r = normalizeOffProduct({
    product_name: 'Gel', serving_size: '1 sachet',
    nutriments: {
      'energy-kcal_serving': 100, proteins_serving: 0,
      carbohydrates_100g: 60, fat_100g: 1,
    },
  });
  assert.equal(r.incomplete, true, 'must flag, not fabricate');
});

console.log('\nparseServingGrams (adopted from PR #1)');

test('numeric serving_quantity wins', () => {
  assert.equal(parseServingGrams('1 bar (45 g)', 30), 30);
  assert.equal(parseServingGrams(undefined, '30'), 30);
});

test('grams are read out of common label spellings', () => {
  assert.equal(parseServingGrams('30 g'), 30);
  assert.equal(parseServingGrams('30g'), 30);
  assert.equal(parseServingGrams('1 sachet (40 g)'), 40);
  assert.equal(parseServingGrams('1 bar (45.5 g)'), 45.5);
});

test('other units are NOT mistaken for grams', () => {
  assert.equal(parseServingGrams('500 mg'), null);
  assert.equal(parseServingGrams('1.5 kg'), null);
  assert.equal(parseServingGrams('1 cup'), null);
  assert.equal(parseServingGrams('2 cookies'), null);
  assert.equal(parseServingGrams(''), null);
  assert.equal(parseServingGrams(undefined, 0), null);
  assert.equal(parseServingGrams(undefined, -5), null);
});

test('a known serving weight converts the odd macro out instead of refusing', () => {
  const r = normalizeOffProduct({
    product_name: 'Gel', serving_size: '1 sachet (40 g)', serving_quantity: 40,
    nutriments: {
      'energy-kcal_serving': 100, proteins_serving: 0,
      carbohydrates_100g: 60, fat_100g: 1,
    },
  });
  assert.equal(r.incomplete, false);
  assert.equal(r.basis, 'per-serving');
  assert.equal(r.calories, 100);
  assert.equal(r.carbs, 24, '60g/100g scaled to a 40g sachet');
  assert.equal(r.fat, 0.4);
});

test('COUNCIL P2: no micronutrients are emitted at all while units are unverified', () => {
  const r = normalizeOffProduct(BAR_100G_ONLY) as any;
  assert.equal(r.calcium_mg, undefined);
  assert.equal(r.fiber_g, undefined);
  assert.equal(r.magnesium_mg, undefined);
});

test('a food readable at one basis is never flagged incomplete', () => {
  for (const p of [BAR_100G_ONLY, { ...BAR_100G_ONLY, serving_quantity: undefined }]) {
    assert.equal(normalizeOffProduct(p as any).incomplete, false);
  }
});

test('COUNCIL P3: the serving label is never the literal string "nullg"', () => {
  const cases = [
    { product_name: 'A', nutriments: { 'energy-kcal_serving': 100, proteins_serving: 2, carbohydrates_serving: 1, fat_serving: 0 } },
    { product_name: 'B', serving_quantity: 'not-a-number', nutriments: { 'energy-kcal_serving': 100, proteins_serving: 2, carbohydrates_serving: 1, fat_serving: 0 } },
    { product_name: 'C', serving_quantity: null as any, nutriments: { 'energy-kcal_100g': 400, proteins_100g: 2, carbohydrates_100g: 1, fat_100g: 0 } },
  ];
  for (const c of cases) {
    const label = normalizeOffProduct(c as any).serving_size;
    assert.ok(!/null|undefined|NaN/.test(label), `label was "${label}"`);
  }
});

console.log('\nJunk input');

test('an empty product does not throw and reports zeroes, not NaN', () => {
  const r = normalizeOffProduct({});
  assert.equal(r.name, 'Unknown Food');
  assert.equal(r.calories, 0);
  assert.equal(r.protein, 0);
  assert.equal(r.basis, 'per-100g');
  assert.equal(r.incomplete, false, 'a product with no nutrition data is empty, not mixed');
});

test('non-numeric and negative nutriments never reach the caller', () => {
  const r = normalizeOffProduct({
    product_name: 'Junk', serving_quantity: 30,
    nutriments: { 'energy-kcal_100g': 'abc', proteins_100g: null, fiber_100g: -5, calcium_100g: 0 },
  });
  assert.equal(r.calories, 0);
  assert.equal(r.protein, 0);
});

test('a bad serving_quantity falls through to the label text, not to nothing', () => {
  for (const q of [0, -10, 'x', undefined]) {
    const r = normalizeOffProduct({ ...BAR_100G_ONLY, serving_quantity: q as any });
    assert.equal(r.basis, 'scaled-to-serving', `serving_quantity=${q}`);
    assert.equal(r.calories, 120);
  }
});

test('no weight anywhere still falls back to per-100g with an honest label', () => {
  const { serving_quantity, serving_size, ...bare } = BAR_100G_ONLY;
  const r = normalizeOffProduct({ ...bare, serving_size: '1 cookie' } as any);
  assert.equal(r.basis, 'per-100g');
  assert.equal(r.serving_size, '100g');
  assert.equal(r.calories, 400);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
