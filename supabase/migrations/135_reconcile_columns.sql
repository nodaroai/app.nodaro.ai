-- Migration 135 — External-call reconciliation (jobs-table columns + inflight-index)
--
-- Five new columns track external provider tasks so a cron can find stuck rows
-- and either recover them (async, with provider_task_id) or sweep them (sync,
***REDACTED-OSS-SCRUB***
--
-- Decision references:
--   D1: Single set of columns on `jobs`, not a side table (every job has ≤ 1 external call).
--   D8: `provider_call_started_at` distinct from `started_at` (set once at API call;
--       NOT re-written on BullMQ stall-retry, so threshold math is stable).
--   D9: Sync HTTP routes (ai-writer, video-composer, etc.) set these directly;
--       async workers set via onTaskCreated callback.
--
-- Index `jobs_inflight_idx` covers BOTH 'pending' and 'processing' states so a
-- route-handler crash before the `pending → processing` flip still surfaces the row.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS provider_kind            text,
  ADD COLUMN IF NOT EXISTS provider_task_id         text,
  ADD COLUMN IF NOT EXISTS provider_call_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_attempts       int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconcile_last_error     text;

-- Predicate excludes 'queued' on purpose: BullMQ-queued rows have not yet
-- made the external call, so `provider_call_started_at` is NULL and the
-- reconciliation cron has nothing to time-out against.
CREATE INDEX IF NOT EXISTS jobs_inflight_idx
  ON public.jobs (provider_call_started_at)
  WHERE status IN ('pending', 'processing');
