-- Migration 033: Fix Supabase security audit findings
-- Addresses:
--   1. ERROR: RLS disabled on public.executions table
--   2. WARN:  Function search_path mutable on 24 functions
--   3. WARN:  Leaked password protection (dashboard setting, noted here)

-- ============================================================
-- PART 1: Enable RLS on executions table + create policies
-- ============================================================

ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'executions' AND policyname = 'Users can view own executions') THEN
    CREATE POLICY "Users can view own executions" ON executions
      FOR SELECT USING ((select auth.uid()) = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'executions' AND policyname = 'Users can insert own executions') THEN
    CREATE POLICY "Users can insert own executions" ON executions
      FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'executions' AND policyname = 'Users can update own executions') THEN
    CREATE POLICY "Users can update own executions" ON executions
      FOR UPDATE USING ((select auth.uid()) = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'executions' AND policyname = 'Users can delete own executions') THEN
    CREATE POLICY "Users can delete own executions" ON executions
      FOR DELETE USING ((select auth.uid()) = user_id);
  END IF;
END $$;


-- ============================================================
-- PART 2: Pin search_path on all flagged functions
-- Uses ALTER FUNCTION to set search_path without redefining
-- the function body, preserving all existing logic and signatures.
-- Using 'public' (not empty string) because 18 of 24 functions
-- use unqualified table names like "profiles" / "usage_logs".
-- Pinning to 'public' prevents search_path manipulation attacks
-- while keeping table resolution working.
-- ============================================================

-- Credit operations
ALTER FUNCTION reserve_credits(UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC) SET search_path = public;
ALTER FUNCTION commit_credits(UUID, INTEGER) SET search_path = public;
ALTER FUNCTION refund_credits(UUID) SET search_path = public;
ALTER FUNCTION deduct_credits(UUID, INTEGER) SET search_path = public;
ALTER FUNCTION check_credits(UUID, INTEGER) SET search_path = public;
ALTER FUNCTION get_total_credits(UUID) SET search_path = public;
ALTER FUNCTION get_credit_summary() SET search_path = public;
ALTER FUNCTION add_topup_credits(UUID, INTEGER) SET search_path = public;
ALTER FUNCTION add_subscription_credits(UUID, INTEGER) SET search_path = public;

-- Daily spent tracking
ALTER FUNCTION increment_daily_spent(UUID, INTEGER) SET search_path = public;
ALTER FUNCTION reset_daily_spent(UUID) SET search_path = public;
ALTER FUNCTION reset_daily_spent_if_needed(UUID) SET search_path = public;

-- Storage operations
ALTER FUNCTION increment_storage(UUID, BIGINT) SET search_path = public;
ALTER FUNCTION decrement_storage(UUID, BIGINT) SET search_path = public;
ALTER FUNCTION check_storage_quota(UUID, BIGINT) SET search_path = public;
ALTER FUNCTION get_storage_limit_for_tier(TEXT) SET search_path = public;

-- Auth & admin helpers
ALTER FUNCTION is_admin() SET search_path = public;
ALTER FUNCTION get_my_role() SET search_path = public;
ALTER FUNCTION get_stats(UUID) SET search_path = public;

-- Profile update guard
ALTER FUNCTION check_profiles_update_allowed(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BIGINT) SET search_path = public;

-- Sharing
ALTER FUNCTION share_workflow_assets(UUID) SET search_path = public;

-- Trigger functions
ALTER FUNCTION handle_new_user() SET search_path = public;
ALTER FUNCTION update_updated_at() SET search_path = public;
ALTER FUNCTION update_assets_updated_at() SET search_path = public;


-- ============================================================
-- PART 3: Leaked Password Protection
-- NOTE: This is a Supabase Dashboard setting, not a SQL migration.
-- Enable at: Dashboard > Authentication > Settings > Password Security
--            > "Enable leaked password protection"
-- ============================================================
