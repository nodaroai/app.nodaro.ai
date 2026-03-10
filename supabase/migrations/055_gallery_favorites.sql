-- Gallery favorites: allow users to bookmark gallery items
CREATE TABLE IF NOT EXISTS gallery_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, job_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_gallery_favorites_user_id ON gallery_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_gallery_favorites_job_id ON gallery_favorites(job_id);

-- RLS
ALTER TABLE gallery_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own favorites" ON gallery_favorites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own favorites" ON gallery_favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own favorites" ON gallery_favorites
  FOR DELETE USING (auth.uid() = user_id);

-- Force-private flag for jobs using uploaded/private input content
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS force_private BOOLEAN DEFAULT NULL;
