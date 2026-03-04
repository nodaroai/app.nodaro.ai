-- API tokens for programmatic workflow execution
CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,        -- SHA-256, never store plaintext
  token_prefix TEXT NOT NULL,             -- "ndr_a1b2" for display
  workflow_ids UUID[] NOT NULL DEFAULT '{}',  -- empty = all user workflows
  rate_limit INT NOT NULL DEFAULT 30,     -- requests/min
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_tokens_hash ON api_tokens (token_hash);
CREATE INDEX idx_api_tokens_user ON api_tokens (user_id, created_at DESC);

-- RLS: users manage own tokens, admins can view all
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_tokens_own ON api_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY api_tokens_admin ON api_tokens
  FOR SELECT
  USING (is_admin());
