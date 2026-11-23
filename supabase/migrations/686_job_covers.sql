-- A cover picture of the owner's own on a job — a song, a speech take, a sound
-- effect, a video, an image, a dubbing, a Remake run — set and cleared by the
-- job's owner through PATCH /v1/jobs/:id { cover } (routes/job-title.ts,
-- lib/job-update.ts, lib/job-cover/) and read back wherever a job is returned
-- as `coverUrl`: the owner's cover when set, else the provider's art (a Suno
-- song's), else null. NULL until set; NULL again brings the provider's art
-- back.
--
-- The value is always the address of the job's OWN copy of the picture, under
-- the user's `job-covers/<userId>/` folder on this platform's storage (the
-- server copies a picture the caller names, after checking it is theirs and a
-- real image of an accepted type and size). The CHECK holds the shape at the
-- table — a web address of bounded length (http on a self-hosted install's local storage) — NOT VALID, so no existing row
-- is scanned (every one is NULL) while every write is checked (451's pattern).
--
-- Server-owned. Private by default: migration 347 replaced the table-level
-- SELECT with an explicit column grant, so this column is invisible to the
-- browser until deliberately granted — the API serves it; no client UPDATE
-- policy exists on jobs (dropped in 025). Every statement is metadata-only and
-- bounded by the lock_timeout (532's reasoning). Safe to re-run.
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cover_url text;
COMMENT ON COLUMN public.jobs.cover_url IS
  'The owner''s cover picture for the job (PATCH /v1/jobs/:id): the address of the job''s own copy on this platform''s storage; NULL until set.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_cover_url_shape') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_cover_url_shape
      CHECK (cover_url IS NULL OR (cover_url ~ '^https?://' AND char_length(cover_url) <= 2048)) NOT VALID;
  END IF;
END $$;
