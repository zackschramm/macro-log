/**
 * Open Food Facts → Fuelog nutrition.
 *
 * OFF stores every nutriment twice: `<key>_100g`, always per 100 g of product,
 * and `<key>_serving`, per the label serving — present only when OFF knows
 * what a serving weighs.
 *
 * BarcodeScanner used to take `_serving` when present and silently fall back
 * to `_100g` when it wasn't, while STILL labelling the result with the
 * product's own `serving_size` string. A 30 g bar reported the numbers for
 * 100 g of it and called that one serving: 3.3x high, from exactly the cause
 * that put 2-5x calorie errors into the USDA path (ai-proxy, Sep 2026).
 *
 * Two rules follow from that, and both are enforced below:
 *
 *   1. ONE BASIS PER FOOD. Every macro is read at the same basis, and the
 *      label always describes the numbers beside it. A food whose macros
 *      cannot all be read at a single basis is returned `incomplete` and the
 *      scanner refuses it — an earlier version of this file returned `?? 0`
 *      there, converting "cannot read this" into "measured zero grams of
 *      carbohydrate", which is worse than the bug it replaced.
 *
 *   2. MICRONUTRIENTS ARE CONVERTED, NOT COPIED. OFF normalises nutriments
 *      to GRAMS while the app's columns are mg/mcg (`calcium_mg`,
 *      `vitamin_d_mcg`), so a scanned calcium of 0.12 g was being written as
 *      0.12 mg — ~900x low. Three independent reads agree on the grams
 *      premise: OFF's own normalisation, AddFoodModal's existing guard
 *      comment ("Barcode micros come from Open Food Facts in grams per
 *      100 g"), and the review council's verifier.
 *
 *      Rather than trust that outright, every converted value passes a
 *      plausibility ceiling. If OFF ever turns out to be in mg, the x1000
 *      lands absurdly high and the value is DROPPED rather than stored — the
 *      guard fails safe in the only direction that can mislead an athlete.
 *
 *      SODIUM was never read at all, in any version of this file: the old
 *      NutritionResult had no sodium field, which is why scans showed none.
 *      It is also the best canary for the unit question, because labels state
 *      it in mg and the numbers are large — a 200 mg product must read 200,
 *      not 0.2 and not 200000. OFF carries salt far more often than sodium,
 *      so salt_100g is converted when sodium is absent.
 */

export interface OffNutriments { [key: string]: unknown }

export interface OffProduct {
  product_name?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: OffNutriments;
}

export type ServingBasis =
  /** OFF supplied per-serving values; used as-is. */
  | 'per-serving'
  /** Per-100g values scaled to a known serving weight. */
  | 'scaled-to-serving'
  /** Serving weight unknown; values are per 100 g and labelled as such. */
  | 'per-100g';

export interface OffNutrition {
  name: string;
  brand: string;
  serving_size: string;
  basis: ServingBasis;
  /**
   * True when OFF's macros cannot be read at any single basis. The caller MUST
   * NOT log the food: the macro fields are zeroed placeholders, not readings.
   */
  incomplete: boolean;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber_g: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
  vitamin_d_mcg: number | null;
  vitamin_c_mg: number | null;
  vitamin_b12_mcg: number | null;
  magnesium_mg: number | null;
  zinc_mg: number | null;
  potassium_mg: number | null;
  sodium_mg: number | null;
  omega3_g: number | null;
}

/**
 * column → [OFF per-serving key, OFF per-100g key, grams→column factor, ceiling]
 *
 * The ceiling is a "no food on earth" bound for ONE serving, not an RDA. It
 * exists only to catch a wrong unit premise: an mg-denominated source would
 * blow past it after the x1000 and the value gets dropped instead of written.
 */
const MICROS: [string, string, string, number, number][] = [
  ['fiber_g',         'fiber_serving',       'fiber_100g',       1,    100],
  ['calcium_mg',      'calcium_serving',     'calcium_100g',     1000, 5000],
  ['iron_mg',         'iron_serving',        'iron_100g',        1000, 200],
  ['vitamin_d_mcg',   'vitamin-d_serving',   'vitamin-d_100g',   1e6,  2000],
  ['vitamin_c_mg',    'vitamin-c_serving',   'vitamin-c_100g',   1000, 5000],
  ['vitamin_b12_mcg', 'vitamin-b12_serving', 'vitamin-b12_100g', 1e6,  1000],
  ['magnesium_mg',    'magnesium_serving',   'magnesium_100g',   1000, 2000],
  ['zinc_mg',         'zinc_serving',        'zinc_100g',        1000, 100],
  ['potassium_mg',    'potassium_serving',   'potassium_100g',   1000, 10000],
  ['sodium_mg',       'sodium_serving',      'sodium_100g',      1000, 15000],
  ['omega3_g',        'omega-3-fat_serving', 'omega-3-fat_100g', 1,    100],
];

/** Salt (NaCl) is 39.34% sodium by mass. OFF reports salt far more often. */
const SALT_TO_SODIUM = 0.3934;

