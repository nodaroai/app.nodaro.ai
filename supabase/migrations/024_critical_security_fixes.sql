-- Migration 024: Critical security fixes from database audit
-- Fixes: RPC privilege escalation, profiles UPDATE policy, gallery_reports RLS,
--        missing is_shared column, credit function input validation,
--        subscriptions status CHECK constraint, admin RLS policies

-- ============================================================
-- 1. CRITICAL: Revoke EXECUTE on credit/storage RPCs from authenticated/anon
--    Any user can currently call add_topup_credits(their_id, 99999) via PostgREST
--    to mint unlimited credits. These RPCs should only be callable by service_role.
-- ============================================================

REVOKE EXECUTE ON FUNCTION add_topup_credits(UUID, INTEGER) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION add_subscription_credits(UUID, INTEGER) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION deduct_credits(UUID, INTEGER) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION increment_storage(UUID, BIGINT) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION increment_daily_spent(UUID, INTEGER) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION reset_daily_spent(UUID) FROM authenticated, anon;

-- reserve_credits, commit_credits, refund_credits are called by the backend
-- via service_role, so also revoke from authenticated/anon
REVOKE EXECUTE ON FUNCTION reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION commit_credits(UUID, INTEGER) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION refund_credits(UUID) FROM authenticated, anon;

-- Read-only functions can stay accessible (check_credits, get_total_credits, get_credit_summary)
-- but get_credit_summary should be admin-only. Keep check_credits for frontend use.
REVOKE EXECUTE ON FUNCTION get_credit_summary() FROM authenticated, anon;

-- ============================================================
-- 2. CRITICAL: Restrict profiles UPDATE policy to safe columns only
--    Current policy allows users to UPDATE role, tier, credits via PostgREST.
--    Replace with a policy that prevents modifying sensitive columns.
-- ============================================================

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Allow users to update ONLY non-sensitive fields.
-- The WITH CHECK prevents changing role, tier, credits, or storage limits.
-- We use a SECURITY DEFINER function to safely read the current values.
CREATE OR REPLACE FUNCTION profiles_update_check(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_current RECORD;
BEGIN
  -- Read current sensitive values (bypasses RLS via SECURITY DEFINER)
  SELECT role, tier, subscription_tier, subscription_credits, topup_credits,
         daily_spent_credits, storage_limit_bytes, credits_balance
  INTO v_current
  FROM profiles WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Separate policies: SELECT (read own) and UPDATE (safe columns only)
CREATE POLICY "Users can update own safe columns" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent role escalation
    AND role IS NOT DISTINCT FROM (SELECT p.role FROM profiles p WHERE p.id = auth.uid())
    -- Prevent tier manipulation
    AND tier IS NOT DISTINCT FROM (SELECT p.tier FROM profiles p WHERE p.id = auth.uid())
    AND subscription_tier IS NOT DISTINCT FROM (SELECT p.subscription_tier FROM profiles p WHERE p.id = auth.uid())
    -- Prevent credit manipulation
    AND subscription_credits IS NOT DISTINCT FROM (SELECT p.subscription_credits FROM profiles p WHERE p.id = auth.uid())
    AND topup_credits IS NOT DISTINCT FROM (SELECT p.topup_credits FROM profiles p WHERE p.id = auth.uid())
    AND daily_spent_credits IS NOT DISTINCT FROM (SELECT p.daily_spent_credits FROM profiles p WHERE p.id = auth.uid())
    AND credits_balance IS NOT DISTINCT FROM (SELECT p.credits_balance FROM profiles p WHERE p.id = auth.uid())
    -- Prevent storage limit manipulation
    AND storage_limit_bytes IS NOT DISTINCT FROM (SELECT p.storage_limit_bytes FROM profiles p WHERE p.id = auth.uid())
  );

-- Drop the helper function, we don't need it (the policy uses inline subqueries)
DROP FUNCTION IF EXISTS profiles_update_check(UUID);

-- ============================================================
-- 3. CRITICAL: Enable RLS on gallery_reports
--    Currently NO RLS = any authenticated user can read/modify all reports + IPs.
-- ============================================================

ALTER TABLE gallery_reports ENABLE ROW LEVEL SECURITY;

-- Only the backend (service_role) should manage reports.
-- Allow anonymous INSERT for reporting (the POST endpoint is public).
CREATE POLICY "Anyone can insert reports" ON gallery_reports
  FOR INSERT WITH CHECK (true);

