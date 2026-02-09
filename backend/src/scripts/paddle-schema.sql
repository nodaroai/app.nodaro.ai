-- ============================================
-- Paddle Billing Integration -- Database Schema
-- ============================================
-- Run in Supabase SQL Editor

-- Paddle customer mapping
CREATE TABLE IF NOT EXISTS paddle_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paddle_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Subscriptions synced from Paddle webhooks
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  paddle_subscription_id TEXT NOT NULL UNIQUE,
  paddle_price_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'basic', 'standard', 'pro', 'business')),
  status TEXT NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction history
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_paddle ON subscriptions(paddle_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_paddle_customers_user ON paddle_customers(user_id);
CREATE INDEX IF NOT EXISTS idx_paddle_customers_paddle ON paddle_customers(paddle_customer_id);

-- Update profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_credits INTEGER DEFAULT 50;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS topup_credits INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits_reset_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS llm_requests_used INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS llm_requests_reset_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT DEFAULT 524288000;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_ended_at TIMESTAMPTZ;

-- RLS
ALTER TABLE paddle_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own paddle customer" ON paddle_customers
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own subscription" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own transactions" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

-- RPC Functions
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
