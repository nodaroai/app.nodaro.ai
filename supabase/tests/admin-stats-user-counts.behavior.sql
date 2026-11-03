-- ============================================================================
-- Behavioral proof: the admin dashboard's user counts (migration 586).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000058601 upward).
--
-- What it pins, as deltas over whatever rows already exist:
--   totalUsers           - every profile, exactly.
--   usersAcceptingEmail  - marketing-email consent granted NOW: withdrawn,
--                          declined and pending are not counted.
--   usersWithGeneration  - at least one COMPLETED job: a user whose jobs only
--                          failed or were cancelled is not counted, and a user
--                          with several completed jobs counts once.
-- And that a non-admin caller is refused.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/admin-stats-user-counts.behavior.sql mig-test:/tmp/t.sql
--   docker exec mig-test psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/t.sql
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

-- The admin whose session reads the stats.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000058601', 'st-admin@st.test', '{}', 'authenticated', 'authenticated');
UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-4000-8000-000000058601';

-- Read the stats in the admin's own session; \gset keeps the answer in a psql variable.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000058601","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000058601';
SELECT public.get_admin_stats()::text AS before_stats \gset
RESET ROLE;

-- Four users, one per case:
--   A granted now, two completed jobs      -> email yes, generation yes (once)
--   B granted then withdrew, failed job    -> email no,  generation no
--   C consent pending, cancelled + completed -> email no, generation yes
--   D declined, no jobs                     -> email no,  generation no
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-00000005860a', 'st-a@st.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000005860b', 'st-b@st.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000005860c', 'st-c@st.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000005860d', 'st-d@st.test', '{}', 'authenticated', 'authenticated');
SELECT pg_temp.assert_eq('profiles created by the auth trigger',
  (SELECT count(*)::text FROM profiles WHERE email LIKE 'st-_@st.test'), '4');

INSERT INTO user_consents (user_id, kind, status) VALUES
  ('00000000-0000-4000-8000-00000005860a', 'marketing_email', 'granted'),
  ('00000000-0000-4000-8000-00000005860b', 'marketing_email', 'withdrawn'),
  ('00000000-0000-4000-8000-00000005860c', 'marketing_email', 'pending'),
  ('00000000-0000-4000-8000-00000005860d', 'marketing_email', 'declined');

INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000058611', '00000000-0000-4000-8000-00000005860a', 'completed'),
  ('00000000-0000-4000-8000-000000058612', '00000000-0000-4000-8000-00000005860a', 'completed'),
  ('00000000-0000-4000-8000-000000058613', '00000000-0000-4000-8000-00000005860b', 'failed'),
  ('00000000-0000-4000-8000-000000058614', '00000000-0000-4000-8000-00000005860c', 'cancelled'),
  ('00000000-0000-4000-8000-000000058615', '00000000-0000-4000-8000-00000005860c', 'completed');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000058601","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000058601';
SELECT public.get_admin_stats()::text AS after_stats \gset
RESET ROLE;

SELECT pg_temp.assert_eq('totalUsers counts every new profile, exactly',
  ((:'after_stats'::jsonb->>'totalUsers')::bigint - (:'before_stats'::jsonb->>'totalUsers')::bigint)::text, '4');
SELECT pg_temp.assert_eq('usersAcceptingEmail counts only consent granted now',
  ((:'after_stats'::jsonb->>'usersAcceptingEmail')::bigint - (:'before_stats'::jsonb->>'usersAcceptingEmail')::bigint)::text, '1');
SELECT pg_temp.assert_eq('usersWithGeneration counts users with a completed job, once each',
  ((:'after_stats'::jsonb->>'usersWithGeneration')::bigint - (:'before_stats'::jsonb->>'usersWithGeneration')::bigint)::text, '2');
SELECT pg_temp.assert_eq('the existing keys are still returned',
  (SELECT (s ? 'totalProjects' AND s ? 'totalWorkflows' AND s ? 'totalJobs' AND s ? 'jobsByStatus' AND s ? 'totalCreditsUsed')::text FROM (SELECT :'after_stats'::jsonb AS s) x), 'true');

-- A non-admin caller is refused.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000005860a","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-00000005860a';
DO $$
BEGIN
  BEGIN
    PERFORM public.get_admin_stats();
    RAISE EXCEPTION 'ASSERT FAIL [a non-admin is refused]: the call returned';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Unauthorized%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  a non-admin is refused';
END $$;
RESET ROLE;

-- An anonymous caller cannot execute it at all.
SELECT pg_temp.assert_eq('anon has no EXECUTE on get_admin_stats',
  has_function_privilege('anon', 'public.get_admin_stats()', 'EXECUTE')::text, 'false');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
