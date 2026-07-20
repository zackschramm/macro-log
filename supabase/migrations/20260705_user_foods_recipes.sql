-- Add optional nutrition columns to user_foods (brand, fiber, sugar)
ALTER TABLE user_foods
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS fiber numeric,
  ADD COLUMN IF NOT EXISTS sugar numeric;

-- Recipes table
CREATE TABLE IF NOT EXISTS user_recipes (
  id                   bigserial PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  servings             integer NOT NULL DEFAULT 1,
  ingredients          jsonb NOT NULL DEFAULT '[]'::jsonb,
  per_serving_calories numeric NOT NULL DEFAULT 0,
  per_serving_protein  numeric NOT NULL DEFAULT 0,
  per_serving_carbs    numeric NOT NULL DEFAULT 0,
  per_serving_fat      numeric NOT NULL DEFAULT 0,
  photo_uri            text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON user_recipes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON user_recipes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own" ON user_recipes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "delete_own" ON user_recipes FOR DELETE USING (auth.uid() = user_id);
