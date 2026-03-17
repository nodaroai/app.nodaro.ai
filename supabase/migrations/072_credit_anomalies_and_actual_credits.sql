-- 072: Credit anomalies table + credits_actual on jobs + upgraded commit_credits with refunds

-- 1. Add credits_actual column to jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS credits_actual INTEGER;

-- 2. Create credit_anomalies table
CREATE TABLE IF NOT EXISTS credit_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_log_id UUID,
  model_identifier TEXT NOT NULL,
  provider TEXT,
  credits_estimated INTEGER NOT NULL,
  credits_actual INTEGER NOT NULL,
  diff INTEGER NOT NULL,
  provider_cost_usd NUMERIC(10,6),
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN ('overcharge', 'undercharge', 'unknown_model', 'zero_cost')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'dismissed')),
  admin_notes TEXT,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ
);

-- 3. Enable RLS
ALTER TABLE credit_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view credit anomalies"
  ON credit_anomalies FOR SELECT
  USING (is_admin());

CREATE POLICY "Admins can insert credit anomalies"
  ON credit_anomalies FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update credit anomalies"
  ON credit_anomalies FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete credit anomalies"
  ON credit_anomalies FOR DELETE
  USING (is_admin());

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_credit_anomalies_created_at ON credit_anomalies (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_anomalies_pending ON credit_anomalies (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_credit_anomalies_job_id ON credit_anomalies (job_id);
CREATE INDEX IF NOT EXISTS idx_credit_anomalies_user_id ON credit_anomalies (user_id);

-- 5. Upgrade commit_credits to handle refunds when actual < reserved
CREATE OR REPLACE FUNCTION commit_credits(p_usage_log_id UUID, p_actual_credits INTEGER DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_reserved INTEGER;
  v_actual INTEGER;
  v_diff INTEGER;
BEGIN
  SELECT user_id, credits_used
  INTO v_user_id, v_reserved
  FROM usage_logs
  WHERE id = p_usage_log_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  v_actual := COALESCE(p_actual_credits, v_reserved);

  -- If actual < reserved, refund the difference to topup_credits
  IF v_actual < v_reserved THEN
    v_diff := v_reserved - v_actual;
    UPDATE profiles SET topup_credits = topup_credits + v_diff WHERE id = v_user_id;
  END IF;

  UPDATE usage_logs
  SET status = 'committed',
      credits_charged = v_actual
  WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION commit_credits(UUID, INTEGER) SET search_path = public;
REVOKE ALL ON FUNCTION commit_credits(UUID, INTEGER) FROM authenticated, anon;
