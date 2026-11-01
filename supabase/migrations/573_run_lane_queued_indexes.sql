-- 573 — the queued-runs indexes for the concurrency lanes: the waiting
-- workflow executions and pipelines the queued sweep reads, alone in their own
-- file like 569 (a plain CREATE INDEX reads the whole heap once and takes SHARE
-- on its table: writes wait for it, reads do not). Apply off-peak.
--
-- Partial on each table's waiting status AND a lane stamp, so each stays as
-- small as its queue: a run waiting for its run slot stays `pending` (an
-- execution) or `queued` (a pipeline), and only a parked one carries
-- lane_queued_at — most pending executions are only on their way to a worker.
-- They serve the queued sweep: one environment's waiting runs (lane_env),
-- oldest first (lane_queued_at), with `lane_queued_at IS NOT NULL` in its
-- query, which the planner matches to the predicate.
--
-- The lock_timeout bounds each wait for SHARE behind a long writer (even a
-- re-run takes the lock before IF NOT EXISTS is checked): a failed, safely
-- retried migration rather than every write queued behind it. Pipelines
-- first; workflow_executions, the busier table, last, so its lock is held for
-- the shortest time.
SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_pipelines_lane_queued
  ON public.pipelines (lane_env, lane_queued_at)
  WHERE status = 'queued' AND lane_queued_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_executions_lane_queued
  ON public.workflow_executions (lane_env, lane_queued_at)
  WHERE status = 'pending' AND lane_queued_at IS NOT NULL;
