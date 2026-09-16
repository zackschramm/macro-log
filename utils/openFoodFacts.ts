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
 *   2. NO MICRONUTRIENTS, for now. OFF normalises nutriments to grams while
 *      the app's columns are mg/mcg (`calcium_mg`, `vitamin_d_mcg`), so a
 *      scanned calcium of 0.12 g was being written as 0.12 mg — ~900x low,
 *      and durable: AddFoodModal already guards the `user_foods` insert
 *      against exactly this ("persisting them here would make the wrong
 *      numbers durable") but writes `macro_logs` unfiltered, and that is the
 *      table both micronutrient screens read. Emitting nothing is the only
 *      option that is correct whichever way the unit question resolves.
 *      Re-enable by scanning one fortified product, comparing the label to
 *      what OFF returns, and adding the conversion with a test.
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
}

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
  const read = (r: typeof rows[number]): number | null => {
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
  return out;
}
