-- Migration 050: Security audit fixes
-- Addresses:
--   1. add_subscription_credits re-exposed to authenticated after migration 027 CREATE OR REPLACE
--   2. executions table referenced in 033 but never created (conditional guard)
--   3. update_app_analytics missing search_path pinning
--   4. get_admin_stats callable by any authenticated user (add admin check inside function)

-- ============================================================
-- 1. REVOKE add_subscription_credits from authenticated/anon
-- Migration 024 originally revoked these, but 027's CREATE OR REPLACE
-- reset the privileges. Re-apply the revoke.
-- ============================================================

REVOKE EXECUTE ON FUNCTION add_subscription_credits(UUID, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION add_subscription_credits(UUID, INTEGER) FROM anon;

-- ============================================================
-- 2. Guard for executions table (created manually in some envs)
-- If executions table doesn't exist, skip RLS setup.
-- Migration 033 assumed it exists; fresh deploys would fail.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'executions'
  ) THEN
    -- Already handled by 033 if table existed, but ensure RLS is on
    EXECUTE 'ALTER TABLE public.executions ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ============================================================
-- 3. Pin search_path on update_app_analytics (created in 045)
-- ============================================================

ALTER FUNCTION update_app_analytics() SET search_path = public;

-- ============================================================
-- 4. Restrict get_admin_stats to admins only
-- Add is_admin() check inside the function body so PostgREST
-- callers can't access operational metrics without admin role.
-- ============================================================

CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  approx_profiles  BIGINT;
  approx_projects  BIGINT;
  approx_workflows BIGINT;
  approx_jobs      BIGINT;
  jobs_by_status   JSONB;
  total_credits    NUMERIC;
BEGIN
  -- Admin check: reject non-admin callers
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- Fast approximate counts from pg_class (no table scan)
  SELECT GREATEST(reltuples::bigint, 0) INTO approx_profiles
    FROM pg_class WHERE relname = 'profiles';

  SELECT GREATEST(reltuples::bigint, 0) INTO approx_projects
    FROM pg_class WHERE relname = 'projects';

  SELECT GREATEST(reltuples::bigint, 0) INTO approx_workflows
    FROM pg_class WHERE relname = 'workflows';

  SELECT GREATEST(reltuples::bigint, 0) INTO approx_jobs
    FROM pg_class WHERE relname = 'jobs';

  -- Jobs by status: single pass with FILTER
  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
    INTO jobs_by_status
    FROM (
      SELECT status, COUNT(*) AS cnt
      FROM jobs
      GROUP BY status
    ) t;

  -- Total credits: single SUM
  SELECT COALESCE(SUM(credits_used), 0)
    INTO total_credits
    FROM usage_logs;

  result := jsonb_build_object(
    'totalUsers',      approx_profiles,
    'totalProjects',   approx_projects,
    'totalWorkflows',  approx_workflows,
    'totalJobs',       approx_jobs,
    'jobsByStatus',    jobs_by_status,
    'totalCreditsUsed', total_credits
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Re-apply grant (CREATE OR REPLACE resets privileges)
GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;
-- Revoke from anon for safety
REVOKE EXECUTE ON FUNCTION get_admin_stats() FROM anon;

-- ============================================================
-- 5. Fix FK constraints on published_apps and app_runs
-- Add ON DELETE CASCADE so user deletion doesn't fail.
-- ============================================================

-- published_apps.creator_id: cascade delete when user is removed
ALTER TABLE published_apps DROP CONSTRAINT IF EXISTS published_apps_creator_id_fkey;
ALTER TABLE published_apps ADD CONSTRAINT published_apps_creator_id_fkey
  FOREIGN KEY (creator_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- app_runs.runner_id: set null when runner is removed
ALTER TABLE app_runs DROP CONSTRAINT IF EXISTS app_runs_runner_id_fkey;
ALTER TABLE app_runs ALTER COLUMN runner_id DROP NOT NULL;
ALTER TABLE app_runs ADD CONSTRAINT app_runs_runner_id_fkey
  FOREIGN KEY (runner_id) REFERENCES auth.users(id) ON DELETE SET NULL;
