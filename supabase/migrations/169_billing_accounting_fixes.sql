-- 169: Billing accounting fixes (reserve_credits + refund_credits).
--
-- (a) App-allowance refund asymmetry
--     reserve_credits only DECREMENTS app_credits_allowance for a free-tier app
--     run when topup_credits = 0, but refund_credits CREDITED it back for ANY
--     free-tier app run regardless of topup balance — re-deriving the branch
--     from tier/is_app_run instead of reversing what was actually applied. So a
--     free user holding topup credits MINTED app-allowance on every failed app
--     run that never debited it. Fix: record the exact allowance delta in
--     usage_logs.metadata at reserve time and have refund reverse EXACTLY that.
--
-- (b) Free-tier daily cap TOCTOU
--     The daily credit cap was checked only in the read-only creditGuard
--     preHandler; reserve_credits' FOR UPDATE lock enforced only the total-
--     balance invariant. Two concurrent requests both passed the read-check and
--     spent past the soft daily cap. Fix: enforce the cap inside reserve_credits
--     under the same FOR UPDATE lock when a limit is supplied (p_daily_limit;
--     NULL = no cap, e.g. paid tiers without a daily limit). The effective
--     daily-spent reset rule mirrors reset_daily_spent_if_needed (migration 025).
--     The preHandler stays as the friendly first-line check; this closes the gap.
--
-- Signature change: reserve_credits gains p_daily_limit (8th param, DEFAULT
-- NULL). The old 7-arg function is dropped so PostgREST resolves unambiguously;
-- callers that omit p_daily_limit get NULL (no cap) — unchanged behavior.

-- Drop the prior 7-arg signature so the new 8-arg one (below) is the only
-- reserve_credits — PostgREST then resolves named-arg calls unambiguously.
-- CREATE OR REPLACE (not bare CREATE) keeps re-runs idempotent: a second
-- application replaces the 8-arg function rather than erroring.
DROP FUNCTION IF EXISTS reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION reserve_credits(
  p_user_id UUID,
  p_credits INTEGER,
  p_job_id UUID,
  p_model_identifier TEXT DEFAULT NULL,
  p_provider_cost_usd NUMERIC DEFAULT NULL,
  p_display_cost_usd NUMERIC DEFAULT NULL,
  p_is_app_run BOOLEAN DEFAULT FALSE,
  p_daily_limit INTEGER DEFAULT NULL
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
  v_allowance_delta INTEGER := 0;
  v_daily_spent INTEGER;
  v_last_reset DATE;
  v_effective_daily INTEGER;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
  END IF;

  SELECT subscription_credits, topup_credits, COALESCE(tier, 'free'),
         COALESCE(app_credits_allowance, 0),
         COALESCE(daily_spent_credits, 0),
         COALESCE(last_daily_reset::DATE, '1970-01-01'::DATE)
  INTO v_sub_credits, v_topup_credits, v_tier, v_app_allowance,
       v_daily_spent, v_last_reset
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  -- Effective daily spent — same UTC-day reset rule as reset_daily_spent_if_needed.
  IF v_last_reset < CURRENT_DATE THEN
    v_effective_daily := 0;
  ELSE
    v_effective_daily := v_daily_spent;
  END IF;

  -- (b) Atomic daily cap under FOR UPDATE (only when a limit is supplied).
  IF p_daily_limit IS NOT NULL AND (v_effective_daily + p_credits) > p_daily_limit THEN
    RAISE EXCEPTION 'Daily credit limit reached: limit %, spent today %, need %',
      p_daily_limit, v_effective_daily, p_credits
      USING ERRCODE = 'check_violation';
  END IF;

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

  -- (a) Exact app-allowance delta applied here — recorded in metadata so
  -- refund_credits can reverse EXACTLY this (never minting/burning allowance
  -- that reserve didn't touch).
  IF p_is_app_run AND v_tier = 'free' AND v_topup_credits = 0 THEN
    v_allowance_delta := -p_credits;   -- app run consumes allowance
  ELSIF NOT p_is_app_run AND v_tier = 'free' THEN
    v_allowance_delta := p_credits;    -- flow run earns allowance
  ELSE
    v_allowance_delta := 0;            -- paid tier, or free+app-run+has-topup
  END IF;

  UPDATE profiles
  SET subscription_credits = subscription_credits - v_from_sub,
      topup_credits = topup_credits - v_from_topup,
      daily_spent_credits = v_effective_daily + p_credits,
      last_daily_reset = CURRENT_DATE,
      app_credits_allowance = COALESCE(app_credits_allowance, 0) + v_allowance_delta
  WHERE id = p_user_id;

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
      'is_app_run', p_is_app_run,
      'allowance_delta', v_allowance_delta
    )
  )
  RETURNING id INTO v_usage_log_id;

  RETURN v_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION refund_credits(p_usage_log_id UUID)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_metadata JSONB;
  v_from_sub INTEGER;
  v_from_topup INTEGER;
  v_allowance_delta INTEGER;
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

  -- Fallback: if metadata doesn't have pool info, refund all to topup
  IF v_from_sub + v_from_topup = 0 THEN
    v_from_topup := v_credits;
  END IF;

  -- (a) Reverse EXACTLY the app-allowance delta reserve_credits applied
  -- (recorded in metadata). Legacy rows without the field → 0 (no change),
  -- which is correct: the old asymmetric re-derivation is what minted allowance.
  v_allowance_delta := COALESCE((v_metadata->>'allowance_delta')::INTEGER, 0);

  UPDATE profiles
  SET subscription_credits = subscription_credits + v_from_sub,
      topup_credits = topup_credits + v_from_topup,
      daily_spent_credits = GREATEST(0, COALESCE(daily_spent_credits, 0) - v_credits),
      app_credits_allowance = GREATEST(0, COALESCE(app_credits_allowance, 0) - v_allowance_delta)
  WHERE id = v_user_id;

  UPDATE usage_logs SET status = 'refunded' WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, BOOLEAN, INTEGER) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION refund_credits(UUID) FROM authenticated, anon;
