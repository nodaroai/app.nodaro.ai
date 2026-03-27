-- Add component support to published_apps
ALTER TABLE published_apps
  ADD COLUMN IF NOT EXISTS publish_type TEXT NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS component_metadata JSONB DEFAULT NULL;

-- Index for browse filtering by type
CREATE INDEX IF NOT EXISTS idx_published_apps_publish_type
  ON published_apps(publish_type)
  WHERE is_listed = true AND is_active = true;

-- Add CHECK constraint for valid publish types
ALTER TABLE published_apps
  ADD CONSTRAINT chk_publish_type CHECK (publish_type IN ('app', 'component'));
