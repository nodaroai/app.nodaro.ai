-- Migration 052: Add missing indexes on foreign key columns
-- Addresses Supabase linter: unindexed_foreign_keys (INFO/PERFORMANCE)
-- Foreign keys without covering indexes cause slow DELETE/UPDATE on parent tables
-- because PostgreSQL must scan the child table to check for referencing rows.

CREATE INDEX IF NOT EXISTS idx_app_settings_updated_by ON app_settings (updated_by);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user_id ON credit_purchases (user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_admin_user_id ON credit_transactions (admin_user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_job_id ON credit_transactions (job_id);
CREATE INDEX IF NOT EXISTS idx_locations_workflow_id ON locations (workflow_id);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier ON profiles (tier);
CREATE INDEX IF NOT EXISTS idx_style_presets_user_id ON style_presets (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_job_id ON usage_logs (job_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_job_id ON webhook_deliveries (job_id);
CREATE INDEX IF NOT EXISTS idx_workflow_triggers_user_id ON workflow_triggers (user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_triggers_workflow_id ON workflow_triggers (workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflows_folder_id ON workflows (folder_id);
CREATE INDEX IF NOT EXISTS idx_workflows_published_app_id ON workflows (published_app_id);
