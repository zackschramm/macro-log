export const FOODS = [
  { name: 'Eggs (1 whole)', calories: 78, protein: 6, carbs: 0.6, fat: 5 },
  { name: 'Ground Beef (100g)', calories: 254, protein: 26, carbs: 0, fat: 17 },
  { name: 'Chicken Breast (100g)', calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: 'White Rice, cooked (1 cup)', calories: 206, protein: 4, carbs: 45, fat: 0.4 },
  { name: 'Potato, medium (150g)', calories: 130, protein: 3, carbs: 30, fat: 0.1 },
  { name: 'Carrots (100g)', calories: 41, protein: 0.9, carbs: 10, fat: 0.2 },
  { name: 'Asparagus (100g)', calories: 20, protein: 2.2, carbs: 3.7, fat: 0.1 },
];

export const MEALS = ['Breakfast', 'Lunch', 'Pre-Workout', 'Drink Mix', 'Supplements', 'Dinner', 'Evening Snack'];

export const MC = {
  protein: { color: '#4A9EFF', bg: 'rgba(74,158,255,0.15)' },
  carbs:   { color: '#F5A623', bg: 'rgba(245,166,35,0.15)' },
  fat:     { color: '#F472B6', bg: 'rgba(244,114,182,0.15)' },
};

export const WORKOUT_PLAN = [
  {
    day: 'Day 1', name: 'Upper — Push', type: 'training',
    exercises: [
      { id: 'd1e1', name: 'Barbell Bench Press', sets: 4, reps: '6-8' },
      { id: 'd1e2', name: 'Incline Dumbbell Press', sets: 3, reps: '8-10' },
      { id: 'd1e3', name: 'Overhead Press', sets: 3, reps: '8-10' },
      { id: 'd1e4', name: 'Cable Lateral Raises', sets: 3, reps: '12-15' },
      { id: 'd1e5', name: 'Tricep Pushdowns', sets: 3, reps: '10-12' },
    ],
  },
  {
    day: 'Day 2', name: 'Lower — Quads', type: 'training',
    exercises: [
      { id: 'd2e1', name: 'Barbell Back Squat', sets: 4, reps: '6-8' },
      { id: 'd2e2', name: 'Romanian Deadlift', sets: 3, reps: '8-10' },
      { id: 'd2e3', name: 'Leg Press', sets: 3, reps: '10-12' },
      { id: 'd2e4', name: 'Walking Lunges', sets: 3, reps: '12 each' },
      { id: 'd2e5', name: 'Leg Curl', sets: 3, reps: '12-15' },
    ],
  },
  { day: 'Day 3', name: 'Rest Day', type: 'rest', exercises: [] },
  {
    day: 'Day 4', name: 'Upper — Pull', type: 'training',
    exercises: [
      { id: 'd4e1', name: 'Barbell Row', sets: 4, reps: '6-8' },
      { id: 'd4e2', name: 'Weighted Pull-Ups / Lat Pulldown', sets: 3, reps: '8-10' },
      { id: 'd4e3', name: 'Seated Cable Row', sets: 3, reps: '10-12' },
      { id: 'd4e4', name: 'Face Pulls', sets: 3, reps: '15' },
      { id: 'd4e5', name: 'Dumbbell Curl', sets: 3, reps: '10-12' },
    ],
  },
  {
    day: 'Day 5', name: 'Lower — Glutes', type: 'training',
    exercises: [
      { id: 'd5e1', name: 'Conventional Deadlift', sets: 4, reps: '5' },
      { id: 'd5e2', name: 'Bulgarian Split Squat', sets: 3, reps: '8-10 each' },
      { id: 'd5e3', name: 'Hip Thrust', sets: 3, reps: '10-12' },
      { id: 'd5e4', name: 'Leg Extension', sets: 3, reps: '12-15' },
      { id: 'd5e5', name: 'Standing Calf Raise', sets: 4, reps: '15' },
    ],
  },
  {
    day: 'Day 6', name: 'Arms & Weak Points', type: 'training',
    exercises: [
      { id: 'd6e1', name: 'Barbell Curl', sets: 3, reps: '10-12' },
      { id: 'd6e2', name: 'Hammer Curl', sets: 3, reps: '10-12' },
      { id: 'd6e3', name: 'Skull Crushers', sets: 3, reps: '10-12' },
      { id: 'd6e4', name: 'Overhead Tricep Extension', sets: 3, reps: '10-12' },
      { id: 'd6e5', name: 'Cable Curl', sets: 3, reps: '12-15' },
    ],
  },
  { day: 'Day 7', name: 'Rest Day', type: 'rest', exercises: [] },
];

