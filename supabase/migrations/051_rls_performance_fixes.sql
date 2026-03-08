-- Migration 051: RLS performance fixes
-- Addresses Supabase linter warnings:
--   1. auth_rls_initplan: wrap auth.uid() in (select auth.uid()) for single evaluation
--   2. multiple_permissive_policies: merge duplicate SELECT policies into single policies

-- ============================================================
-- 1. api_tokens: fix initplan + merge SELECT policies
--    Old: api_tokens_own (FOR ALL) + api_tokens_admin (FOR SELECT)
--    New: single SELECT with OR, separate INSERT/UPDATE/DELETE
-- ============================================================

DROP POLICY IF EXISTS api_tokens_own ON api_tokens;
DROP POLICY IF EXISTS api_tokens_admin ON api_tokens;

-- Merged SELECT: own tokens OR admin
CREATE POLICY api_tokens_select ON api_tokens
  FOR SELECT
  USING ((select auth.uid()) = user_id OR is_admin());

-- Separate write policies (owner only)
CREATE POLICY api_tokens_insert ON api_tokens
  FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY api_tokens_update ON api_tokens
  FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY api_tokens_delete ON api_tokens
  FOR DELETE
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- 2. social_connections: fix initplan on all 4 policies
-- ============================================================

DROP POLICY IF EXISTS "Users can view their own connections" ON social_connections;
DROP POLICY IF EXISTS "Users can insert their own connections" ON social_connections;
DROP POLICY IF EXISTS "Users can update their own connections" ON social_connections;
DROP POLICY IF EXISTS "Users can delete their own connections" ON social_connections;

CREATE POLICY "Users can view their own connections"
  ON social_connections FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert their own connections"
  ON social_connections FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update their own connections"
  ON social_connections FOR UPDATE
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete their own connections"
  ON social_connections FOR DELETE
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- 3. published_apps: fix initplan + merge SELECT policies
--    Old: "Creator can manage own apps" (FOR ALL) +
--         "Anyone can read active published apps" (FOR SELECT)
--    New: single SELECT with OR, separate INSERT/UPDATE/DELETE
-- ============================================================

DROP POLICY IF EXISTS "Creator can manage own apps" ON published_apps;
DROP POLICY IF EXISTS "Anyone can read active published apps" ON published_apps;

-- Merged SELECT: active apps (public) OR own apps (creator)
CREATE POLICY "Select published apps"
  ON published_apps FOR SELECT
  USING (is_active = true OR creator_id = (select auth.uid()));

-- Separate write policies (creator only)
CREATE POLICY "Creator can insert own apps"
  ON published_apps FOR INSERT
  WITH CHECK (creator_id = (select auth.uid()));

CREATE POLICY "Creator can update own apps"
  ON published_apps FOR UPDATE
  USING (creator_id = (select auth.uid()));

CREATE POLICY "Creator can delete own apps"
  ON published_apps FOR DELETE
  USING (creator_id = (select auth.uid()));

-- ============================================================
-- 4. app_runs: fix initplan + merge SELECT policies
--    Old: "Runner can see own runs" (SELECT) +
--         "Creator can see runs on own apps" (SELECT)
--    New: single SELECT with OR
-- ============================================================

DROP POLICY IF EXISTS "Runner can see own runs" ON app_runs;
DROP POLICY IF EXISTS "Creator can see runs on own apps" ON app_runs;
DROP POLICY IF EXISTS "Runner can insert own runs" ON app_runs;
DROP POLICY IF EXISTS "Runner can update own runs" ON app_runs;
DROP POLICY IF EXISTS "Runner can delete own runs" ON app_runs;

-- Merged SELECT: own runs OR creator of the app
CREATE POLICY "Select app runs"
  ON app_runs FOR SELECT
  USING (
    runner_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM published_apps
      WHERE published_apps.id = app_runs.app_id
      AND published_apps.creator_id = (select auth.uid())
    )
  );

CREATE POLICY "Runner can insert own runs"
  ON app_runs FOR INSERT
  WITH CHECK (runner_id = (select auth.uid()));

CREATE POLICY "Runner can update own runs"
  ON app_runs FOR UPDATE
  USING (runner_id = (select auth.uid()))
  WITH CHECK (runner_id = (select auth.uid()));

CREATE POLICY "Runner can delete own runs"
  ON app_runs FOR DELETE
  USING (runner_id = (select auth.uid()));

-- ============================================================
-- 5. app_analytics: fix initplan
-- ============================================================

DROP POLICY IF EXISTS "Creator can see own app analytics" ON app_analytics;

CREATE POLICY "Creator can see own app analytics"
  ON app_analytics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM published_apps
      WHERE published_apps.id = app_analytics.app_id
      AND published_apps.creator_id = (select auth.uid())
    )
  );

-- ============================================================
-- 6. stripe_customers: fix initplan
-- ============================================================

DROP POLICY IF EXISTS "Users read own stripe customer" ON stripe_customers;

CREATE POLICY "Users read own stripe customer"
  ON stripe_customers FOR SELECT
  USING (user_id = (select auth.uid()));
