-- KIE.ai credit balance snapshots (hourly)
-- Tracks provider credit consumption over time for admin visibility.
CREATE TABLE IF NOT EXISTS kie_credit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credits integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Index for time-range queries (admin history chart)
CREATE INDEX idx_kie_credit_snapshots_recorded_at ON kie_credit_snapshots (recorded_at DESC);

-- RLS: service role only (backend inserts, admin reads via service key)
ALTER TABLE kie_credit_snapshots ENABLE ROW LEVEL SECURITY;

-- No user-facing RLS policies — only service role can read/write
