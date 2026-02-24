-- Optimize admin dashboard stats and gallery queries.
--
-- Problem 1: useAdminStats() makes 6 separate queries including two full-table
-- scans (all job statuses, all usage_log credits_used) that get worse as tables
-- grow.  Replace with a single SECURITY DEFINER RPC that uses pg_class.reltuples
-- for fast approximate row counts and single-pass aggregation for the rest.
--
-- Problem 2: Gallery query filters (is_public, status='completed', output_data
-- IS NOT NULL, job_type IN (...)) are only partially covered by the existing
-- idx_jobs_gallery partial index.  Replace with a composite partial index that
-- also includes job_type for an index-only filter.

-- ============================================================
-- 1. get_admin_stats RPC
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

-- Grant execute to authenticated (admin check is in the frontend/backend)
GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;

-- ============================================================
-- 2. Improved gallery partial index
-- ============================================================

-- Replace old partial index with one that includes job_type.
-- The partial WHERE clause pre-filters to only gallery-eligible rows,
-- keeping the index small.  Including job_type lets the planner use
-- the index for the IN(job_type) filter without a recheck.
DROP INDEX IF EXISTS idx_jobs_gallery;

CREATE INDEX idx_jobs_gallery
  ON jobs (completed_at DESC, job_type)
  WHERE is_public = true AND status = 'completed' AND output_data IS NOT NULL;
