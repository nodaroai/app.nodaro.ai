-- 078_model_execution_stats.sql
-- Tracks average execution duration per model+config for progress bar estimation

CREATE TABLE model_execution_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_identifier TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT '',
  duration_seconds INT NOT NULL DEFAULT 0,
  avg_duration_ms INT NOT NULL,
  min_duration_ms INT,
  max_duration_ms INT,
  sample_count INT NOT NULL DEFAULT 1,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_identifier, aspect_ratio, quality, duration_seconds)
);

CREATE INDEX idx_model_execution_stats_model ON model_execution_stats (model_identifier);

ALTER TABLE model_execution_stats ENABLE ROW LEVEL SECURITY;

-- Public read (frontend fetches estimates via authenticated API)
CREATE POLICY "Anyone can read execution stats"
  ON model_execution_stats FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies — only service-role (backend) can write
