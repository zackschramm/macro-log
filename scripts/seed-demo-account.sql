-- Seed a review demo account with a realistic week of endurance eating +
-- training, so Coach/History/Stats have content when the App Review tester
-- looks. Run in Supabase SQL editor AFTER creating the demo user in the app
-- (onboarding sets profile/sport/targets).
--
-- USAGE: replace every DEMO_UUID below with the demo user's auth.users id
-- (Authentication -> Users), then run. Idempotent-ish: delete-then-insert.
--
-- Dates are relative to today so the data always looks fresh at review time.
-- Re-run the morning of submission.

begin;

delete from public.macro_logs   where user_id = 'DEMO_UUID' and date >= current_date - 6;
delete from public.workout_logs where user_id = 'DEMO_UUID' and date >= current_date - 6;

-- ~2,400 kcal/day triathlete week: oats+fruit breakfasts, real lunches,
-- varied dinners, ride-day carbs. meal: breakfast/lunch/dinner/snack.
insert into public.macro_logs (user_id, date, meal, food, qty, calories, protein, carbs, fat) values
-- day -6 (rest day)
('DEMO_UUID', current_date - 6, 'breakfast', 'Oatmeal with blueberries', 1, 420, 14, 68, 9),
('DEMO_UUID', current_date - 6, 'breakfast', 'Greek yogurt', 1, 150, 20, 9, 4),
('DEMO_UUID', current_date - 6, 'lunch', 'Turkey and avocado wrap', 1, 620, 38, 55, 24),
('DEMO_UUID', current_date - 6, 'dinner', 'Salmon, rice and broccoli', 1, 700, 42, 62, 26),
('DEMO_UUID', current_date - 6, 'snack', 'Apple with peanut butter', 1, 280, 8, 30, 16),
-- day -5 (tempo run am)
('DEMO_UUID', current_date - 5, 'breakfast', 'Banana and toast with honey', 1, 340, 7, 70, 4),
('DEMO_UUID', current_date - 5, 'breakfast', 'Whey protein shake', 1, 160, 30, 5, 2),
('DEMO_UUID', current_date - 5, 'lunch', 'Chicken burrito bowl', 1, 720, 45, 78, 22),
('DEMO_UUID', current_date - 5, 'dinner', 'Spaghetti with turkey bolognese', 1, 680, 40, 82, 18),
('DEMO_UUID', current_date - 5, 'snack', 'Chocolate milk', 1, 220, 11, 30, 6),
-- day -4
('DEMO_UUID', current_date - 4, 'breakfast', 'Eggs, toast and orange juice', 1, 480, 24, 48, 20),
('DEMO_UUID', current_date - 4, 'lunch', 'Tuna salad sandwich', 1, 540, 35, 48, 20),
('DEMO_UUID', current_date - 4, 'dinner', 'Chicken stir-fry with rice', 1, 710, 44, 75, 21),
('DEMO_UUID', current_date - 4, 'snack', 'Trail mix', 1, 300, 9, 26, 18),
('DEMO_UUID', current_date - 4, 'snack', 'Greek yogurt with granola', 1, 260, 18, 32, 7),
-- day -3 (interval bike pm)
('DEMO_UUID', current_date - 3, 'breakfast', 'Oatmeal with banana and whey', 1, 520, 34, 78, 8),
('DEMO_UUID', current_date - 3, 'lunch', 'Chicken pesto pasta', 1, 690, 42, 70, 24),
('DEMO_UUID', current_date - 3, 'dinner', 'Beef tacos with beans', 1, 720, 40, 68, 28),
('DEMO_UUID', current_date - 3, 'snack', 'Energy chews (pre-ride)', 1, 180, 0, 45, 0),
('DEMO_UUID', current_date - 3, 'snack', 'Recovery shake', 1, 250, 25, 30, 3),
-- day -2
('DEMO_UUID', current_date - 2, 'breakfast', 'Bagel with cream cheese', 1, 420, 12, 62, 14),
('DEMO_UUID', current_date - 2, 'lunch', 'Quinoa power bowl with chicken', 1, 650, 42, 62, 22),
('DEMO_UUID', current_date - 2, 'dinner', 'Grilled shrimp, potatoes, asparagus', 1, 620, 40, 58, 22),
('DEMO_UUID', current_date - 2, 'snack', 'Cottage cheese with pineapple', 1, 240, 24, 24, 5),
('DEMO_UUID', current_date - 2, 'snack', 'Dark chocolate square', 1, 110, 1, 12, 7),
-- day -1 (long ride day: carbs UP — the pattern Coach should notice)
('DEMO_UUID', current_date - 1, 'breakfast', 'Big oatmeal, honey, banana', 1, 640, 16, 118, 10),
('DEMO_UUID', current_date - 1, 'lunch', 'Ride fuel: bars, banana, drink mix', 1, 620, 10, 128, 8),
('DEMO_UUID', current_date - 1, 'lunch', 'Post-ride recovery shake', 1, 280, 28, 34, 3),
('DEMO_UUID', current_date - 1, 'dinner', 'Pizza (recovery dinner)', 1, 840, 36, 92, 34),
('DEMO_UUID', current_date - 1, 'snack', 'Cherry juice and pretzels', 1, 260, 4, 56, 1),
-- today (partial day, looks live)
('DEMO_UUID', current_date, 'breakfast', 'Greek yogurt, granola, berries', 1, 430, 26, 56, 11),
('DEMO_UUID', current_date, 'lunch', 'Leftover pasta with chicken', 1, 610, 38, 66, 18);

-- Training week: exercise-level rows, done=true.
insert into public.workout_logs (user_id, date, day_index, exercise_id, exercise_name, done, sets) values
('DEMO_UUID', current_date - 5, 0, 'demo-tempo-run', 'Tempo Run 45min', true, '[{"reps":"45min","weight":"z3"}]'),
('DEMO_UUID', current_date - 4, 0, 'demo-strength-a', 'Back Squat', true, '[{"reps":"5","weight":"165"},{"reps":"5","weight":"165"},{"reps":"5","weight":"165"}]'),
('DEMO_UUID', current_date - 4, 0, 'demo-strength-b', 'Romanian Deadlift', true, '[{"reps":"8","weight":"135"},{"reps":"8","weight":"135"}]'),
('DEMO_UUID', current_date - 3, 0, 'demo-bike-intervals', 'Bike Intervals 5x5min', true, '[{"reps":"5x5min","weight":"z4"}]'),
('DEMO_UUID', current_date - 1, 0, 'demo-long-ride', 'Long Ride 3h', true, '[{"reps":"180min","weight":"z2"}]')
on conflict (user_id, date, day_index, exercise_id) do update set done = true;

commit;

-- After running: also give this account Pro so the reviewer never hits the
-- paywall mid-review — either a manual row in public.entitlements
-- (see supabase/migrations/20260824_entitlements.sql tail) or a RevenueCat
-- promotional entitlement on the same user id.
