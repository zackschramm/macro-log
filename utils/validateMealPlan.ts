/**
 * Meal plan validation.
 *
 * MealPlanScreen previously did `JSON.parse()` and saved whatever came back —
 * with one particularly bad line: if the output didn't end in `]` it appended
 * one, turning a truncated response into a silently incomplete week.
 *
 * Nothing checked the arithmetic. A model can return confident, well-formed
 * JSON where item macros don't sum to the meal totals, or the day lands 800
 * calories off target. Macro accuracy IS Fuelog's product, so a plan whose
 * numbers don't add up is worse than no plan.
 *
 * This matters most when routing generation to a local model (Qwen3.6-27B on
 * the 3090), which is weaker at arithmetic consistency than Claude — but Claude
 * drifts too, so the check is worth having either way.
 *
 * Pure functions, no React/Supabase, so it's testable with `npm test`.
 */

export interface MealItem {
  name: string;
  serving?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}
export interface Macros {
  calories: number; protein: number; carbs: number; fat: number;
}
export interface Meal {
  meal: string;
  items: MealItem[];
  totals?: Macros;
}
export interface DayPlan {
  day: string;
  meals: Meal[];
  totals?: Macros;
}

export type Severity = 'fatal' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  day?: string;
  meal?: string;
}

export interface ValidationResult {
  ok: boolean;                 // false = do not save, regenerate
  issues: ValidationIssue[];
  /** Plan with all totals recomputed from items — safe to save when ok. */
  repaired: DayPlan[];
}

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

/** Rounding slack when comparing summed macros. */
const SUM_TOLERANCE = { calories: 25, protein: 5, carbs: 5, fat: 3 };
/** How far a day may drift from target before it's a problem. */
const TARGET_TOLERANCE_PCT = 0.12;   // ±12%
const TARGET_FATAL_PCT = 0.25;       // beyond this the plan is unusable

const num = (v: any): number => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : NaN;
};

