-- Credit cost audit table for tracking pricing discrepancies
-- Used by the monitoring system to compare expected vs actual KIE.ai costs

CREATE TABLE IF NOT EXISTS credit_cost_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  model_key TEXT NOT NULL,
  model_config JSONB,
  expected_kie_credits NUMERIC,
  actual_kie_credits NUMERIC,
  expected_nodaro_credits INTEGER,
  nodaro_credit_identifier TEXT,
  raw_response_sample JSONB,
  mismatch BOOLEAN NOT NULL DEFAULT false,
  notes TEXT
);

-- Indexes for common queries
CREATE INDEX idx_credit_cost_audit_created_at ON credit_cost_audit (created_at DESC);
CREATE INDEX idx_credit_cost_audit_mismatch ON credit_cost_audit (mismatch) WHERE mismatch = true;
CREATE INDEX idx_credit_cost_audit_model_key ON credit_cost_audit (model_key);

-- RLS: only admins can read/write
ALTER TABLE credit_cost_audit ENABLE ROW LEVEL SECURITY;

-- Service role can insert (backend inserts audit entries)
CREATE POLICY "service_role_all" ON credit_cost_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin users can read via the admin endpoint (using is_admin() function)
CREATE POLICY "admin_read" ON credit_cost_audit
  FOR SELECT TO authenticated USING (is_admin());
