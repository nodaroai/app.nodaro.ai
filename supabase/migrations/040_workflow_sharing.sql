-- Add sharing/presentation columns to workflows
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_presentation_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for share_token lookups (only non-null values)
CREATE INDEX IF NOT EXISTS idx_workflows_share_token
  ON workflows (share_token)
  WHERE share_token IS NOT NULL;
