-- ============================================================
-- App Monetization: schema, earnings table, and RPC
-- ============================================================

-- 1. Add monetization columns to published_apps
ALTER TABLE published_apps
  ADD COLUMN IF NOT EXISTS monetization_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monetization_flat_fee INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monetization_percent INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_estimated_credits INT NOT NULL DEFAULT 0;

-- Backfill base_estimated_credits from existing estimated_credits
UPDATE published_apps
SET base_estimated_credits = estimated_credits
WHERE estimated_credits > 0;

-- 2. Add monetization columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_monetization_flat_fee INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_monetization_percent INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earnings INT NOT NULL DEFAULT 0;

-- 3. Create app_earnings table
CREATE TABLE app_earnings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      UUID NOT NULL REFERENCES published_apps(id) ON DELETE CASCADE,
  run_id      UUID NOT NULL REFERENCES app_runs(id) ON DELETE CASCADE,
  runner_id   UUID NOT NULL REFERENCES auth.users(id),
  creator_id  UUID NOT NULL REFERENCES auth.users(id),
  base_cost   INT NOT NULL,
  flat_fee    INT NOT NULL,
  percent_fee INT NOT NULL,
  total_earned INT NOT NULL,
  total_charged INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_earnings_creator ON app_earnings (creator_id, created_at DESC);
CREATE INDEX idx_app_earnings_app ON app_earnings (app_id, created_at DESC);

ALTER TABLE app_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creator can read own earnings"
  ON app_earnings FOR SELECT
  USING (creator_id = auth.uid());

-- 4. Create process_app_monetization RPC
CREATE OR REPLACE FUNCTION process_app_monetization(
  p_runner_id    UUID,
  p_creator_id   UUID,
  p_markup_amount INT,
  p_app_id       UUID,
  p_run_id       UUID,
  p_base_cost    INT,
  p_flat_fee     INT,
  p_percent_fee  INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runner_sub     INT;
  v_runner_topup   INT;
  v_from_sub       INT := 0;
  v_from_topup     INT := 0;
  v_runner_balance INT;
  v_creator_balance INT;
BEGIN
  -- Return 0 if nothing to charge
  IF p_markup_amount <= 0 THEN
    RETURN 0;
  END IF;

  -- Lock both profile rows ordered by UUID to prevent deadlocks
  IF p_runner_id < p_creator_id THEN
    PERFORM 1 FROM profiles WHERE id = p_runner_id FOR UPDATE;
    PERFORM 1 FROM profiles WHERE id = p_creator_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM profiles WHERE id = p_creator_id FOR UPDATE;
    PERFORM 1 FROM profiles WHERE id = p_runner_id FOR UPDATE;
  END IF;

  -- Read runner balances
  SELECT subscription_credits, topup_credits
  INTO v_runner_sub, v_runner_topup
  FROM profiles WHERE id = p_runner_id;

  -- Deduct from runner: subscription first, then topup (balance can go negative)
  IF v_runner_sub >= p_markup_amount THEN
    v_from_sub := p_markup_amount;
  ELSE
    v_from_sub := GREATEST(v_runner_sub, 0);
    v_from_topup := p_markup_amount - v_from_sub;
  END IF;

  UPDATE profiles
  SET subscription_credits = subscription_credits - v_from_sub,
      topup_credits = topup_credits - v_from_topup
  WHERE id = p_runner_id;

  -- Credit creator: topup_credits + total_earnings
  UPDATE profiles
  SET topup_credits = topup_credits + p_markup_amount,
      total_earnings = total_earnings + p_markup_amount
  WHERE id = p_creator_id;

  -- Insert app_earnings row
  INSERT INTO app_earnings (app_id, run_id, runner_id, creator_id, base_cost, flat_fee, percent_fee, total_earned, total_charged)
  VALUES (p_app_id, p_run_id, p_runner_id, p_creator_id, p_base_cost, p_flat_fee, p_percent_fee, p_markup_amount, p_base_cost + p_markup_amount);

  -- Get balances for transaction records
  SELECT (subscription_credits + topup_credits)
  INTO v_runner_balance
  FROM profiles WHERE id = p_runner_id;

  SELECT (subscription_credits + topup_credits)
  INTO v_creator_balance
  FROM profiles WHERE id = p_creator_id;

  -- Insert credit_transaction for runner (debit)
  INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, balance_after)
  VALUES (
    p_runner_id,
    -p_markup_amount,
    CASE WHEN v_from_sub > 0 AND v_from_topup > 0 THEN 'mixed'
         WHEN v_from_topup > 0 THEN 'topup'
         ELSE 'subscription' END,
    'app_markup',
    'App creator markup',
    v_runner_balance
  );

  -- Insert credit_transaction for creator (credit)
  INSERT INTO credit_transactions (user_id, amount, credit_type, source, description, balance_after)
  VALUES (
    p_creator_id,
    p_markup_amount,
    'topup',
    'app_earnings',
    'Earnings from app run',
    v_creator_balance
  );

  RETURN p_markup_amount;
END;
$$;

-- Restrict direct invocation from client roles
REVOKE EXECUTE ON FUNCTION process_app_monetization(UUID, UUID, INT, UUID, UUID, INT, INT, INT) FROM authenticated, anon;

-- ============================================================
-- 5. Extend CHECK constraints for monetization values
--    The RPC above uses 'mixed' as credit_type and
--    'app_markup'/'app_earnings' as source values.
-- ============================================================

-- Add 'mixed' to credit_type CHECK (existing: subscription, topup)
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_credit_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_credit_type_check
  CHECK (credit_type IN ('subscription', 'topup', 'mixed'));

-- Add 'app_markup' and 'app_earnings' to source CHECK
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_source_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_source_check
  CHECK (source IN (
    'subscription_created', 'subscription_renewal', 'one_time_purchase', 'admin_adjustment',
    'usage', 'refund', 'paddle_refund', 'expiry',
    'app_markup', 'app_earnings',
    -- Legacy values that may exist in older rows
    'purchase', 'subscription', 'admin', 'renewal', 'topup', 'adjustment'
  ));
