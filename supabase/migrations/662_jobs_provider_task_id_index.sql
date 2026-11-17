-- 662 — the index for looking a job up by its provider task, alone in its own
-- file (379's, 519's and 569's reasoning: a plain CREATE INDEX reads the whole
-- heap once; alone here the build takes SHARE on jobs — writes wait for it,
-- reads do not. Apply off-peak).
--
-- `lib/suno-id-source.ts` reads the jobs that carry a Suno task
--   WHERE provider_task_id = $1
-- on Suno Cover (by its ids), Suno Convert to WAV and Suno Separate, before a
-- run is held; `lib/kie-task-ownership.ts` reads the same way. Partial on the
-- rows that carry a task at all, so it stays far smaller than the table.
--
-- The lock_timeout bounds the wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every jobs write queued behind it.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_jobs_provider_task_id
  ON public.jobs (provider_task_id) WHERE provider_task_id IS NOT NULL;
