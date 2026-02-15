CREATE TABLE IF NOT EXISTS faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  node_id TEXT NOT NULL,
  workflow_id UUID,
  project_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  style TEXT,
  source_image_url TEXT,
  expressions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_faces_user_id ON faces(user_id);
CREATE INDEX idx_faces_project_id ON faces(project_id);

ALTER TABLE faces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own faces" ON faces FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own faces" ON faces FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own faces" ON faces FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own faces" ON faces FOR DELETE USING (auth.uid() = user_id);
