-- Migration 032: Consolidate RLS policies, fix auth initplan, drop duplicate indexes
-- Addresses all Supabase linter warnings:
--   1. Duplicate indexes (4 pairs)
--   2. Auth RLS InitPlan: wrap auth.uid() in (select ...) for per-row optimization
--   3. Multiple permissive policies: merge overlapping SELECT/INSERT/UPDATE/DELETE

-- ============================================================
-- PART 1: Drop duplicate indexes
-- ============================================================

-- assets: idx_assets_is_library_item and idx_assets_library are identical
-- (idx_assets_library may already be dropped by 031, but be safe)
DROP INDEX IF EXISTS idx_assets_library;

-- credit_transactions: idx_credit_tx_user duplicates idx_credit_transactions_user_id_created_at
-- (idx_credit_tx_user was created outside migrations, e.g. via dashboard)
DROP INDEX IF EXISTS idx_credit_tx_user;

-- jobs: both were dropped in 031, but be safe
DROP INDEX IF EXISTS idx_jobs_usage_log;
DROP INDEX IF EXISTS idx_jobs_usage_log_id;

-- usage_logs: idx_usage_logs_user_created duplicates idx_usage_logs_user_id_created_at
DROP INDEX IF EXISTS idx_usage_logs_user_created;


-- ============================================================
-- PART 2: Fix Auth RLS InitPlan — wrap auth.uid() in (select ...)
-- For simple ownership policies, drop + recreate with (select auth.uid())
-- For complex policies (EXISTS subqueries), drop + recreate with wrapping
-- ============================================================

-- ---- ASSETS ----

-- 2a. "Users can CRUD own assets" → was FOR ALL, now superseded by granular policies.
--     Drop it entirely — 020 already created per-operation policies that cover all cases.
DROP POLICY IF EXISTS "Users can CRUD own assets" ON assets;

-- 2b. "Users can view library items" — subsumed by "Users can view own and shared assets"
--     which already includes `is_library_item = true`. Drop redundant.
DROP POLICY IF EXISTS "Users can view library items" ON assets;

-- 2c. "Admins can view all assets" — keep but already uses is_admin() (no auth.uid())
--     No change needed.

-- 2d. Recreate "Users can view own and shared assets" with (select auth.uid())
DROP POLICY IF EXISTS "Users can view own and shared assets" ON assets;
CREATE POLICY "Users can view own and shared assets" ON assets
  FOR SELECT USING (
    user_id = (select auth.uid()) OR is_shared = true OR is_library_item = true
    OR is_admin()
  );

-- 2e. Recreate "Users can insert assets with restrictions" with (select auth.uid())
DROP POLICY IF EXISTS "Users can insert assets with restrictions" ON assets;
CREATE POLICY "Users can insert assets with restrictions" ON assets
  FOR INSERT WITH CHECK (
    user_id = (select auth.uid())
    AND (is_library_item = false OR (is_library_item = true AND is_admin()))
  );

-- 2f. Recreate "Users can update own assets or admins can update library" with (select auth.uid())
DROP POLICY IF EXISTS "Users can update own assets or admins can update library" ON assets;
CREATE POLICY "Users can update own assets or admins can update library" ON assets
  FOR UPDATE USING (
    user_id = (select auth.uid()) OR (is_library_item = true AND is_admin())
  ) WITH CHECK (
    user_id = (select auth.uid()) OR (is_library_item = true AND is_admin())
  );

-- 2g. Recreate "Users can delete own assets or admins can delete library" with (select auth.uid())
DROP POLICY IF EXISTS "Users can delete own assets or admins can delete library" ON assets;
CREATE POLICY "Users can delete own assets or admins can delete library" ON assets
  FOR DELETE USING (
    user_id = (select auth.uid()) OR (is_library_item = true AND is_admin())
  );


-- ---- CHARACTERS ----

-- "Users can CRUD own characters" and "Users can CRUD own characters via project"
-- are identical (both check project ownership). Drop both, recreate one with (select auth.uid()).
DROP POLICY IF EXISTS "Users can CRUD own characters" ON characters;
DROP POLICY IF EXISTS "Users can CRUD own characters via project" ON characters;

