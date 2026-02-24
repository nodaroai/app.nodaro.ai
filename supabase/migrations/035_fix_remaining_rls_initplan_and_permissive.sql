-- Fix remaining Supabase linter warnings:
--   1. auth_rls_initplan on api_keys: wrap auth.uid() in (select ...)
--   2. auth_rls_initplan on folders: wrap auth.uid() in (select ...)
--   3. multiple_permissive_policies on assets SELECT: drop stale "Admins can view
--      all assets" policy — admin access is already included in the consolidated
--      "Users can view own and shared assets" policy (migration 032, line 51:
--      OR is_admin())

-- ============================================================
-- 1. api_keys: fix initplan
-- ============================================================

DROP POLICY IF EXISTS "Users can CRUD own API keys" ON api_keys;
CREATE POLICY "Users can CRUD own API keys" ON api_keys
  FOR ALL USING ((select auth.uid()) = user_id);

-- ============================================================
-- 2. folders: fix initplan
-- ============================================================

DROP POLICY IF EXISTS "Users can CRUD own folders" ON folders;
CREATE POLICY "Users can CRUD own folders" ON folders
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = folders.project_id AND user_id = (select auth.uid())
    )
  );

-- ============================================================
-- 3. assets: drop redundant admin SELECT policy
-- ============================================================

-- "Admins can view all assets" (created in 024) is now redundant because
-- "Users can view own and shared assets" (recreated in 032) already includes
-- `OR is_admin()`.  Two permissive SELECT policies on the same table means
-- Postgres evaluates both for every row — dropping the stale one is free perf.
DROP POLICY IF EXISTS "Admins can view all assets" ON assets;