const MACROS = [
  ['calories', 'energy-kcal_serving', 'energy-kcal_100g', 1],
  ['protein', 'proteins_serving', 'proteins_100g', 10],
  ['carbs', 'carbohydrates_serving', 'carbohydrates_100g', 10],
  ['fat', 'fat_serving', 'fat_100g', 10],
] as const;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Serving weight in grams.
 *
 * `serving_quantity` is OFF's numeric field, but it is often absent while
 * `serving_size` carries the weight right there in its text — "1 sachet
 * (40 g)", "30g", "1 bar (45 g)". Reading only the numeric field meant
 * refusing products whose weight was on the label; PR #1 (e9ee5ef, 6 Sep)
 * got this right before this file existed, and its regex is adopted here.
 *
 * The `g\b` boundary is what keeps "500 mg" and "1.5 kg" from matching.
 */
export function parseServingGrams(size?: string, quantity?: unknown): number | null {
  const q = num(quantity);
  if (q !== null && q > 0) return q;
  if (!size) return null;
  const m = String(size).match(/([\d.]+)\s*g\b/i);
  const g = m ? Number(m[1]) : NaN;
  return Number.isFinite(g) && g > 0 ? g : null;
}

export function normalizeOffProduct(p: OffProduct): OffNutrition {
  const n: OffNutriments = p.nutriments ?? {};
  const servingG = parseServingGrams(p.serving_size, p.serving_quantity);
  const knownServing = servingG !== null && servingG > 0;

  const rows = MACROS.map(([key, sKey, hKey, dp]) => ({
    key, dp, perServing: num(n[sKey]), per100: num(n[hKey]),
  }));
  const present = rows.filter(r => r.perServing !== null || r.per100 !== null);

  // With a known serving weight either basis can express every macro, so the
  // choice is cosmetic and we prefer the one matching the label. Without one,
  // only a basis every present macro is NATIVELY at is usable — converting
  // needs the weight we do not have.
  const allNativePerServing = present.length > 0 && present.every(r => r.perServing !== null);
  const allNativePer100 = present.length > 0 && present.every(r => r.per100 !== null);
  const anyPerServing = rows.some(r => r.perServing !== null);

  let basis: ServingBasis;
  let incomplete = false;
  if (knownServing) {
    basis = anyPerServing ? 'per-serving' : 'scaled-to-serving';
  } else if (allNativePerServing) {
    basis = 'per-serving';
  } else if (allNativePer100 || present.length === 0) {
    basis = 'per-100g';
  } else {
    // Mixed: one macro only per-serving, another only per-100g, and no weight
    // to convert between them. There is no honest number to report.
    basis = 'per-100g';
    incomplete = true;
  }

  const serving_size = basis === 'per-100g'
    ? '100g'
    : (p.serving_size || (knownServing ? `${servingG}g` : 'serving'));

  /** Reads one macro at `basis`, converting only when the weight is known. */
  const read = (r: { perServing: number | null; per100: number | null }): number | null => {
    if (basis === 'per-serving') {
      if (r.perServing !== null) return r.perServing;
      return r.per100 !== null && knownServing ? r.per100 * ((servingG as number) / 100) : null;
    }
    const factor = basis === 'scaled-to-serving' ? (servingG as number) / 100 : 1;
    if (r.per100 !== null) return r.per100 * factor;
    // Present only per-serving: expressible per-100g only with the weight.
    return r.perServing !== null && knownServing
      ? r.perServing / ((servingG as number) / 100) * factor
      : null;
  };

  const out = {
    name: p.product_name || p.generic_name || 'Unknown Food',
    brand: p.brands || '',
    serving_size,
    basis,
    incomplete,
    calories: 0, protein: 0, carbs: 0, fat: 0,
    fiber_g: null, calcium_mg: null, iron_mg: null, vitamin_d_mcg: null,
    vitamin_c_mg: null, vitamin_b12_mcg: null, magnesium_mg: null,
    zinc_mg: null, potassium_mg: null, sodium_mg: null, omega3_g: null,
  } as OffNutrition;

  for (const r of rows) {
    const v = read(r);
    if (v === null && (r.perServing !== null || r.per100 !== null)) {
      // OFF has this macro but not at a basis we can convert. Never report it
      // as zero — that is a measurement claim we cannot make.
      incomplete = true;
      continue;
    }
    (out as any)[r.key] = Math.max(0, Math.round((v ?? 0) * r.dp) / r.dp);
  }
  out.incomplete = incomplete;

  // Micronutrients, read at the SAME basis as the macros and converted from
  // OFF's grams into the column's own unit.
  for (const [col, servKey, per100Key, factor, ceiling] of MICROS) {
    let v = read({ perServing: num(n[servKey]), per100: num(n[per100Key]) });
    // Sodium: fall back to salt, which OFF carries far more often.
    if (v === null && col === 'sodium_mg') {
      const salt = read({ perServing: num(n['salt_serving']), per100: num(n['salt_100g']) });
      if (salt !== null) v = salt * SALT_TO_SODIUM;
    }
    if (v === null) continue;
    const converted = v * factor;
    // Fails safe: an implausible value means the unit premise was wrong for
    // this product, and a wrong micronutrient is worse than a missing one.
    if (!Number.isFinite(converted) || converted <= 0 || converted > ceiling) continue;
    (out as any)[col] = Math.round(converted * 100) / 100;
  }
  return out;
}