-- Only admins can read/update/delete reports
CREATE POLICY "Admins can manage reports" ON gallery_reports
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can update reports" ON gallery_reports
  FOR UPDATE USING (is_admin());

CREATE POLICY "Admins can delete reports" ON gallery_reports
  FOR DELETE USING (is_admin());

-- ============================================================
-- 4. CRITICAL: Add missing is_shared column to assets
--    Referenced in RLS policy (migration 020) and share_workflow_assets()
--    function (migrations 019, 022) but never created.
-- ============================================================

ALTER TABLE assets ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE;

-- ============================================================
-- 5. HIGH: Add positive-amount validation to credit functions
--    reserve_credits, add_topup_credits, add_subscription_credits
--    currently accept negative amounts, which can mint free credits.
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
  -- Validate positive amount
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
  END IF;

  SELECT subscription_credits, topup_credits
  INTO v_sub_credits, v_topup_credits
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

  IF (v_sub_credits + v_topup_credits) < p_credits THEN
    RAISE EXCEPTION 'Insufficient credits: need %, have %', p_credits, (v_sub_credits + v_topup_credits);
  END IF;

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

CREATE OR REPLACE FUNCTION add_topup_credits(p_user_id UUID, p_credits INTEGER)
RETURNS VOID AS $$
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
  END IF;
  UPDATE profiles SET topup_credits = topup_credits + p_credits WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION add_subscription_credits(p_user_id UUID, p_credits INTEGER)
RETURNS VOID AS $$
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'Credits must be positive, got %', p_credits;
  END IF;
  UPDATE profiles SET subscription_credits = subscription_credits + p_credits WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-revoke after CREATE OR REPLACE (which resets privileges)
REVOKE EXECUTE ON FUNCTION reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION add_topup_credits(UUID, INTEGER) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION add_subscription_credits(UUID, INTEGER) FROM authenticated, anon;

-- ============================================================
-- 6. HIGH: Fix subscriptions.status CHECK constraint
--    Current CHECK from migration 001 doesn't allow 'trialing' or 'paused'
--    which Paddle sends. Drop old constraint and add correct one.
-- ============================================================

-- Drop the old CHECK (name may vary; drop by column constraint)
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'canceled', 'incomplete'));

-- ============================================================
-- 7. HIGH: Migrate admin RLS policies to use is_admin() instead of
--    inline EXISTS (SELECT 1 FROM profiles WHERE ...) subqueries.
--    The inline pattern is slower and inconsistent with migration 022 fix.
-- ============================================================

-- projects
DROP POLICY IF EXISTS "Admins can view all projects" ON public.projects;
CREATE POLICY "Admins can view all projects" ON public.projects
  FOR SELECT USING (is_admin());

-- workflows
DROP POLICY IF EXISTS "Admins can view all workflows" ON public.workflows;
CREATE POLICY "Admins can view all workflows" ON public.workflows
  FOR SELECT USING (is_admin());

-- jobs
DROP POLICY IF EXISTS "Admins can view all jobs" ON public.jobs;
CREATE POLICY "Admins can view all jobs" ON public.jobs
  FOR SELECT USING (is_admin());

-- usage_logs
DROP POLICY IF EXISTS "Admins can view all usage logs" ON public.usage_logs;
CREATE POLICY "Admins can view all usage logs" ON public.usage_logs
  FOR SELECT USING (is_admin());

-- assets
DROP POLICY IF EXISTS "Admins can view all assets" ON public.assets;
CREATE POLICY "Admins can view all assets" ON public.assets
  FOR SELECT USING (is_admin());

-- app_settings (currently uses inline EXISTS in migration 005)
DROP POLICY IF EXISTS "Admins can manage settings" ON public.app_settings;
CREATE POLICY "Admins can manage settings" ON public.app_settings
  FOR ALL USING (is_admin());

-- admin_alerts (from migration 018)
DROP POLICY IF EXISTS "Admins can manage alerts" ON public.admin_alerts;
CREATE POLICY "Admins can manage alerts" ON public.admin_alerts
  FOR ALL USING (is_admin());

-- ============================================================
-- 8. HIGH: Add partial unique index to prevent multiple active subscriptions
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_subscription_per_user
  ON subscriptions(user_id) WHERE status = 'active';
