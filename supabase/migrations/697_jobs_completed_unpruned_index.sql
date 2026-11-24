-- 697 — the second index the ended-jobs sweep reads (lib/job-server-output.ts
-- `sweepEndedJobsStoredObjects`, the cleanup cron, hourly), alone in its own
-- file (379's, 519's, 569's and 662's reasoning: each migration file runs in
-- one transaction, so a plain CREATE INDEX beside another would hold SHARE on
-- jobs across both full reads; alone here the build takes SHARE on jobs once —
-- writes wait for it, reads do not. Apply off-peak).
--
-- The sweep reads
--   WHERE status = 'completed' AND server_output->>'unpruned' = 'true'
-- the completed jobs whose completion's prune did not finish, through this
-- partial index of exactly those rows: `mark_job_pruned` (695) clears the mark
-- once the prune finishes, and the row leaves the index.
--
-- The lock_timeout bounds the wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every jobs write queued behind it.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_jobs_completed_unpruned
  ON public.jobs (id)
  WHERE status = 'completed' AND (server_output ->> 'unpruned') = 'true';
