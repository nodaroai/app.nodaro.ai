-- How long a job has waited, in total, for one of the worker's ffmpeg slots
-- (podcast Track 0.13, decided 2026-10-04). The video worker's 60 s heartbeat
-- writes it while the row is processing (earlier attempts included); the
-- workflow engine takes it off the node's processing and poll clocks (as it
-- already does for a review hold), so a short job queued behind long renders is
-- no longer cancelled as "hung" for waiting. It is NOT taken off the
-- workflow-level cap.
--
-- Server-owned. Private by default: migration 347 replaced table-level SELECT
-- with an explicit column grant, so a new column is invisible to browsers until
-- granted; no client UPDATE policy exists on jobs (dropped in 025); and the
-- restrictive INSERT policy below keeps a browser-inserted row at 0 (the
-- pattern of 394's submission_context).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS slot_wait_ms bigint NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND conname = 'jobs_slot_wait_ms_non_negative') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_slot_wait_ms_non_negative CHECK (slot_wait_ms >= 0) NOT VALID;
  END IF;
END $$;

DROP POLICY IF EXISTS "Server controls job slot wait" ON public.jobs;
CREATE POLICY "Server controls job slot wait" ON public.jobs
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (slot_wait_ms = 0);
