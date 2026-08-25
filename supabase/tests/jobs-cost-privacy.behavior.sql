-- ============================================================================
-- Behavioral proof: the browser's view of `jobs` (migration 347).
--
-- Grants are not provable from SQL text -- the survey's whole starting point is
-- that a column-level REVOKE reads correct and does nothing. This executes the
-- real privilege system, and it is the thing that keeps the fix an invariant:
-- assertion #1 pins the EXACT selectable-column set, so ANY future migration
-- that re-grants table-level SELECT on jobs (`GRANT SELECT ON ALL TABLES IN
-- SCHEMA public TO authenticated` included) turns this red.
--
-- Own uuid range ...-000000000801 upward.
--
-- Run locally: same recipe as supabase/tests/model-pricing-privacy.behavior.sql
-- Expect the last line: NOTICE:  ALL BEHAVIOR ASSERTIONS PASSED
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: got % expected %', label, coalesce(actual, '<null>'), coalesce(expected, '<null>');
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000801', 'jc-owner@jc.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000802', 'jc-other@jc.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE '%@jc.test'), '2');

INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000801', 'jc project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000000801', 'c0000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000801', 'jc wf');

-- ------------------------------------------------------------------- grants
-- 1. THE INVARIANT: the exact set of columns `authenticated` may SELECT.
--    Anything more is a re-leak; anything less breaks Realtime.
SELECT pg_temp.assert_eq(
  'authenticated may SELECT exactly {id, output_data, status, user_id} on jobs',
  (SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name), '<none>')
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs'
      AND has_column_privilege('authenticated', 'public.jobs', column_name, 'SELECT')),
  'id,output_data,status,user_id');

-- 2. Named, so a failure reads as the leak it is rather than as a set diff.
SELECT pg_temp.assert_eq('authenticated cannot SELECT jobs.provider_cost',
  has_column_privilege('authenticated', 'public.jobs', 'provider_cost', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot SELECT jobs.display_cost',
  has_column_privilege('authenticated', 'public.jobs', 'display_cost', 'SELECT')::text, 'false');

-- 3. anon has nothing at all on jobs.
SELECT pg_temp.assert_eq('anon may SELECT no column of jobs',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='jobs'
      AND has_column_privilege('anon', 'public.jobs', column_name, 'SELECT')), '0');

-- 4. The Realtime precondition: realtime.apply_rls answers 'Error 401:
--    Unauthorized' when a PRIMARY KEY column is unreadable, which would kill the
--    location/object studios' job sync outright.
SELECT pg_temp.assert_eq('the jobs primary key stays selectable (Realtime 401 guard)',
  has_column_privilege('authenticated', 'public.jobs', 'id', 'SELECT')::text, 'true');

-- 5. The service-role backend is untouched.
SELECT pg_temp.assert_eq('service_role still reads jobs.provider_cost',
  has_column_privilege('service_role', 'public.jobs', 'provider_cost', 'SELECT')::text, 'true');

-- ------------------------------------------------------------------ default
-- 6. A row inserted WITHOUT is_public is born private. This is the whole second
--    half of the migration, and it is a behaviour, not a DDL string.
INSERT INTO jobs (id, workflow_id, user_id, status)
VALUES ('f0000000-0000-4000-8000-000000000801', 'd0000000-0000-4000-8000-000000000801',
        '00000000-0000-4000-8000-000000000801', 'completed');
SELECT pg_temp.assert_eq('a job inserted without is_public is born private',
  (SELECT is_public::text FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000801'), 'false');
SELECT pg_temp.assert_eq('...and the declared column default says so too',
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='jobs' AND column_name='is_public'), 'false');

-- 7. The default does not fight the media workers: an explicit publish still
--    publishes (video-worker.ts:208 / render-worker.ts:951 write it at
--    pickup/completion, which is what the gallery actually reads).
INSERT INTO jobs (id, workflow_id, user_id, status, is_public, job_type)
VALUES ('f0000000-0000-4000-8000-000000000802', 'd0000000-0000-4000-8000-000000000801',
        '00000000-0000-4000-8000-000000000801', 'completed', true, 'generate-image');
SELECT pg_temp.assert_eq('a worker that writes is_public = true still publishes',
  (SELECT is_public::text FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000802'), 'true');

-- ---------------------------------------------------------------- RLS + ACL
-- 8. THE SURPRISING FACT THE MIGRATION DEPENDS ON: the 032 policy reads
--    is_public, which `authenticated` can no longer SELECT -- and it still
--    filters correctly. Column privileges do not reach policy expressions.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000802","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000802';
SELECT pg_temp.assert_eq('a non-owner still sees a public+completed job through the policy',
  (SELECT count(*)::text FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000802'), '1');
SELECT pg_temp.assert_eq('...and still cannot see the private one',
  (SELECT count(*)::text FROM jobs WHERE id = 'f0000000-0000-4000-8000-000000000801'), '0');
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
