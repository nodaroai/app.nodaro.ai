-- Soft-delete (archive) for app_runs.
-- The Nodaro UI exposes an Archive view where users can restore or permanently
-- delete soft-deleted runs. API/SDK/MCP delete operations soft-delete; only the
-- UI exposes the archive list, restore, and permanent-delete actions.

ALTER TABLE app_runs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Partial index: most queries filter `WHERE deleted_at IS NULL` (active runs).
-- A partial index keeps the active-run lookups fast without bloating from the
-- archive tail.
CREATE INDEX IF NOT EXISTS idx_app_runs_active_by_runner
  ON app_runs(runner_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Companion index for the archive view, which lists everything with
-- deleted_at IS NOT NULL ordered by deletion time.
CREATE INDEX IF NOT EXISTS idx_app_runs_archived_by_runner
  ON app_runs(runner_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
