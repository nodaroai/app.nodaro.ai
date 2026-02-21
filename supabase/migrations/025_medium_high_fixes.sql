-- Migration 025: Medium & High severity fixes from database audit
-- Fixes: profiles RLS recursion, performance indexes, integrity constraints,
--        refund pool fix, check_storage_quota sync, jobs RLS restriction,
--        daily reset atomicity

-- ============================================================
-- 1. MEDIUM: Fix profiles UPDATE WITH CHECK recursion
--    Current policy queries profiles inline, violating the rule:
--    "NEVER create RLS policies on profiles that query profiles"
--    Replace with SECURITY DEFINER function that bypasses RLS.
-- ============================================================

-- Helper function: compares proposed UPDATE values against current values.
-- Returns TRUE only if all sensitive columns are unchanged.
CREATE OR REPLACE FUNCTION check_profiles_update_allowed(
  p_user_id UUID,
  p_role TEXT,
  p_tier TEXT,
  p_subscription_tier TEXT,
  p_subscription_credits INTEGER,
  p_topup_credits INTEGER,
  p_daily_spent_credits INTEGER,
  p_credits_balance INTEGER,
  p_storage_limit_bytes BIGINT
) RETURNS BOOLEAN AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT role, tier, subscription_tier, subscription_credits, topup_credits,
         daily_spent_credits, credits_balance, storage_limit_bytes
  INTO v FROM profiles WHERE id = p_user_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  RETURN (p_role IS NOT DISTINCT FROM v.role)
    AND (p_tier IS NOT DISTINCT FROM v.tier)
    AND (p_subscription_tier IS NOT DISTINCT FROM v.subscription_tier)
    AND (p_subscription_credits IS NOT DISTINCT FROM v.subscription_credits)
    AND (p_topup_credits IS NOT DISTINCT FROM v.topup_credits)
    AND (p_daily_spent_credits IS NOT DISTINCT FROM v.daily_spent_credits)
    AND (p_credits_balance IS NOT DISTINCT FROM v.credits_balance)
    AND (p_storage_limit_bytes IS NOT DISTINCT FROM v.storage_limit_bytes);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the old policy (created in migration 024)
DROP POLICY IF EXISTS "Users can update own safe columns" ON public.profiles;

-- Recreate using the SECURITY DEFINER function (no self-referencing subqueries)
CREATE POLICY "Users can update own safe columns" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND check_profiles_update_allowed(
      id, role, tier, subscription_tier,
      subscription_credits, topup_credits, daily_spent_credits,
      credits_balance, storage_limit_bytes
    )
  );

-- ============================================================
-- 2. PERFORMANCE: Add missing indexes, drop redundant ones
-- ============================================================

-- P-H1: gallery_reports composite index for rate-limiting dedup query
-- Query: WHERE job_id = ? AND reporter_ip = ? AND created_at >= ?
CREATE INDEX IF NOT EXISTS idx_gallery_reports_dedup
  ON gallery_reports(job_id, reporter_ip, created_at DESC);

-- P-M1: transactions composite index for billing history with ORDER BY
-- Query: WHERE user_id = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON transactions(user_id, created_at DESC);

-- P-M3: Gallery partial index including job_type for gallery query
-- Current index only covers (is_public, status, completed_at)
-- Gallery query also filters by job_type via .in()
DROP INDEX IF EXISTS idx_jobs_gallery;
CREATE INDEX idx_jobs_gallery
  ON jobs(completed_at DESC)
  WHERE is_public = true AND status = 'completed';
-- Note: job_type is low-cardinality; bitmap scan on this partial index
-- is already fast. A BRIN or separate index on job_type adds little value
-- given the partial index already filters to ~5% of rows.

-- P-M4: profiles.subscription_ended_at for cleanup cron
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_ended
  ON profiles(subscription_ended_at)
  WHERE subscription_ended_at IS NOT NULL;

-- P-M5: profiles.tier for cleanup queries
CREATE INDEX IF NOT EXISTS idx_profiles_tier
  ON profiles(tier);

-- P-M2: Drop redundant single-column indexes superseded by composites
-- idx_jobs_user_id is redundant with idx_jobs_user_status (user_id, status)
DROP INDEX IF EXISTS idx_jobs_user_id;
-- idx_usage_logs_user_id is redundant with idx_usage_logs_user_created (user_id, created_at)
DROP INDEX IF EXISTS idx_usage_logs_user_id;
-- idx_subscriptions_user_id is redundant with idx_subscriptions_user_id_status (user_id as leftmost prefix)
DROP INDEX IF EXISTS idx_subscriptions_user_id;
-- idx_subscriptions_user is a duplicate of idx_subscriptions_user_id
DROP INDEX IF EXISTS idx_subscriptions_user;

-- ============================================================
-- 3. SECURITY: Restrict jobs RLS to SELECT/INSERT only
--    Current FOR ALL policy lets users UPDATE/DELETE own jobs
--    via PostgREST, allowing tampering with output_data, status,
--    is_public, credits_used. Backend uses service_role for mutations.
-- ============================================================

DROP POLICY IF EXISTS "Users can CRUD own jobs" ON public.jobs;

-- Users can read their own jobs
CREATE POLICY "Users can read own jobs" ON public.jobs
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert jobs (needed for frontend job creation)
CREATE POLICY "Users can insert own jobs" ON public.jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- No UPDATE/DELETE policy for regular users — backend uses service_role