CREATE POLICY "Users can CRUD own characters via project" ON characters
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = characters.project_id AND user_id = (select auth.uid())
    )
  );


-- ---- JOBS ----

-- Merge 3 SELECT policies into 1, and fix initplan on INSERT
DROP POLICY IF EXISTS "Users can read own jobs" ON jobs;
DROP POLICY IF EXISTS "Public gallery read" ON jobs;
DROP POLICY IF EXISTS "Admins can view all jobs" ON jobs;
DROP POLICY IF EXISTS "Users can insert own jobs" ON jobs;

CREATE POLICY "Users can read own jobs" ON jobs
  FOR SELECT USING (
    user_id = (select auth.uid())
    OR (is_public = true AND status = 'completed')
    OR is_admin()
  );

CREATE POLICY "Users can insert own jobs" ON jobs
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);


-- ---- PROFILES ----

-- Merge 2 SELECT policies into 1, fix initplan on UPDATE
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING ((select auth.uid()) = id OR is_admin());

-- Recreate UPDATE with (select auth.uid()) wrapping
DROP POLICY IF EXISTS "Users can update own safe columns" ON profiles;
CREATE POLICY "Users can update own safe columns" ON profiles
  FOR UPDATE USING ((select auth.uid()) = id)
  WITH CHECK (
    (select auth.uid()) = id
    AND check_profiles_update_allowed(
      id, role, tier, subscription_tier,
      subscription_credits, topup_credits, daily_spent_credits,
      credits_balance, storage_limit_bytes
    )
  );


-- ---- PROJECTS ----

-- Merge 2 SELECT policies, fix initplan on the FOR ALL
DROP POLICY IF EXISTS "Users can CRUD own projects" ON projects;
DROP POLICY IF EXISTS "Admins can view all projects" ON projects;

-- Split into SELECT (merged with admin) + INSERT/UPDATE/DELETE (user only)
CREATE POLICY "Users can view own projects" ON projects
  FOR SELECT USING ((select auth.uid()) = user_id OR is_admin());

CREATE POLICY "Users can insert own projects" ON projects
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own projects" ON projects
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own projects" ON projects
  FOR DELETE USING ((select auth.uid()) = user_id);


-- ---- STYLE_PRESETS ----

-- Merge 2 SELECT policies and fix initplan
DROP POLICY IF EXISTS "Users can read system presets" ON style_presets;
DROP POLICY IF EXISTS "Users can CRUD own presets" ON style_presets;

-- Consolidated SELECT: own presets OR system presets
CREATE POLICY "Users can view presets" ON style_presets
  FOR SELECT USING (user_id = (select auth.uid()) OR is_system = TRUE);

-- CUD: own presets only
CREATE POLICY "Users can manage own presets" ON style_presets
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Users can update own presets" ON style_presets
  FOR UPDATE USING (user_id = (select auth.uid()));

CREATE POLICY "Users can delete own presets" ON style_presets
  FOR DELETE USING (user_id = (select auth.uid()));


-- ---- SUBSCRIPTIONS ----

-- Drop duplicate SELECT policies, recreate 1 with (select auth.uid())
DROP POLICY IF EXISTS "Users can view own subscription" ON subscriptions;
DROP POLICY IF EXISTS "Users read own subscription" ON subscriptions;

CREATE POLICY "Users can view own subscription" ON subscriptions
  FOR SELECT USING ((select auth.uid()) = user_id);


-- ---- USAGE_LOGS ----

-- Merge 2 SELECT policies into 1
DROP POLICY IF EXISTS "Users can view own usage" ON usage_logs;
DROP POLICY IF EXISTS "Admins can view all usage logs" ON usage_logs;

CREATE POLICY "Users can view own usage" ON usage_logs
  FOR SELECT USING ((select auth.uid()) = user_id OR is_admin());


-- ---- WORKFLOWS ----

