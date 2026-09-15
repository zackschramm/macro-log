-- Build-165 review follow-up: storage access control + avatar persistence.
--
-- 1. `avatars` bucket had NO insert or update policy and `profiles` had no
--    `avatar_url` column, so every profile photo upload failed silently
--    (both errors were discarded) and the photo vanished on next launch.
-- 2. `scan-images` had `allow public uploads`: INSERT for role `public` with
--    only `bucket_id = 'scan-images'` as the check. Anyone holding the
--    published anon key could upload publicly-retrievable objects to a public
--    bucket with no size or MIME limit. No app code references this bucket.

-- ---- avatars -------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;

drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]);

drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar" on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1])
  with check (bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]);

drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (auth.uid())::text = (storage.foldername(name))[1]);

-- ---- scan-images ---------------------------------------------------------
drop policy if exists "allow public uploads" on storage.objects;
create policy "Authenticated users can upload scan images" on storage.objects for insert to authenticated
  with check (bucket_id = 'scan-images');

update storage.buckets
   set file_size_limit   = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic']
 where id = 'scan-images';