-- ============================================================
-- 4. INTEGRITY: FK ON DELETE for transactions and credit_transactions
--    Currently defaults to NO ACTION, blocking user deletion.
-- ============================================================

-- transactions.user_id: DROP NOT NULL + SET NULL on user delete (preserve payment history)
ALTER TABLE transactions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- credit_transactions.user_id: DROP NOT NULL + SET NULL on user delete
ALTER TABLE credit_transactions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_user_id_fkey;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- credit_transactions.job_id: DROP NOT NULL + SET NULL on job delete
ALTER TABLE credit_transactions ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_job_id_fkey;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;

-- credit_transactions.admin_user_id: DROP NOT NULL + SET NULL on admin user delete
-- (admin_user_id is already nullable per migration 017, but be safe)
ALTER TABLE credit_transactions ALTER COLUMN admin_user_id DROP NOT NULL;
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_admin_user_id_fkey;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_admin_user_id_fkey
  FOREIGN KEY (admin_user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ============================================================
-- 5. INTEGRITY: CHECK constraints on credit_transactions and usage_logs
-- ============================================================

-- credit_transactions.credit_type
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_credit_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_credit_type_check
  CHECK (credit_type IN ('subscription', 'topup'));

-- credit_transactions.source (must match CreditsService.logTransaction TypeScript values)
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_source_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_source_check
  CHECK (source IN (
    'subscription_renewal', 'one_time_purchase', 'admin_adjustment',
    'usage', 'refund', 'paddle_refund', 'expiry',
    -- Legacy values that may exist in older rows
    'purchase', 'subscription', 'admin', 'renewal', 'topup', 'adjustment'
  ));

-- usage_logs.status
ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_status_check;
ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_status_check
  CHECK (status IN ('reserved', 'committed', 'refunded'));

-- ============================================================
-- 6. INTEGRITY: workflow_history unique on (workflow_id, version)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_history_unique_version
  ON workflow_history(workflow_id, version);

-- ============================================================
-- 7. BILLING: Fix refund_credits to restore to correct pool
--    Currently always refunds to topup_credits, shifting credits
--    from expiring subscription pool to permanent topup pool.
--    Fix: use metadata.from_sub / from_topup to restore correctly.
-- ============================================================

CREATE OR REPLACE FUNCTION refund_credits(p_usage_log_id UUID)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_metadata JSONB;
  v_from_sub INTEGER;
  v_from_topup INTEGER;
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

  UPDATE profiles
  SET subscription_credits = subscription_credits + v_from_sub,
      topup_credits = topup_credits + v_from_topup,
      daily_spent_credits = GREATEST(0, COALESCE(daily_spent_credits, 0) - v_credits)
  WHERE id = v_user_id;

  UPDATE usage_logs SET status = 'refunded' WHERE id = p_usage_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-revoke after CREATE OR REPLACE
REVOKE EXECUTE ON FUNCTION refund_credits(UUID) FROM authenticated, anon;

-- ============================================================
-- 8. BILLING: Sync check_storage_quota with TIER_STORAGE_LIMITS
--    Current function is missing 'standard' tier (falls to 1GB default)
--    and 'pro' has wrong value (107TB instead of 50GB).
-- ============================================================

CREATE OR REPLACE FUNCTION check_storage_quota(p_user_id UUID, p_file_size BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_usage BIGINT;
  v_db_limit BIGINT;
  v_quota BIGINT;
  v_tier TEXT;
BEGIN
  SELECT tier, storage_used_bytes, storage_limit_bytes
  INTO v_tier, v_current_usage, v_db_limit
  FROM public.profiles
  WHERE id = p_user_id;

  -- Prefer DB-stored limit (admin override), fall back to tier-based
  IF v_db_limit > 0 AND v_db_limit != 524288000 THEN
    -- Has a real DB limit (not the stale 500MB default)
    v_quota := v_db_limit;
  ELSE
    v_quota := CASE v_tier
      WHEN 'free'       THEN  1073741824    --   1 GB
      WHEN 'basic'      THEN 10737418240    --  10 GB
      WHEN 'standard'   THEN 26843545600    --  25 GB
      WHEN 'pro'        THEN 53687091200    --  50 GB
      WHEN 'business'   THEN 214748364800   -- 200 GB
      WHEN 'enterprise' THEN 536870912000   -- 500 GB
      ELSE 1073741824                       --   1 GB (default)
    END;
  END IF;

  RETURN (COALESCE(v_current_usage, 0) + p_file_size) <= v_quota;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 9. BILLING: Atomic daily reset via RPC
--    Current getEffectiveDailySpent() in credits.ts does a
--    non-atomic read-then-write that races at UTC midnight.
--    Add a DB function that atomically resets if needed.
-- ============================================================

CREATE OR REPLACE FUNCTION reset_daily_spent_if_needed(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_daily_spent INTEGER;
  v_last_reset DATE;
BEGIN
  SELECT COALESCE(daily_spent_credits, 0),
         COALESCE(last_daily_reset::DATE, '1970-01-01'::DATE)
  INTO v_daily_spent, v_last_reset
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_last_reset < CURRENT_DATE THEN
    UPDATE profiles
    SET daily_spent_credits = 0,
        last_daily_reset = CURRENT_DATE
    WHERE id = p_user_id;
    RETURN 0;
  END IF;

  RETURN v_daily_spent;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only backend should call this
REVOKE EXECUTE ON FUNCTION reset_daily_spent_if_needed(UUID) FROM authenticated, anon;
