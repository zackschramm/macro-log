-- Add periodization_settings JSONB column to profiles.
-- Stores training day and rest day macro targets when the user enables
-- nutrition periodization. null means the feature is disabled.
alter table public.profiles
  add column if not exists periodization_settings jsonb;
