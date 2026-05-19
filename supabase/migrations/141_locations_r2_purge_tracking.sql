-- 141_locations_r2_purge_tracking.sql
-- Phase 2 #8: track R2-asset purge state for soft-deleted locations.
--
-- Soft-deleted locations (deleted_at IS NOT NULL) keep their DB row + URLs
-- around for the 30-day grace period. After that, the cleanup-cron's
-- `sweepSoftDeletedLocationAssets` sweep hard-deletes the R2 keys so any
-- cached / exported direct CDN URLs return 404 from R2.
--
-- `r2_assets_purged_at` makes the sweep idempotent — once a row has been
-- processed, the next sweep skips it (the WHERE clause filters by
-- `r2_assets_purged_at IS NULL`).
--
-- Restore semantics: if a user restores a location whose R2 keys have
-- already been purged, the row comes back but with broken URLs. The UI
-- shows a placeholder image; the row remains intact in case the user has
-- a backup or wants to re-upload.

-- Defensive: prod CI surfaced `column "deleted_at" does not exist (SQLSTATE 42703)`
-- on 2026-05-19 when this migration tried to create the partial index below,
-- even though migration 124_location-studio-columns.sql adds the column.
-- Re-asserting `deleted_at` here via `IF NOT EXISTS` makes the migration
-- self-sufficient — a no-op when the column already exists, a recovery when
-- it doesn't. Idempotent either way.
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS deleted_at          TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS r2_assets_purged_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS locations_quarantine_sweep_idx
  ON locations (deleted_at)
  WHERE deleted_at IS NOT NULL AND r2_assets_purged_at IS NULL;

COMMENT ON COLUMN locations.r2_assets_purged_at IS
  'Phase 2 #8 — timestamp when the cleanup-cron purged this soft-deleted location''s R2 assets. NULL means the sweep hasn''t run on this row yet (either not soft-deleted or still within the 30-day grace period).';
