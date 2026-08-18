-- 328_app_reports_execution_id.sql
--
-- The failed-execution sweep (app-report-sweep.ts) reports workflow executions
-- that failed WITHOUT any failed job — orchestrator-level errors (payload
-- builder throws, credit reservation walls, timeouts) that never reach a
-- provider and previously surfaced nowhere. Those reports are keyed by
-- execution, not job, so they need the same race-proof idempotency the
-- (kind, job_id) unique index gives job-derived reporters: a re-scan can't
-- duplicate, concurrent sweeps collapse to one row (23505 → benign no-op in
-- insertAppReport).

ALTER TABLE app_reports
  ADD COLUMN IF NOT EXISTS execution_id UUID REFERENCES workflow_executions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_reports_kind_execution
  ON app_reports (kind, execution_id) WHERE execution_id IS NOT NULL;