// Sport-specific macro multipliers applied on top of base calculation.
// NOTE: `carbs` is retained for documentation/intent only — carbohydrate is the
// balancing macro in deriveMacrosFromCalories (it absorbs whatever calories are
// left after protein and fat), so it cannot also be scaled independently without
// breaking the invariant that the macros sum to the calorie target.
export const SPORT_MULTIPLIERS: Record<string, { protein: number; carbs: number; fat: number; cal: number }> = {
  none:         { protein: 1.0,  carbs: 1.0,  fat: 1.0,  cal: 1.0  },
  bodybuilding: { protein: 1.3,  carbs: 1.1,  fat: 0.9,  cal: 1.05 },
  powerlifting: { protein: 1.25, carbs: 1.15, fat: 1.1,  cal: 1.1  },
  crossfit:     { protein: 1.2,  carbs: 1.3,  fat: 0.9,  cal: 1.1  },
  running:      { protein: 0.95, carbs: 1.4,  fat: 0.9,  cal: 1.15 },
  cycling:      { protein: 0.95, carbs: 1.45, fat: 0.9,  cal: 1.15 },
  swimming:     { protein: 1.1,  carbs: 1.25, fat: 0.95, cal: 1.1  },
  basketball:   { protein: 1.1,  carbs: 1.3,  fat: 0.9,  cal: 1.1  },
  soccer:       { protein: 1.05, carbs: 1.35, fat: 0.9,  cal: 1.1  },
  football:     { protein: 1.3,  carbs: 1.2,  fat: 1.0,  cal: 1.1  },
  baseball:     { protein: 1.1,  carbs: 1.1,  fat: 1.0,  cal: 1.0  },
  tennis:       { protein: 1.05, carbs: 1.3,  fat: 0.95, cal: 1.1  },
  wrestling:    { protein: 1.35, carbs: 1.0,  fat: 0.85, cal: 1.0  },
  gymnastics:   { protein: 1.2,  carbs: 1.1,  fat: 0.85, cal: 0.95 },
  volleyball:   { protein: 1.1,  carbs: 1.2,  fat: 0.9,  cal: 1.05 },
  hockey:       { protein: 1.15, carbs: 1.3,  fat: 0.95, cal: 1.1  },
  golf:         { protein: 1.0,  carbs: 1.05, fat: 1.0,  cal: 1.0  },
  climbing:     { protein: 1.25, carbs: 1.1,  fat: 0.9,  cal: 1.0  },
  yoga:         { protein: 0.95, carbs: 0.95, fat: 1.0,  cal: 0.95 },
  rowing:       { protein: 1.2,  carbs: 1.4,  fat: 0.9,  cal: 1.15 },
  triathlon:    { protein: 1.1,  carbs: 1.4,  fat: 0.9,  cal: 1.2  },
  hiking:       { protein: 1.05, carbs: 1.2,  fat: 1.0,  cal: 1.05 },
  // Distance-specific triathlon. These are FALLBACKS ONLY — when session data
  // is available, utils/enduranceFueling.ts computes the day from the day's
  // actual training instead, which is the whole point of that module. A single
  // multiplier cannot express a requirement that swings 4x between a rest day
  // and a 6-hour brick; these exist so a user with no wearable still gets
  // something distance-appropriate rather than generic.
  tri_sprint:   { protein: 1.1,  carbs: 1.25, fat: 0.95, cal: 1.1  },
  tri_olympic:  { protein: 1.1,  carbs: 1.35, fat: 0.9,  cal: 1.15 },
  tri_70_3:     { protein: 1.1,  carbs: 1.45, fat: 0.9,  cal: 1.2  },
  tri_ironman:  { protein: 1.1,  carbs: 1.55, fat: 0.85, cal: 1.3  },
};

/**
 * Sports whose daily requirements swing too much for a static multiplier to
 * describe. When the user's sport is one of these and we have session data,
 * callers should route through `utils/enduranceFueling.ts` rather than
 * `deriveMacrosFromCalories`.
 *
 * This used to be a hardcoded `ENDURANCE_SPORTS` set living right here. It is
 * now derived from `constants/sportArchetypes.ts`, which assigns all 26 sports
 * to one of six archetypes and says what each archetype's model supports. Same
 * answer for endurance, one source of truth, and no second and third set to
 * grow beside it.
 *
 * Re-exported (rather than moved outright) so the existing call sites in
 * ProfileScreen, TrialEndingCard and buildCoachContext keep working. New code
 * should import `capabilitiesFor` from sportArchetypes and ask about the
 * capability it actually cares about.
 */
export { isEnduranceSport, archetypeOf, capabilitiesFor } from './sportArchetypes';

