-- Migration 017: Billing schema (captures paddle-schema.sql + paddle-phase5-migration.sql)
-- These were previously applied manually via SQL Editor.
-- All statements are idempotent for safe re-execution.

-- ============================================================
-- 1. PROFILES — billing columns
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_credits INTEGER DEFAULT 50;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS topup_credits INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 month');
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS daily_spent_credits INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_daily_reset TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits_reset_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT DEFAULT 524288000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_ended_at TIMESTAMPTZ;

-- ============================================================
-- 2. TABLES — Paddle billing
-- ============================================================

-- Paddle customer mapping
CREATE TABLE IF NOT EXISTS paddle_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paddle_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Transactions (payment history synced from Paddle)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  paddle_transaction_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('subscription', 'topup')),
  amount_usd DECIMAL(10,2) NOT NULL,
  credits_granted INTEGER NOT NULL DEFAULT 0,
  tier TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Credit transactions (audit log)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  amount INTEGER NOT NULL,
  credit_type TEXT NOT NULL,
  source TEXT NOT NULL,
  description TEXT,
  job_id UUID REFERENCES jobs(id),
  paddle_transaction_id TEXT,
  admin_user_id UUID REFERENCES profiles(id),
  balance_after INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Model pricing (credit costs per AI model)
CREATE TABLE IF NOT EXISTS model_pricing (
  model_identifier TEXT PRIMARY KEY,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN DEFAULT TRUE,
  tier_restriction TEXT,
  category TEXT,
  display_name TEXT,
  our_cost DECIMAL(10,6),
  markup DECIMAL(5,2),
  provider TEXT
);

-- ============================================================
-- 3. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle ON subscriptions(paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_paddle_customers_user ON paddle_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_paddle_customers_paddle ON paddle_customers(paddle_customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON credit_transactions(created_at);

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE paddle_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_pricing ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'paddle_customers' AND policyname = 'Users read own paddle customer') THEN
    CREATE POLICY "Users read own paddle customer" ON paddle_customers
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users read own transactions') THEN
    CREATE POLICY "Users read own transactions" ON transactions
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'credit_transactions' AND policyname = 'Users read own credit transactions') THEN
    CREATE POLICY "Users read own credit transactions" ON credit_transactions
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'model_pricing' AND policyname = 'Anyone can read model pricing') THEN
    CREATE POLICY "Anyone can read model pricing" ON model_pricing
      FOR SELECT USING (true);
  END IF;
END $$;

-- ============================================================
-- 5. RPC FUNCTIONS (from paddle-schema.sql)
-- ============================================================

CREATE OR REPLACE FUNCTION add_topup_credits(p_user_id UUID, p_credits INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles SET topup_credits = topup_credits + p_credits WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION add_subscription_credits(p_user_id UUID, p_credits INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles SET subscription_credits = subscription_credits + p_credits WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_sub_credits INTEGER;
  v_topup_credits INTEGER;
  v_sub_deduct INTEGER;
  v_topup_deduct INTEGER;
BEGIN
  SELECT subscription_credits, topup_credits INTO v_sub_credits, v_topup_credits
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF (v_sub_credits + v_topup_credits) < p_amount THEN RETURN FALSE; END IF;

  v_sub_deduct := LEAST(v_sub_credits, p_amount);
  v_topup_deduct := p_amount - v_sub_deduct;

  UPDATE profiles
  SET subscription_credits = subscription_credits - v_sub_deduct,
      topup_credits = topup_credits - v_topup_deduct
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_total_credits(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE((SELECT subscription_credits + topup_credits FROM profiles WHERE id = p_user_id), 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_storage_limit_for_tier(p_tier TEXT)
RETURNS BIGINT AS $$
BEGIN
  RETURN CASE p_tier
    WHEN 'free' THEN 524288000
    WHEN 'basic' THEN 5368709120
    WHEN 'standard' THEN 16106127360
    WHEN 'pro' THEN 53687091200
    WHEN 'business' THEN 107374182400
    ELSE 524288000
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 6. RPC FUNCTIONS (from paddle-phase5-migration.sql)
-- ============================================================

CREATE OR REPLACE FUNCTION increment_daily_spent(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET daily_spent_credits = COALESCE(daily_spent_credits, 0) + p_amount
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION commit_credits(p_usage_log_id UUID, p_actual_credits INTEGER DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  UPDATE usage_logs
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{status}',
    '"committed"'
  )
  WHERE id = p_usage_log_id;

  IF p_actual_credits IS NOT NULL THEN
    UPDATE usage_logs
    SET credits_used = p_actual_credits
    WHERE id = p_usage_log_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION refund_credits(p_usage_log_id UUID)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_status TEXT;
BEGIN
  SELECT user_id, credits_used,
         COALESCE(metadata->>'status', 'pending')
  INTO v_user_id, v_credits, v_status
  FROM usage_logs
  WHERE id = p_usage_log_id;

  IF v_status IN ('refunded', 'committed') THEN RETURN; END IF;
  IF v_credits IS NULL OR v_credits <= 0 THEN RETURN; END IF;

  UPDATE profiles
  SET topup_credits = topup_credits + v_credits
  WHERE id = v_user_id;

  UPDATE usage_logs
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{status}',
    '"refunded"'
  )
  WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_storage(p_user_id UUID, p_bytes BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET storage_used_bytes = GREATEST(0, COALESCE(storage_used_bytes, 0) + p_bytes)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reset_daily_spent(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET daily_spent_credits = 0,
      last_daily_reset = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
