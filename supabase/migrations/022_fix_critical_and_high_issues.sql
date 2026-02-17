-- Migration 022: Fix critical and high-severity issues from Supabase audit
-- Fixes: RLS recursion, increment_storage guard, share_workflow_assets SRF,
--        check_credits FOR UPDATE, reserve_credits action/provider, credit summary RPC

-- ============================================================
-- 1. CRITICAL: Fix profiles RLS self-referencing policy
--    The "Admins can view all profiles" policy on profiles queries profiles
--    itself, causing potential infinite recursion. Replace with is_admin().
-- ============================================================

-- Note: "Users can view own profile" (auth.uid() = id) already exists from migration 001.
-- PostgreSQL ORs all SELECT policies, so this admin policy just needs is_admin().
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (is_admin());

-- ============================================================
-- 2. CRITICAL: Restore GREATEST(0,...) guard on increment_storage
--    Migration 019 removed it, allowing storage_used_bytes to go negative
--    when called with negative p_bytes during cleanup.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_storage(p_user_id UUID, p_bytes BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET storage_used_bytes = GREATEST(0, COALESCE(storage_used_bytes, 0) + p_bytes)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. HIGH: Fix share_workflow_assets() SRF misuse
--    jsonb_array_elements() was used in both SELECT and WHERE,
--    creating a cross-product. Use proper LATERAL join syntax.
-- ============================================================

CREATE OR REPLACE FUNCTION share_workflow_assets(p_workflow_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.assets
  SET is_shared = true
  WHERE id IN (
    SELECT DISTINCT (elem->>'assetId')::uuid
    FROM public.workflows,
         jsonb_array_elements(nodes) AS elem
    WHERE workflows.id = p_workflow_id
      AND elem->>'assetId' IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. HIGH: Fix check_credits() unnecessary FOR UPDATE lock
--    This is a read-only check but acquires an exclusive row lock.
--    Remove FOR UPDATE. Also fix subscription_tier -> tier.
-- ============================================================

-- check_credits: Now truly read-only (no side-effect UPDATEs, no FOR UPDATE lock).
-- The backend uses TypeScript checkCreditsWithProfile() instead; this is kept for
-- backward compatibility but should not mutate state.
CREATE OR REPLACE FUNCTION check_credits(p_user_id UUID, p_required_credits INTEGER)
RETURNS JSONB AS $$
DECLARE
  v_sub_credits INTEGER;
  v_topup_credits INTEGER;
  v_daily_spent INTEGER;
  v_daily_limit INTEGER;
  v_tier TEXT;
  v_total_available INTEGER;
BEGIN
  SELECT COALESCE(subscription_credits, 0),
         COALESCE(topup_credits, 0),
         COALESCE(daily_spent_credits, 0),
         COALESCE(tier, subscription_tier, 'free')
  INTO v_sub_credits, v_topup_credits, v_daily_spent, v_tier
  FROM profiles WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'User not found');
  END IF;

  -- Check daily limit from tier_config (if configured)
  SELECT daily_credit_limit INTO v_daily_limit
  FROM tier_config WHERE tier = v_tier;

  IF v_daily_limit IS NOT NULL AND v_daily_spent + p_required_credits > v_daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Daily credit limit exceeded');
  END IF;

  -- Check balance
  v_total_available := v_sub_credits + v_topup_credits;
  IF v_total_available < p_required_credits THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Insufficient credits', 'balance', v_total_available, 'required', p_required_credits);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'balance', v_total_available);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. HIGH: Fix reserve_credits to use correct action/provider fields
--    and SELECT only needed columns instead of SELECT *
-- ============================================================

CREATE OR REPLACE FUNCTION reserve_credits(
  p_user_id UUID,
  p_credits INTEGER,
  p_job_id UUID,
  p_model_identifier TEXT DEFAULT NULL,
  p_provider_cost_usd NUMERIC DEFAULT NULL,
  p_display_cost_usd NUMERIC DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_sub_credits INTEGER;
  v_topup_credits INTEGER;
  v_usage_log_id UUID;
  v_from_sub INTEGER := 0;
  v_from_topup INTEGER := 0;
BEGIN
  SELECT subscription_credits, topup_credits
  INTO v_sub_credits, v_topup_credits
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  -- Verify sufficient credits
  IF (v_sub_credits + v_topup_credits) < p_credits THEN
    RAISE EXCEPTION 'Insufficient credits: need %, have %', p_credits, (v_sub_credits + v_topup_credits);
  END IF;

  -- Deduct subscription first, then topup
  IF v_sub_credits >= p_credits THEN
    v_from_sub := p_credits;
  ELSE
    v_from_sub := v_sub_credits;
    v_from_topup := p_credits - v_from_sub;
  END IF;

  UPDATE profiles
  SET subscription_credits = subscription_credits - v_from_sub,
      topup_credits = topup_credits - v_from_topup,
      daily_spent_credits = COALESCE(daily_spent_credits, 0) + p_credits
  WHERE id = p_user_id;

  -- Log usage with model identifier as action
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
      'from_topup', v_from_topup
    )
  )
  RETURNING id INTO v_usage_log_id;

  RETURN v_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. HIGH: Add get_credit_summary() RPC for admin dashboard
--    Replaces full-table profiles scan with SQL aggregate
-- ============================================================

CREATE OR REPLACE FUNCTION get_credit_summary()
RETURNS JSONB AS $$
DECLARE
  v_tier_breakdown JSONB;
  v_total_users BIGINT;
  v_total_credits BIGINT;
  v_tx_count BIGINT;
BEGIN
  -- Single scan: aggregate by tier, then roll up totals from the grouped result
  SELECT COALESCE(jsonb_object_agg(tier_name, tier_count), '{}'::jsonb),
         COALESCE(SUM(tier_count), 0),
         COALESCE(SUM(tier_credits), 0)
  INTO v_tier_breakdown, v_total_users, v_total_credits
  FROM (
    SELECT COALESCE(subscription_tier, 'free') AS tier_name,
           COUNT(*) AS tier_count,
           SUM(COALESCE(subscription_credits, 0) + COALESCE(topup_credits, 0)) AS tier_credits
    FROM profiles
    GROUP BY COALESCE(subscription_tier, 'free')
  ) t;

  -- Estimated transaction count (pg_class is fast, no full scan)
  SELECT COALESCE(reltuples::bigint, 0) INTO v_tx_count
  FROM pg_class WHERE relname = 'credit_transactions';

  RETURN jsonb_build_object(
    'totalUsers', v_total_users,
    'totalCreditsOutstanding', v_total_credits,
    'tierBreakdown', v_tier_breakdown,
    'totalTransactions', v_tx_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. Fix SELECT * in commit_credits and refund_credits
--    Select only the columns actually needed.
-- ============================================================

CREATE OR REPLACE FUNCTION commit_credits(p_usage_log_id UUID, p_actual_credits INTEGER DEFAULT NULL)
RETURNS VOID AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM usage_logs
  WHERE id = p_usage_log_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  UPDATE usage_logs
  SET status = 'committed',
      credits_charged = COALESCE(p_actual_credits, credits_used)
  WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION refund_credits(p_usage_log_id UUID)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
BEGIN
  SELECT user_id, credits_used
  INTO v_user_id, v_credits
  FROM usage_logs
  WHERE id = p_usage_log_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Usage log not found'; END IF;

  UPDATE profiles SET topup_credits = topup_credits + v_credits WHERE id = v_user_id;
  UPDATE usage_logs SET status = 'refunded' WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
