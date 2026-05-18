-- Migration 122 — Link pipelines to their credit reservation usage_log
-- Required so refundPipelineCredits can locate the usage_log_id to reverse.

ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS reservation_usage_log_id uuid REFERENCES usage_logs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pipelines_reservation_usage_log_idx
  ON pipelines (reservation_usage_log_id)
  WHERE reservation_usage_log_id IS NOT NULL;
