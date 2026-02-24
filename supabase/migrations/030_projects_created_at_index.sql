-- Projects: dashboard listing sorted by creation date
-- RLS filters by user_id, so composite index covers both filter + sort
CREATE INDEX IF NOT EXISTS idx_projects_user_id_created_at
  ON projects (user_id, created_at DESC);

-- Jobs: gallery listing (is_public = true)
-- Partial index only indexes public rows, keeping it small and fast
CREATE INDEX IF NOT EXISTS idx_jobs_public_gallery
  ON jobs (created_at DESC)
  WHERE is_public = true;
