-- Add public_outputs preference to profiles (default true = outputs visible in gallery)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS public_outputs boolean DEFAULT true;

-- Add is_public flag to jobs (default true = visible in gallery)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true;

-- Index for efficient gallery queries
CREATE INDEX IF NOT EXISTS idx_jobs_public_gallery
  ON jobs (is_public, status, completed_at DESC)
  WHERE is_public = true AND status = 'completed';

-- RLS: anyone can read public completed jobs for gallery
CREATE POLICY "Public gallery read"
  ON jobs FOR SELECT
  USING (is_public = true AND status = 'completed');