-- Merge 2 SELECT policies, fix initplan, split FOR ALL
DROP POLICY IF EXISTS "Users can CRUD own workflows" ON workflows;
DROP POLICY IF EXISTS "Admins can view all workflows" ON workflows;

CREATE POLICY "Users can view own workflows" ON workflows
  FOR SELECT USING ((select auth.uid()) = user_id OR is_admin());

CREATE POLICY "Users can insert own workflows" ON workflows
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own workflows" ON workflows
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own workflows" ON workflows
  FOR DELETE USING ((select auth.uid()) = user_id);


-- ---- WORKFLOW_HISTORY ----

DROP POLICY IF EXISTS "Users can access own workflow history" ON workflow_history;
CREATE POLICY "Users can access own workflow history" ON workflow_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.workflows
      WHERE id = workflow_history.workflow_id AND user_id = (select auth.uid())
    )
  );


-- ---- JOB_CHECKPOINTS ----

DROP POLICY IF EXISTS "Users can access own job checkpoints" ON job_checkpoints;
CREATE POLICY "Users can access own job checkpoints" ON job_checkpoints
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE id = job_checkpoints.job_id AND user_id = (select auth.uid())
    )
  );


-- ---- WEBHOOKS ----

DROP POLICY IF EXISTS "Users can CRUD own webhooks" ON webhooks;
CREATE POLICY "Users can CRUD own webhooks" ON webhooks
  FOR ALL USING ((select auth.uid()) = user_id);


-- ---- WEBHOOK_DELIVERIES ----

DROP POLICY IF EXISTS "Users can view own webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Users can view own webhook deliveries" ON webhook_deliveries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.webhooks
      WHERE id = webhook_deliveries.webhook_id AND user_id = (select auth.uid())
    )
  );


-- ---- CREDIT_PURCHASES ----

DROP POLICY IF EXISTS "Users can view own purchases" ON credit_purchases;
CREATE POLICY "Users can view own purchases" ON credit_purchases
  FOR SELECT USING ((select auth.uid()) = user_id);


-- ---- PADDLE_CUSTOMERS ----

DROP POLICY IF EXISTS "Users read own paddle customer" ON paddle_customers;
CREATE POLICY "Users read own paddle customer" ON paddle_customers
  FOR SELECT USING ((select auth.uid()) = user_id);


-- ---- TRANSACTIONS ----

DROP POLICY IF EXISTS "Users read own transactions" ON transactions;
CREATE POLICY "Users read own transactions" ON transactions
  FOR SELECT USING ((select auth.uid()) = user_id);


-- ---- CREDIT_TRANSACTIONS ----

DROP POLICY IF EXISTS "Users read own credit transactions" ON credit_transactions;
CREATE POLICY "Users read own credit transactions" ON credit_transactions
  FOR SELECT USING ((select auth.uid()) = user_id);


-- ---- FACES ----

DROP POLICY IF EXISTS "Users can view own faces" ON faces;
DROP POLICY IF EXISTS "Users can insert own faces" ON faces;
DROP POLICY IF EXISTS "Users can update own faces" ON faces;
DROP POLICY IF EXISTS "Users can delete own faces" ON faces;

CREATE POLICY "Users can view own faces" ON faces
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own faces" ON faces
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own faces" ON faces
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own faces" ON faces
  FOR DELETE USING ((select auth.uid()) = user_id);


-- ---- LOCATIONS ----

DROP POLICY IF EXISTS "Users can CRUD own locations" ON locations;
CREATE POLICY "Users can CRUD own locations" ON locations
  FOR ALL USING ((select auth.uid()) = user_id);


-- ---- OBJECTS ----

DROP POLICY IF EXISTS "Users can CRUD own objects" ON objects;
CREATE POLICY "Users can CRUD own objects" ON objects
  FOR ALL USING ((select auth.uid()) = user_id);


-- ---- VOICE_CLONES ----

DROP POLICY IF EXISTS "Users can CRUD own voice clones" ON voice_clones;
CREATE POLICY "Users can CRUD own voice clones" ON voice_clones
  FOR ALL USING (user_id = (select auth.uid()));
