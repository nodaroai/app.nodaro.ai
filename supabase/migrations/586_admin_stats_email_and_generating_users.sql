-- ============================================================================
-- Admin dashboard: two more user counts, and an exact user count.
--
-- `get_admin_stats` (last defined in 050) gains:
--   usersAcceptingEmail  - users whose marketing-email consent is granted right
--                          now (user_consents, kind 'marketing_email', status
--                          'granted'). A user who granted and later withdrew is
--                          not counted: they are off the list.
--   usersWithGeneration  - users with at least one COMPLETED job, of any job
--                          type. A user whose jobs all failed or were cancelled
--                          is not counted.
--
-- `totalUsers` becomes an exact count of profiles. It was pg_class.reltuples, a
-- planner estimate that can lag the table, and the dashboard now shows the two
-- counts above as a share of it: an estimate under an exact numerator could read
-- above 100%. Projects, workflows and jobs keep their fast estimates.
--
-- Same signature and return type, so CREATE OR REPLACE keeps the function and
-- its grants; they are stated again below anyway. The is_admin() gate is
-- unchanged. The search_path is now pinned (SECURITY DEFINER hardening).
--
-- Cost: one exact count over profiles, one over user_consents (primary key
-- user_id, kind), and one EXISTS probe per profile on jobs through
-- idx_jobs_user_id (001).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  total_users           BIGINT;
  users_accepting_email BIGINT;
  users_with_generation BIGINT;
  approx_projects       BIGINT;
  approx_workflows      BIGINT;
  approx_jobs           BIGINT;
  jobs_by_status        JSONB;
  total_credits         NUMERIC;
BEGIN
  -- Admin check: reject non-admin callers
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  SELECT count(*) INTO total_users FROM profiles;

  SELECT count(*) INTO users_accepting_email
    FROM user_consents c
   WHERE c.kind = 'marketing_email'
     AND c.status = 'granted'
     AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = c.user_id);

  SELECT count(*) INTO users_with_generation
    FROM profiles p
   WHERE EXISTS (
     SELECT 1 FROM jobs j WHERE j.user_id = p.id AND j.status = 'completed'
   );

  -- Fast approximate counts from pg_class (no table scan)
  SELECT GREATEST(reltuples::bigint, 0) INTO approx_projects
    FROM pg_class WHERE relname = 'projects';

  SELECT GREATEST(reltuples::bigint, 0) INTO approx_workflows
    FROM pg_class WHERE relname = 'workflows';

  SELECT GREATEST(reltuples::bigint, 0) INTO approx_jobs
    FROM pg_class WHERE relname = 'jobs';

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
    INTO jobs_by_status
    FROM (
      SELECT status, COUNT(*) AS cnt
      FROM jobs
      GROUP BY status
    ) t;

  SELECT COALESCE(SUM(credits_used), 0)
    INTO total_credits
    FROM usage_logs;

  RETURN jsonb_build_object(
    'totalUsers',          total_users,
    'usersAcceptingEmail', users_accepting_email,
    'usersWithGeneration', users_with_generation,
    'totalProjects',       approx_projects,
    'totalWorkflows',      approx_workflows,
    'totalJobs',           approx_jobs,
    'jobsByStatus',        jobs_by_status,
    'totalCreditsUsed',    total_credits
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;