function sumItems(items: MealItem[]): Macros {
  return items.reduce<Macros>((acc, it) => ({
    calories: acc.calories + (num(it.calories) || 0),
    protein:  acc.protein  + (num(it.protein)  || 0),
    carbs:    acc.carbs    + (num(it.carbs)    || 0),
    fat:      acc.fat      + (num(it.fat)      || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function addMacros(a: Macros, b: Macros): Macros {
  return {
    calories: a.calories + b.calories, protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs, fat: a.fat + b.fat,
  };
}

const round = (m: Macros): Macros => ({
  calories: Math.round(m.calories), protein: Math.round(m.protein),
  carbs: Math.round(m.carbs), fat: Math.round(m.fat),
});

/**
 * Validate and repair a generated plan.
 *
 * Totals are RECOMPUTED from items rather than trusted — the items are what the
 * user actually eats and logs, so they're the source of truth. A mismatch is
 * still reported, because a large one means the model wasn't tracking its own
 * numbers and the item macros are probably suspect too.
 */
export function validateMealPlan(
  raw: unknown,
  targets?: Macros,
  opts?: { expectedDays?: number }
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const expectedDays = opts?.expectedDays ?? 7;

  if (!Array.isArray(raw)) {
    return {
      ok: false, repaired: [],
      issues: [{ severity: 'fatal', code: 'not_array', message: 'Response was not a JSON array of days.' }],
    };
  }

  const days = raw as DayPlan[];

  // Truncation is the #1 long-output failure — catch it explicitly rather than
  // appending a bracket and pretending the plan is complete.
  if (days.length < expectedDays) {
    issues.push({
      severity: 'fatal', code: 'missing_days',
      message: `Only ${days.length} of ${expectedDays} days were generated (likely truncated).`,
    });
  }

  const repaired: DayPlan[] = [];
  const seenDays = new Set<string>();

  for (const day of days) {
    if (!day || typeof day !== 'object' || !Array.isArray(day.meals)) {
      issues.push({ severity: 'fatal', code: 'bad_day', message: 'A day entry was malformed.' });
      continue;
    }
    const dayName = String(day.day ?? '').trim();
    if (!dayName) {
      issues.push({ severity: 'warning', code: 'unnamed_day', message: 'A day had no name.' });
    }
    if (dayName && seenDays.has(dayName)) {
      issues.push({
        severity: 'fatal', code: 'duplicate_day',
        message: `${dayName} appears more than once.`, day: dayName,
      });
    }
    seenDays.add(dayName);

    const repairedMeals: Meal[] = [];
    let dayTotal: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

    for (const meal of day.meals) {
      if (!meal || !Array.isArray(meal.items) || meal.items.length === 0) {
        issues.push({
          severity: 'fatal', code: 'empty_meal',
          message: `${dayName || 'A day'} has a meal with no items.`,
          day: dayName, meal: meal?.meal,
        });
        continue;
      }

      // Any non-numeric macro poisons every downstream total.
      for (const it of meal.items) {
        const bad = (['calories','protein','carbs','fat'] as const)
          .filter(k => !Number.isFinite(num((it as any)[k])));
        if (bad.length || !String(it.name ?? '').trim()) {
          issues.push({
            severity: 'fatal', code: 'bad_item',
            message: `"${it?.name ?? 'unnamed item'}" in ${meal.meal ?? 'a meal'} has invalid ${bad.join('/') || 'name'}.`,
            day: dayName, meal: meal.meal,
          });
        }
        if (num(it.calories) < 0 || num(it.protein) < 0 || num(it.carbs) < 0 || num(it.fat) < 0) {
          issues.push({
            severity: 'fatal', code: 'negative_macro',
            message: `"${it?.name}" has a negative macro value.`, day: dayName, meal: meal.meal,
          });
        }
      }

      const computed = round(sumItems(meal.items));

      if (meal.totals) {
        for (const k of ['calories','protein','carbs','fat'] as const) {
          const stated = num((meal.totals as any)[k]);
          if (Number.isFinite(stated) && Math.abs(stated - computed[k]) > SUM_TOLERANCE[k]) {
            issues.push({
              severity: 'warning', code: 'meal_total_mismatch',
              message: `${dayName} ${meal.meal}: stated ${k} ${stated} but items sum to ${computed[k]}.`,
              day: dayName, meal: meal.meal,
            });
          }
        }
      }

      repairedMeals.push({ ...meal, totals: computed });
      dayTotal = addMacros(dayTotal, computed);
    }

    const dayComputed = round(dayTotal);

    if (targets) {
      const drift = Math.abs(dayComputed.calories - targets.calories) / Math.max(targets.calories, 1);
      if (drift > TARGET_FATAL_PCT) {
        issues.push({
          severity: 'fatal', code: 'target_way_off',
          message: `${dayName}: ${dayComputed.calories} cal vs target ${targets.calories} (${Math.round(drift*100)}% off).`,
          day: dayName,
        });
      } else if (drift > TARGET_TOLERANCE_PCT) {
        issues.push({
          severity: 'warning', code: 'target_drift',
          message: `${dayName}: ${dayComputed.calories} cal vs target ${targets.calories} (${Math.round(drift*100)}% off).`,
          day: dayName,
        });
      }

      const pDrift = Math.abs(dayComputed.protein - targets.protein) / Math.max(targets.protein, 1);
      if (pDrift > TARGET_FATAL_PCT) {
        issues.push({
          severity: 'fatal', code: 'protein_way_off',
          message: `${dayName}: ${dayComputed.protein}g protein vs target ${targets.protein}g.`,
          day: dayName,
        });
      }
    }

    repaired.push({ ...day, meals: repairedMeals, totals: dayComputed });
  }

  return { ok: !issues.some(i => i.severity === 'fatal'), issues, repaired };
}

/**
 * Parse a model response into a plan, WITHOUT the old bracket-appending hack.
 * Returns null when the text isn't a recoverable JSON array.
 */
export function parseMealPlanResponse(rawText: string): unknown | null {
  const cleaned = (rawText || '').replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('[');
  if (start === -1) return null;

  // Walk the string tracking depth so we only accept a genuinely closed array —
  // a truncated response should FAIL here, not get patched into a short week.
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;   // never closed — truncated
}

/** One-line summary for logs / the retry decision. */
export function summarizeIssues(result: ValidationResult): string {
  if (result.issues.length === 0) return 'valid';
  const fatal = result.issues.filter(i => i.severity === 'fatal').length;
  const warn = result.issues.length - fatal;
  return `${fatal} fatal, ${warn} warning: ` +
    result.issues.slice(0, 3).map(i => i.code).join(', ');
}

export { DAYS };