/**
 * Calorie adjustment applied to maintenance for each goal.
 *
 * SINGLE SOURCE OF TRUTH — every path that turns a TDEE into a calorie target
 * must import this. It previously existed as three separate copies (here,
 * utils/tdee.ts, and components/CalorieBurnModal.tsx) which drifted apart, so a
 * user's target shifted by up to 100 cal/day depending on whether HealthKit was
 * authorized.
 *
 * -400 ≈ 0.8 lb/week loss (sustainable and visible).
 * +250 is a lean-gain rate; larger surpluses add fat faster than most want.
 */
export const GOAL_ADJUSTMENTS = { lose: -400, maintain: 0, gain: 250 } as const;

/** Goal identifiers used by the UI/TDEE layer. */
export type UserGoal = 'lose_fat' | 'build_muscle' | 'maintain';

/**
 * Same adjustments as GOAL_ADJUSTMENTS, keyed by the UserGoal labels the UI
 * uses. Derived — never hardcode these values again.
 *
 * Lives here (rather than in utils/tdee.ts) so it can be imported without
 * pulling in AsyncStorage/supabase/HealthKit. tdee.ts re-exports it.
 */
export const USER_GOAL_ADJUSTMENTS: Record<UserGoal, number> = {
  lose_fat: GOAL_ADJUSTMENTS.lose,
  build_muscle: GOAL_ADJUSTMENTS.gain,
  maintain: GOAL_ADJUSTMENTS.maintain,
};

export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};
export const DEFAULT_ACTIVITY_MULTIPLIER = 1.55;

/**
 * Protein in g per lb of BODYWEIGHT, by goal, before sport adjustment.
 *
 * Grounded in the ISSN position stand on protein and exercise: 1.4-2.0 g/kg
 * (~0.64-0.91 g/lb) for general training, rising to 2.3-3.1 g/kg (~1.0-1.4 g/lb)
 * during energy restriction to protect lean mass. A flat 0.8 across all goals
 * (the previous behaviour) under-prescribed protein on a cut by ~25%.
 */
export const PROTEIN_G_PER_LB_BY_GOAL: Record<string, number> = {
  lose: 1.0, maintain: 0.8, gain: 0.9,
};

/**
 * Protein in g per lb of LEAN MASS, used instead of the bodyweight anchor when
 * body fat % is known. Bodyweight anchoring over-prescribes protein for higher
 * body-fat users (adipose tissue has negligible protein demand). Calibrated so
 * a lean user (~15% bf) lands on the same number as the bodyweight path.
 */
export const PROTEIN_G_PER_LB_LEAN_BY_GOAL: Record<string, number> = {
  lose: 1.2, maintain: 0.95, gain: 1.05,
};

/** Fallback when goal is unknown. */
export const PROTEIN_G_PER_LB = 0.8;
/** Share of calories allocated to fat, before sport adjustment. */
export const FAT_CALORIE_SHARE = 0.25;
/** Never program fat below this (g/lb) — hormonal/absorption floor. */
export const FAT_FLOOR_G_PER_LB = 0.25;

export interface BmrProfile {
  weight_lbs?: number | null;
  height_in?: number | null;
  age?: number | null;
  sex?: string | null;
  /** Latest measured body fat %, e.g. from inbody_logs.body_fat_pct. */
  body_fat_pct?: number | null;
}

/** Lean body mass in lb, or null if body fat % is unknown/implausible. */
export function leanMassLb(
  weightLbs?: number | null,
  bodyFatPct?: number | null
): number | null {
  if (!weightLbs || bodyFatPct == null) return null;
  if (bodyFatPct <= 0 || bodyFatPct >= 75) return null; // fat-finger guard
  return weightLbs * (1 - bodyFatPct / 100);
}

/**
 * Katch-McArdle BMR: 370 + 21.6 x lean mass (kg).
 *
 * Unlike Mifflin it works from body composition rather than sex/height/age, so
 * it doesn't systematically underestimate muscular athletes — a documented
 * weakness of Mifflin in that population. Only usable when body fat % is known.
 */
export function katchMcArdleBmr(
  weightLbs?: number | null,
  bodyFatPct?: number | null
): number | null {
  const lbm = leanMassLb(weightLbs, bodyFatPct);
  if (lbm === null) return null;
  return Math.round(370 + 21.6 * (lbm * 0.453592));
}

/**
 * Best available BMR estimate: Katch-McArdle when body composition is known,
 * Mifflin-St Jeor otherwise. This is what callers should use.
 */
export function estimateBmr(p: BmrProfile | null | undefined): {
  bmr: number | null;
  method: 'katch-mcardle' | 'mifflin-st-jeor' | null;
} {
  const katch = katchMcArdleBmr(p?.weight_lbs, p?.body_fat_pct);
  if (katch !== null) return { bmr: katch, method: 'katch-mcardle' };
  const mifflin = mifflinBmr(p);
  if (mifflin !== null) return { bmr: mifflin, method: 'mifflin-st-jeor' };
  return { bmr: null, method: null };
}

