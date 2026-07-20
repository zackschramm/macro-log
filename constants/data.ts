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

// Sport-specific macro multipliers applied on top of base calculation
const SPORT_MULTIPLIERS: Record<string, { protein: number; carbs: number; fat: number; cal: number }> = {
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
};

// Mifflin-St Jeor BMR calculator
export function calculateTargets(profile: {
  weight_lbs: number; height_in: number; age: number;
  sex: string; activity: string; goal: string; sport?: string;
}) {
  const kg = profile.weight_lbs * 0.453592;
  const cm = profile.height_in * 2.54;
  const bmr = profile.sex === 'male'
    ? 10 * kg + 6.25 * cm - 5 * profile.age + 5
    : 10 * kg + 6.25 * cm - 5 * profile.age - 161;

  const activityMap: Record<string, number> = {
    sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
  };
  const tdee = bmr * (activityMap[profile.activity] || 1.55);

  const goalMap: Record<string, number> = {
    lose: -300, maintain: 0, gain: 300,
  };
  const baseCalories = tdee + (goalMap[profile.goal] || 0);
  const baseProtein = profile.weight_lbs * 0.8;
  const baseFat = (baseCalories * 0.25) / 9;
  const baseCarbs = (baseCalories - baseProtein * 4 - baseFat * 9) / 4;

  // Apply sport multipliers if a sport is set
  const m = SPORT_MULTIPLIERS[profile.sport || 'none'] || SPORT_MULTIPLIERS.none;
  const calories = Math.round(baseCalories * m.cal);
  const protein = Math.round(baseProtein * m.protein);
  const fat = Math.round(baseFat * m.fat);
  const carbs = Math.round(baseCarbs * m.carbs);

  return { calories, protein, carbs, fat };
}

// Derive protein/carbs/fat from a known calorie budget (e.g. a measured-burn
// TDEE target). Unlike calculateTargets, the calorie number is treated as
// ground truth, so carbs absorb the remainder and the macros always sum to it.
export function deriveMacrosFromCalories(
  calories: number,
  profile?: { weight_lbs?: number | null; sport?: string | null }
): { calories: number; protein: number; carbs: number; fat: number } {
  const cal = Math.round(calories);
  const m = SPORT_MULTIPLIERS[profile?.sport || 'none'] || SPORT_MULTIPLIERS.none;
  // Protein anchored to bodyweight (0.8 g/lb, sport-adjusted) like
  // calculateTargets; 30% of calories when weight is unknown.
  const protein = profile?.weight_lbs
    ? Math.round(profile.weight_lbs * 0.8 * m.protein)
    : Math.round((cal * 0.3) / 4);
  const fat = Math.round((cal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((cal - protein * 4 - fat * 9) / 4));
  return { calories: cal, protein, carbs, fat };
}
