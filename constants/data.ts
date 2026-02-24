export const FOODS = [
  { name: 'Eggs (1 whole)', calories: 78, protein: 6, carbs: 0.6, fat: 5 },
  { name: 'Ground Beef (100g)', calories: 254, protein: 26, carbs: 0, fat: 17 },
  { name: 'Chicken Breast (100g)', calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: 'White Rice, cooked (1 cup)', calories: 206, protein: 4, carbs: 45, fat: 0.4 },
  { name: 'Potato, medium (150g)', calories: 130, protein: 3, carbs: 30, fat: 0.1 },
  { name: 'Carrots (100g)', calories: 41, protein: 0.9, carbs: 10, fat: 0.2 },
  { name: 'Asparagus (100g)', calories: 20, protein: 2.2, carbs: 3.7, fat: 0.1 },
];

export const MEALS = ['Breakfast', 'Lunch', 'Pre-Workout', 'Dinner', 'Evening Snack'];

export const MC = {
  protein: { color: '#4a9eff', bg: 'rgba(74,158,255,0.15)' },
  carbs:   { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
  fat:     { color: '#f472b6', bg: 'rgba(244,114,182,0.15)' },
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

// Mifflin-St Jeor BMR calculator
export function calculateTargets(profile: {
  weight_lbs: number; height_in: number; age: number;
  sex: string; activity: string; goal: string;
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
  const calories = Math.round(tdee + (goalMap[profile.goal] || 0));
  const protein = Math.round(profile.weight_lbs * 0.8);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.round((calories - protein * 4 - fat * 9) / 4);

  return { calories, protein, carbs, fat };
}
