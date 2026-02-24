-- Index cleanup: add missing FK indexes, drop clearly unused/redundant indexes
-- Based on Supabase linter report (2026-02-24)
--
-- Strategy:
--   - ADD indexes for unindexed FKs used by RLS policies or queries
--   - DROP only indexes that are clearly orphaned, redundant, or on tiny tables
--   - KEEP composite indexes designed for known query patterns even if
--     pg_stat_user_indexes shows zero scans (DB may be young)

-- ============================================================
-- PART 1: Add indexes for unindexed foreign keys
-- ============================================================

-- webhook_deliveries.webhook_id — RLS policy joins webhooks via this FK
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id
  ON webhook_deliveries (webhook_id);

-- webhooks.user_id — user-owned resource, filtered by RLS
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id
  ON webhooks (user_id);

-- executions.user_id — user-owned, filtered by RLS
CREATE INDEX IF NOT EXISTS idx_executions_user_id
  ON executions (user_id);

-- executions.workflow_id — FK lookup
CREATE INDEX IF NOT EXISTS idx_executions_workflow_id
  ON executions (workflow_id);

-- api_keys.user_id — FK, will be filtered by RLS
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id
  ON api_keys (user_id);

-- faces.workflow_id — FK lookup
CREATE INDEX IF NOT EXISTS idx_faces_workflow_id
  ON faces (workflow_id);

-- ============================================================
-- PART 2: Drop clearly redundant / orphaned indexes
-- ============================================================

-- Orphaned: column likely doesn't exist or was renamed
DROP INDEX IF EXISTS idx_assets_upload_source;
DROP INDEX IF EXISTS idx_assets_library;
DROP INDEX IF EXISTS idx_assets_shared;
DROP INDEX IF EXISTS idx_characters_asset_category;

-- Low-cardinality single-column indexes (profiles is a small table)
DROP INDEX IF EXISTS idx_profiles_role;
DROP INDEX IF EXISTS idx_profiles_tier;
DROP INDEX IF EXISTS idx_profiles_subscription_ended;

-- app_settings: tiny table, key column already has UNIQUE constraint
DROP INDEX IF EXISTS idx_app_settings_key;

-- style_presets: tiny table, full-scan is fast
DROP INDEX IF EXISTS idx_style_presets_user_id;
DROP INDEX IF EXISTS idx_style_presets_is_system;

-- Entity node_id / workflow_id indexes: no backend queries filter on these
DROP INDEX IF EXISTS idx_characters_node_id;
DROP INDEX IF EXISTS idx_faces_node_id;
DROP INDEX IF EXISTS idx_locations_node_id;
DROP INDEX IF EXISTS idx_locations_workflow_id;
DROP INDEX IF EXISTS idx_objects_node_id;

-- Billing: never queried by these columns
DROP INDEX IF EXISTS idx_credit_transactions_created;
DROP INDEX IF EXISTS idx_credit_tx_source;
DROP INDEX IF EXISTS idx_transactions_type;
DROP INDEX IF EXISTS idx_transactions_user_created;
DROP INDEX IF EXISTS idx_usage_logs_user_created;
DROP INDEX IF EXISTS idx_usage_logs_status;

-- jobs.usage_log / usage_log_id: never used (jobs looked up by id or user_id)
DROP INDEX IF EXISTS idx_jobs_usage_log;
DROP INDEX IF EXISTS idx_jobs_usage_log_id;

-- Admin alerts: tiny table, 3 redundant indexes
DROP INDEX IF EXISTS idx_admin_alerts_type;
DROP INDEX IF EXISTS idx_admin_alerts_unresolved;
DROP INDEX IF EXISTS idx_admin_alerts_resolved;

-- Gallery reports dedup: never hit
DROP INDEX IF EXISTS idx_gallery_reports_dedup;

-- Faces project_id: user_id index already handles RLS; project_id unused in queries
DROP INDEX IF EXISTS idx_faces_project_id;

-- Workflows folder_id: folder feature not yet implemented
DROP INDEX IF EXISTS idx_workflows_folder_id;

-- Credit purchases: tiny table
DROP INDEX IF EXISTS idx_credit_purchases_user_id;
