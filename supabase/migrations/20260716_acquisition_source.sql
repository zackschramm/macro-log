-- Capture where each user heard about Fuelog, asked once during onboarding.
-- Feeds the attribution tab of the business tracker (Fuelog folder workbook).
alter table public.profiles
  add column if not exists acquisition_source text
  check (acquisition_source in (
    'app_store', 'tiktok', 'instagram', 'youtube',
    'friend', 'referral', 'reddit', 'other'
  ));
