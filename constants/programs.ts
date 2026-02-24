export const PRESET_PROGRAMS = [
  {
    id: 'upper_lower',
    name: 'Upper / Lower Split',
    description: '4-day split for muscle building',
    level: 'Intermediate',
    days: [
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
    ],
  },
  {
    id: 'strength',
    name: 'Strength Program',
    description: 'Heavy compound lifts, low reps, big gains',
    level: 'Intermediate',
    days: [
      {
        day: 'Day 1', name: 'Squat Day', type: 'training',
        exercises: [
          { id: 's1e1', name: 'Barbell Back Squat', sets: 5, reps: '3-5' },
          { id: 's1e2', name: 'Romanian Deadlift', sets: 3, reps: '5' },
          { id: 's1e3', name: 'Leg Press', sets: 3, reps: '8' },
          { id: 's1e4', name: 'Leg Curl', sets: 3, reps: '10' },
        ],
      },
      {
        day: 'Day 2', name: 'Bench Day', type: 'training',
        exercises: [
          { id: 's2e1', name: 'Barbell Bench Press', sets: 5, reps: '3-5' },
          { id: 's2e2', name: 'Overhead Press', sets: 3, reps: '5' },
          { id: 's2e3', name: 'Weighted Dips', sets: 3, reps: '6-8' },
          { id: 's2e4', name: 'Tricep Pushdowns', sets: 3, reps: '10' },
        ],
      },
      { day: 'Day 3', name: 'Rest Day', type: 'rest', exercises: [] },
      {
        day: 'Day 4', name: 'Deadlift Day', type: 'training',
        exercises: [
          { id: 's4e1', name: 'Conventional Deadlift', sets: 5, reps: '3-5' },
          { id: 's4e2', name: 'Barbell Row', sets: 3, reps: '5' },
          { id: 's4e3', name: 'Pull-Ups', sets: 3, reps: '6-8' },
          { id: 's4e4', name: 'Face Pulls', sets: 3, reps: '15' },
        ],
      },
      {
        day: 'Day 5', name: 'Press Day', type: 'training',
        exercises: [
          { id: 's5e1', name: 'Overhead Press', sets: 5, reps: '3-5' },
          { id: 's5e2', name: 'Incline Bench Press', sets: 3, reps: '6-8' },
          { id: 's5e3', name: 'Dumbbell Lateral Raises', sets: 4, reps: '12' },
          { id: 's5e4', name: 'Skull Crushers', sets: 3, reps: '10' },
        ],
      },
      { day: 'Day 6', name: 'Rest Day', type: 'rest', exercises: [] },
      { day: 'Day 7', name: 'Rest Day', type: 'rest', exercises: [] },
    ],
  },
  {
    id: 'hypertrophy',
    name: 'Hypertrophy Program',
    description: 'High volume, moderate weight, maximum muscle growth',
    level: 'Intermediate',
    days: [
      {
        day: 'Day 1', name: 'Chest & Triceps', type: 'training',
        exercises: [
          { id: 'h1e1', name: 'Barbell Bench Press', sets: 4, reps: '8-12' },
          { id: 'h1e2', name: 'Incline Dumbbell Press', sets: 4, reps: '10-12' },
          { id: 'h1e3', name: 'Cable Fly', sets: 3, reps: '12-15' },
          { id: 'h1e4', name: 'Tricep Pushdowns', sets: 4, reps: '12-15' },
          { id: 'h1e5', name: 'Overhead Tricep Extension', sets: 3, reps: '12-15' },
        ],
      },
      {
        day: 'Day 2', name: 'Back & Biceps', type: 'training',
        exercises: [
          { id: 'h2e1', name: 'Pull-Ups', sets: 4, reps: '8-12' },
          { id: 'h2e2', name: 'Barbell Row', sets: 4, reps: '8-12' },
          { id: 'h2e3', name: 'Seated Cable Row', sets: 3, reps: '12-15' },
          { id: 'h2e4', name: 'Dumbbell Curl', sets: 4, reps: '12-15' },
          { id: 'h2e5', name: 'Hammer Curl', sets: 3, reps: '12-15' },
        ],
      },
      {
        day: 'Day 3', name: 'Legs', type: 'training',
        exercises: [
          { id: 'h3e1', name: 'Barbell Back Squat', sets: 4, reps: '8-12' },
          { id: 'h3e2', name: 'Leg Press', sets: 4, reps: '12-15' },
          { id: 'h3e3', name: 'Romanian Deadlift', sets: 3, reps: '10-12' },
          { id: 'h3e4', name: 'Leg Curl', sets: 4, reps: '12-15' },
          { id: 'h3e5', name: 'Calf Raise', sets: 4, reps: '15-20' },
        ],
      },
      { day: 'Day 4', name: 'Rest Day', type: 'rest', exercises: [] },
      {
        day: 'Day 5', name: 'Shoulders & Arms', type: 'training',
        exercises: [
          { id: 'h5e1', name: 'Overhead Press', sets: 4, reps: '8-12' },
          { id: 'h5e2', name: 'Dumbbell Lateral Raises', sets: 4, reps: '12-15' },
          { id: 'h5e3', name: 'Face Pulls', sets: 3, reps: '15' },
          { id: 'h5e4', name: 'Barbell Curl', sets: 3, reps: '12-15' },
          { id: 'h5e5', name: 'Skull Crushers', sets: 3, reps: '12-15' },
        ],
      },
      {
        day: 'Day 6', name: 'Full Body', type: 'training',
        exercises: [
          { id: 'h6e1', name: 'Conventional Deadlift', sets: 3, reps: '8-10' },
          { id: 'h6e2', name: 'Incline Bench Press', sets: 3, reps: '10-12' },
          { id: 'h6e3', name: 'Bulgarian Split Squat', sets: 3, reps: '10-12 each' },
          { id: 'h6e4', name: 'Lat Pulldown', sets: 3, reps: '12-15' },
          { id: 'h6e5', name: 'Hip Thrust', sets: 3, reps: '12-15' },
        ],
      },
      { day: 'Day 7', name: 'Rest Day', type: 'rest', exercises: [] },
    ],
  },
  {
    id: 'beginner',
    name: 'Beginner Full Body',
    description: '3-day full body — perfect for getting started',
    level: 'Beginner',
    days: [
      {
        day: 'Day 1', name: 'Full Body A', type: 'training',
        exercises: [
          { id: 'b1e1', name: 'Barbell Back Squat', sets: 3, reps: '5' },
          { id: 'b1e2', name: 'Barbell Bench Press', sets: 3, reps: '5' },
          { id: 'b1e3', name: 'Barbell Row', sets: 3, reps: '5' },
          { id: 'b1e4', name: 'Plank', sets: 3, reps: '30 sec' },
        ],
      },
      { day: 'Day 2', name: 'Rest Day', type: 'rest', exercises: [] },
      {
        day: 'Day 3', name: 'Full Body B', type: 'training',
        exercises: [
          { id: 'b3e1', name: 'Barbell Back Squat', sets: 3, reps: '5' },
          { id: 'b3e2', name: 'Overhead Press', sets: 3, reps: '5' },
          { id: 'b3e3', name: 'Conventional Deadlift', sets: 1, reps: '5' },
          { id: 'b3e4', name: 'Pull-Ups / Lat Pulldown', sets: 3, reps: '5-8' },
        ],
      },
      { day: 'Day 4', name: 'Rest Day', type: 'rest', exercises: [] },
      {
        day: 'Day 5', name: 'Full Body A', type: 'training',
        exercises: [
          { id: 'b5e1', name: 'Barbell Back Squat', sets: 3, reps: '5' },
          { id: 'b5e2', name: 'Barbell Bench Press', sets: 3, reps: '5' },
          { id: 'b5e3', name: 'Barbell Row', sets: 3, reps: '5' },
          { id: 'b5e4', name: 'Plank', sets: 3, reps: '30 sec' },
        ],
      },
      { day: 'Day 6', name: 'Rest Day', type: 'rest', exercises: [] },
      { day: 'Day 7', name: 'Rest Day', type: 'rest', exercises: [] },
    ],
  },
  {
    id: 'ppl',
    name: 'Push / Pull / Legs',
    description: '6-day PPL — high frequency for advanced lifters',
    level: 'Advanced',
    days: [
      {
        day: 'Day 1', name: 'Push', type: 'training',
        exercises: [
          { id: 'p1e1', name: 'Barbell Bench Press', sets: 4, reps: '6-8' },
          { id: 'p1e2', name: 'Overhead Press', sets: 3, reps: '8-10' },
          { id: 'p1e3', name: 'Incline Dumbbell Press', sets: 3, reps: '10-12' },
          { id: 'p1e4', name: 'Cable Lateral Raises', sets: 4, reps: '12-15' },
          { id: 'p1e5', name: 'Tricep Pushdowns', sets: 3, reps: '12-15' },
          { id: 'p1e6', name: 'Overhead Tricep Extension', sets: 3, reps: '12-15' },
        ],
      },
      {
        day: 'Day 2', name: 'Pull', type: 'training',
        exercises: [
          { id: 'p2e1', name: 'Conventional Deadlift', sets: 4, reps: '4-6' },
          { id: 'p2e2', name: 'Pull-Ups', sets: 3, reps: '6-10' },
          { id: 'p2e3', name: 'Barbell Row', sets: 3, reps: '8-10' },
          { id: 'p2e4', name: 'Seated Cable Row', sets: 3, reps: '10-12' },
          { id: 'p2e5', name: 'Face Pulls', sets: 4, reps: '15' },
          { id: 'p2e6', name: 'Dumbbell Curl', sets: 3, reps: '12-15' },
        ],
      },
      {
        day: 'Day 3', name: 'Legs', type: 'training',
        exercises: [
          { id: 'p3e1', name: 'Barbell Back Squat', sets: 4, reps: '6-8' },
          { id: 'p3e2', name: 'Romanian Deadlift', sets: 3, reps: '8-10' },
          { id: 'p3e3', name: 'Leg Press', sets: 3, reps: '10-12' },
          { id: 'p3e4', name: 'Leg Curl', sets: 3, reps: '12-15' },
          { id: 'p3e5', name: 'Calf Raise', sets: 4, reps: '15-20' },
        ],
      },
      {
        day: 'Day 4', name: 'Push', type: 'training',
        exercises: [
          { id: 'p4e1', name: 'Overhead Press', sets: 4, reps: '6-8' },
          { id: 'p4e2', name: 'Incline Barbell Press', sets: 3, reps: '8-10' },
          { id: 'p4e3', name: 'Cable Fly', sets: 3, reps: '12-15' },
          { id: 'p4e4', name: 'Dumbbell Lateral Raises', sets: 4, reps: '12-15' },
          { id: 'p4e5', name: 'Skull Crushers', sets: 3, reps: '10-12' },
        ],
      },
      {
        day: 'Day 5', name: 'Pull', type: 'training',
        exercises: [
          { id: 'p5e1', name: 'Lat Pulldown', sets: 4, reps: '8-10' },
          { id: 'p5e2', name: 'Chest Supported Row', sets: 3, reps: '10-12' },
          { id: 'p5e3', name: 'Single Arm Dumbbell Row', sets: 3, reps: '10-12 each' },
          { id: 'p5e4', name: 'Rear Delt Fly', sets: 3, reps: '15' },
          { id: 'p5e5', name: 'Hammer Curl', sets: 3, reps: '12-15' },
          { id: 'p5e6', name: 'Barbell Curl', sets: 3, reps: '12-15' },
        ],
      },
      {
        day: 'Day 6', name: 'Legs', type: 'training',
        exercises: [
          { id: 'p6e1', name: 'Bulgarian Split Squat', sets: 4, reps: '8-10 each' },
          { id: 'p6e2', name: 'Hip Thrust', sets: 4, reps: '10-12' },
          { id: 'p6e3', name: 'Leg Extension', sets: 3, reps: '12-15' },
          { id: 'p6e4', name: 'Leg Curl', sets: 3, reps: '12-15' },
          { id: 'p6e5', name: 'Standing Calf Raise', sets: 4, reps: '15-20' },
        ],
      },
      { day: 'Day 7', name: 'Rest Day', type: 'rest', exercises: [] },
    ],
  },
];
