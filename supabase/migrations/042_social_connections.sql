-- Social media OAuth connections
CREATE TABLE social_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'facebook')),
  platform_user_id TEXT NOT NULL,
  platform_username TEXT,
  platform_avatar_url TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- RLS
ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own connections"
  ON social_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own connections"
  ON social_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own connections"
  ON social_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own connections"
  ON social_connections FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_social_connections_user_id ON social_connections(user_id);

-- Add social publish credit costs to model_pricing
INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled)
VALUES
  ('social-publish', 1, true)
ON CONFLICT (model_identifier) DO NOTHING;