/**
 * Mifflin-St Jeor BMR. Returns null when stats are incomplete.
 *
 * SINGLE SOURCE OF TRUTH — this used to be duplicated with *opposite* fallbacks
 * (data.ts defaulted unknown sex to female, tdee.ts to male), producing a 166 cal
 * swing for the same user. Unknown/other sex now resolves explicitly to the
 * midpoint of the two sex constants (-78) rather than silently picking one.
 */
export function mifflinBmr(p: BmrProfile | null | undefined): number | null {
  if (!p?.weight_lbs || !p?.height_in || !p?.age) return null;
  const kg = p.weight_lbs * 0.453592;
  const cm = p.height_in * 2.54;
  const sexConstant =
    p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78; // -78 = midpoint
  return Math.round(10 * kg + 6.25 * cm - 5 * p.age + sexConstant);
}

export function calculateTargets(profile: {
  weight_lbs: number; height_in: number; age: number;
  sex: string; activity: string; goal: string; sport?: string;
  body_fat_pct?: number | null;
}) {
  const { bmr } = estimateBmr(profile);
  if (bmr === null) return { calories: 0, protein: 0, carbs: 0, fat: 0 };

  const tdee =
    bmr * (ACTIVITY_MULTIPLIERS[profile.activity] || DEFAULT_ACTIVITY_MULTIPLIER);

  const adjustment =
    GOAL_ADJUSTMENTS[profile.goal as keyof typeof GOAL_ADJUSTMENTS] ?? 0;
  const m = SPORT_MULTIPLIERS[profile.sport || 'none'] || SPORT_MULTIPLIERS.none;

  // Sport calorie multiplier is applied to the budget, then macros are derived
  // FROM that budget. Applying per-macro multipliers separately (the old
  // behaviour) meant the macros didn't reconstruct the stated calorie number —
  // off by up to 4.9% (~95-116 cal/day), so the rings visibly disagreed.
  const calories = Math.round((tdee + adjustment) * m.cal);

  return deriveMacrosFromCalories(calories, profile);
}

/**
 * Derive protein/carbs/fat from a known calorie budget (e.g. a measured-burn
 * TDEE target). The calorie number is ground truth: carbs absorb the remainder
 * so the macros always sum back to it.
 */
export function deriveMacrosFromCalories(
  calories: number,
  profile?: {
    weight_lbs?: number | null;
    sport?: string | null;
    goal?: string | null;
    body_fat_pct?: number | null;
  }
): { calories: number; protein: number; carbs: number; fat: number } {
  const cal = Math.max(0, Math.round(calories));
  const m = SPORT_MULTIPLIERS[profile?.sport || 'none'] || SPORT_MULTIPLIERS.none;
  const weight = profile?.weight_lbs || null;
  const goal = profile?.goal || 'maintain';

  // Protein anchor, in priority order:
  //   1. lean mass (most accurate — needs body fat %)
  //   2. bodyweight, goal-adjusted
  //   3. 30% of calories when weight is unknown
  const lean = leanMassLb(weight, profile?.body_fat_pct);
  let protein: number;
  if (lean !== null) {
    const perLbLean =
      PROTEIN_G_PER_LB_LEAN_BY_GOAL[goal] ?? PROTEIN_G_PER_LB_LEAN_BY_GOAL.maintain;
    protein = Math.round(lean * perLbLean * m.protein);
  } else if (weight) {
    const perLb = PROTEIN_G_PER_LB_BY_GOAL[goal] ?? PROTEIN_G_PER_LB;
    protein = Math.round(weight * perLb * m.protein);
  } else {
    protein = Math.round((cal * 0.3) / 4);
  }
  let fat = Math.round((cal * FAT_CALORIE_SHARE * m.fat) / 9);

  // Guard: on an aggressive deficit for a heavier user, protein + fat can
  // exceed the whole budget. Carbs used to floor at 0 while protein and fat
  // kept their full values, so the macros summed to MORE than the target
  // (e.g. 1200 cal budget @ 300 lb produced 1257 cal of macros). Walk fat down
  // to its floor first, then protein, so the invariant always holds.
  if (protein * 4 + fat * 9 > cal) {
    const fatFloor = weight
      ? Math.round(weight * FAT_FLOOR_G_PER_LB)
      : Math.round((cal * 0.15) / 9);
    fat = Math.max(0, Math.min(fat, Math.max(fatFloor, Math.floor((cal - protein * 4) / 9))));

    if (protein * 4 + fat * 9 > cal) {
      protein = Math.max(0, Math.floor((cal - fat * 9) / 4));
    }
  }

  const carbs = Math.max(0, Math.round((cal - protein * 4 - fat * 9) / 4));
  return { calories: cal, protein, carbs, fat };
}
