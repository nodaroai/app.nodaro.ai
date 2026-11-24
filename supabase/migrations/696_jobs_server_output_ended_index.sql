-- 696 — the index the ended-jobs sweep reads (lib/job-server-output.ts
-- `sweepEndedJobsStoredObjects`, the cleanup cron, hourly), alone in its own
-- file (379's, 519's, 569's and 662's reasoning: a plain CREATE INDEX reads the
-- whole heap once; alone here the build takes SHARE on jobs — writes wait for
-- it, reads do not. Beside 695's ADD COLUMN it would hold that column's ACCESS
-- EXCLUSIVE lock, reads included, for the whole build. Apply off-peak).
--
-- The sweep reads
--   WHERE status IN ('cancelled', 'failed') AND server_output->'stored' <> '{}'
-- the cancelled or failed jobs whose record still holds stored objects, through
-- this partial index of exactly those rows: it holds only the few a sweep has
-- left to do, never the table's history (a claim empties `stored`, and the row
-- leaves the index). The sweep's other read, the completed jobs whose prune
-- did not finish, has its own index, alone in its own file (697).
--
-- The lock_timeout bounds the wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every jobs write queued behind it.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_jobs_ended_with_stored_objects
  ON public.jobs (id)
  WHERE status IN ('cancelled', 'failed') AND (server_output -> 'stored') <> '{}'::jsonb;
