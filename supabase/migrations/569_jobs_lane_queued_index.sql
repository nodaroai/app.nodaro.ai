-- 569 — the queued-jobs index for the concurrency lanes, alone in its own
-- file (379's and 562's reasoning: a plain CREATE INDEX reads the whole heap
-- once, and inside 568 it would do so while the ADD COLUMNs held ACCESS
-- EXCLUSIVE on jobs, blocking every read). Alone here the build takes SHARE
-- on jobs: writes wait for it, reads do not. Apply off-peak.
--
-- Partial on `queued`, so it stays as small as the queue. It serves the
-- queued sweep: one environment's waiting jobs (lane_env), oldest first
-- (lane_queued_at).
--
-- The lock_timeout bounds the wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every jobs write queued behind it.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_jobs_lane_queued
  ON public.jobs (lane_env, lane_queued_at) WHERE status = 'queued';
