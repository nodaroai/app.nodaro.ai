-- Allow 'social_download' as an assets.upload_source value.
--
-- The download-video path (social / YouTube imports) writes
-- `upload_source = 'social_download'` when it creates the ownership asset row for a
-- downloaded video (added in the "create the assets ownership row for downloaded
-- videos" change, PR #99). But that value was never added to the
-- `assets_upload_source_check` CHECK constraint, so EVERY social download's asset
-- insert was rejected in production:
--
--   new row for relation "assets" violates check constraint "assets_upload_source_check"
--
-- The download path swallows the failure ("video kept, unowned"), so the video still
-- imports — but the ownership/asset row never lands, which is why a YouTube import's
-- title is not taken from the video and the asset is untracked.
--
-- Rebuild the CHECK to include 'social_download' alongside the existing allowed set.
-- The set below is the union of every value the backend actually inserts
-- (manual_upload, library, generated, media_process, social_download), the column
-- default ('job'), and the values documented when the column was introduced
-- (migration 006: manual_upload, api, generation, library).
--
-- Safe against existing rows: verified against production that assets.upload_source
-- today holds ONLY 'manual_upload', 'generated', and 'job' (0 rows of anything else,
-- 0 NULLs) — all of which remain allowed — so the re-added constraint validates
-- cleanly with no NOT VALID escape hatch needed.
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_upload_source_check;

ALTER TABLE public.assets
  ADD CONSTRAINT assets_upload_source_check
  CHECK (
    upload_source IN (
      'manual_upload',
      'api',
      'generation',
      'generated',
      'library',
      'media_process',
      'job',
      'social_download'
    )
  );
