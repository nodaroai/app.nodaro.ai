-- A name of the person's own on a job — "Wedding toast, final" on a picture, a
-- clip, a track or a speech take — set and cleared by the job's owner through
-- PATCH /v1/jobs/:id { title } (routes/job-title.ts, lib/job-title.ts) and
-- read back wherever a job is returned (`title` on PUBLIC_JOB_KEYS: the job
-- reads and the list, a session's items, the Trash, the gallery's cards, the
-- library's rows through the file's job). NULL until named.
--
-- Plain text, trimmed, 1–120 characters: the route enforces it, and the CHECK
-- below holds the same rule at the table — NOT VALID, so no existing row is
-- scanned (every one is NULL) while every write is checked (451's pattern).
--
-- Server-owned. Private by default: migration 347 replaced the table-level
-- SELECT with an explicit column grant, so this column is invisible to the
-- browser until deliberately granted — the API serves it, and the editor's
-- Realtime reader selects explicit columns; no client UPDATE policy exists on
-- jobs (dropped in 025). Every statement is metadata-only and bounded by the
-- lock_timeout (532's reasoning). Safe to re-run.
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS title text;
COMMENT ON COLUMN public.jobs.title IS
  'A name the job''s owner gave it (PATCH /v1/jobs/:id); one line of plain text, trimmed, 1-120 characters; NULL until named.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_title_plain_short') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_title_plain_short
      CHECK (title IS NULL OR (char_length(title) BETWEEN 1 AND 120 AND title = btrim(title))) NOT VALID;
  END IF;
END $$;
