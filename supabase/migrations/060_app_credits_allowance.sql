-- ============================================================
-- App Credits Allowance for Free Tier Users
-- ============================================================
-- Free users earn app credits by running flows.
-- Each credit spent in a flow unlocks the same amount for app use.
-- Subscribed/topped-up users bypass the allowance entirely.

-- 1. Add app_credits_allowance column to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS app_credits_allowance INTEGER NOT NULL DEFAULT 0;

-- 2. Updated reserve_credits RPC — accepts is_app_run flag,
--    handles allowance increment (flow) / decrement (app) atomically.
CREATE OR REPLACE FUNCTION reserve_credits(
  p_user_id UUID,
  p_credits INTEGER,
  p_job_id UUID,
  p_model_identifier TEXT DEFAULT NULL,
  p_provider_cost_usd NUMERIC DEFAULT NULL,
  p_display_cost_usd NUMERIC DEFAULT NULL,
  p_is_app_run BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
  v_sub_credits INTEGER;
  v_topup_credits INTEGER;
  v_tier TEXT;
  v_app_allowance INTEGER;
  v_usage_log_id UUID;
  v_from_sub INTEGER := 0;
  v_from_topup INTEGER := 0;
BEGIN
  -- Validate positive amount
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
  END IF;

  SELECT subscription_credits, topup_credits, COALESCE(tier, 'free'), COALESCE(app_credits_allowance, 0)
  INTO v_sub_credits, v_topup_credits, v_tier, v_app_allowance
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  IF (v_sub_credits + v_topup_credits) < p_credits THEN
    RAISE EXCEPTION 'Insufficient credits: need %, have %', p_credits, (v_sub_credits + v_topup_credits);
  END IF;

  -- App allowance check: free tier users with no topup must have enough allowance
  IF p_is_app_run AND v_tier = 'free' AND v_topup_credits = 0 THEN
    IF v_app_allowance < p_credits THEN
      RAISE EXCEPTION 'Insufficient app credits: need %, have %. Earn app credits by running flows.', p_credits, v_app_allowance;
    END IF;
  END IF;

  -- Deduct from subscription first, then topup
  IF v_sub_credits >= p_credits THEN
    v_from_sub := p_credits;
  ELSE
    v_from_sub := v_sub_credits;
    v_from_topup := p_credits - v_from_sub;
  END IF;

  -- Update credits + daily spent + app allowance
  IF p_is_app_run AND v_tier = 'free' AND v_topup_credits = 0 THEN
    -- App run by free user: decrement allowance
    UPDATE profiles
    SET subscription_credits = subscription_credits - v_from_sub,
        topup_credits = topup_credits - v_from_topup,
        daily_spent_credits = COALESCE(daily_spent_credits, 0) + p_credits,
        app_credits_allowance = app_credits_allowance - p_credits
    WHERE id = p_user_id;
  ELSIF NOT p_is_app_run AND v_tier = 'free' THEN
    -- Flow run by free user: increment allowance
    UPDATE profiles
    SET subscription_credits = subscription_credits - v_from_sub,
        topup_credits = topup_credits - v_from_topup,
        daily_spent_credits = COALESCE(daily_spent_credits, 0) + p_credits,
        app_credits_allowance = app_credits_allowance + p_credits
    WHERE id = p_user_id;
  ELSE
    -- Paid user or non-free: no allowance changes
    UPDATE profiles
    SET subscription_credits = subscription_credits - v_from_sub,
        topup_credits = topup_credits - v_from_topup,
        daily_spent_credits = COALESCE(daily_spent_credits, 0) + p_credits
    WHERE id = p_user_id;
  END IF;

  INSERT INTO usage_logs (user_id, job_id, action, provider, credits_used, cost_usd, status, metadata)
  VALUES (
    p_user_id,
    p_job_id,
    COALESCE(p_model_identifier, 'generate'),
    'reserved',
    p_credits,
    p_provider_cost_usd,
    'reserved',
    jsonb_build_object(
      'model', p_model_identifier,
      'display_cost', p_display_cost_usd,
      'from_sub', v_from_sub,
      'from_topup', v_from_topup,
      'is_app_run', p_is_app_run
    )
  )
  RETURNING id INTO v_usage_log_id;

  RETURN v_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Updated refund_credits RPC — reverses allowance changes on refund
CREATE OR REPLACE FUNCTION refund_credits(p_usage_log_id UUID)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_metadata JSONB;
  v_from_sub INTEGER;
  v_from_topup INTEGER;
  v_is_app_run BOOLEAN;
  v_tier TEXT;
BEGIN
  SELECT user_id, credits_used, metadata
  INTO v_user_id, v_credits, v_metadata
  FROM usage_logs
  WHERE id = p_usage_log_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  -- Restore to original pools using metadata from reserve_credits
  v_from_sub := COALESCE((v_metadata->>'from_sub')::INTEGER, 0);
  v_from_topup := COALESCE((v_metadata->>'from_topup')::INTEGER, 0);
  v_is_app_run := COALESCE((v_metadata->>'is_app_run')::BOOLEAN, FALSE);

  -- Fallback: if metadata doesn't have pool info, refund all to topup
  IF v_from_sub + v_from_topup = 0 THEN
    v_from_topup := v_credits;
  END IF;

  -- Get user tier for allowance reversal
  SELECT COALESCE(tier, 'free') INTO v_tier FROM profiles WHERE id = v_user_id;

  -- Reverse the allowance change if user is free tier
  IF v_tier = 'free' THEN
    IF v_is_app_run THEN
      -- Refunding an app run: restore allowance
      UPDATE profiles
      SET subscription_credits = subscription_credits + v_from_sub,
          topup_credits = topup_credits + v_from_topup,
          daily_spent_credits = GREATEST(0, COALESCE(daily_spent_credits, 0) - v_credits),
          app_credits_allowance = app_credits_allowance + v_credits
      WHERE id = v_user_id;
    ELSE
      -- Refunding a flow run: reduce allowance (un-earn)
      UPDATE profiles
      SET subscription_credits = subscription_credits + v_from_sub,
          topup_credits = topup_credits + v_from_topup,
          daily_spent_credits = GREATEST(0, COALESCE(daily_spent_credits, 0) - v_credits),
          app_credits_allowance = GREATEST(0, app_credits_allowance - v_credits)
      WHERE id = v_user_id;
    END IF;
  ELSE
    UPDATE profiles
    SET subscription_credits = subscription_credits + v_from_sub,
        topup_credits = topup_credits + v_from_topup,
        daily_spent_credits = GREATEST(0, COALESCE(daily_spent_credits, 0) - v_credits)
    WHERE id = v_user_id;
  END IF;

  UPDATE usage_logs SET status = 'refunded' WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-revoke after CREATE OR REPLACE
REVOKE EXECUTE ON FUNCTION reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION refund_credits(UUID) FROM authenticated, anon;
