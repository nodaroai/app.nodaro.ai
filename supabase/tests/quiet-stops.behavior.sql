-- ============================================================================
-- Behavioral proof: quiet stops (migration 505).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000971 upward).
--
-- The table is protected only by RLS with no policies and two REVOKEs. Each
-- assertion below is a stop a user could read (an oracle) or lift themselves
-- if it regresses.
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
  ('00000000-0000-4000-8000-000000000971', 'qs-stopped@qs.test', '{}', 'authenticated', 'authenticated');

INSERT INTO quiet_stops (user_id, reason) VALUES ('00000000-0000-4000-8000-000000000971', 'farm');

SELECT pg_temp.assert_eq('RLS is on', (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.quiet_stops'::regclass), 'true');
SELECT pg_temp.assert_eq('no policy exists', (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'quiet_stops'), '0');
SELECT pg_temp.assert_eq('anon has no privilege', has_table_privilege('anon', 'public.quiet_stops', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated has no privilege', has_table_privilege('authenticated', 'public.quiet_stops', 'SELECT, INSERT, UPDATE, DELETE')::text, 'false');

-- The stopped person, signed in, cannot see or lift their own stop.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000971","role":"authenticated"}', true);
DO $$ BEGIN
  PERFORM 1 FROM quiet_stops;
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user read quiet_stops';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot read quiet_stops';
END $$;
DO $$ BEGIN
  DELETE FROM quiet_stops WHERE user_id = '00000000-0000-4000-8000-000000000971';
  RAISE EXCEPTION 'ASSERT FAIL: a signed-in user deleted from quiet_stops';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  a signed-in user cannot lift a quiet stop';
END $$;
RESET ROLE;
SELECT pg_temp.assert_eq('the stop is still there',
  (SELECT count(*)::text FROM quiet_stops WHERE user_id = '00000000-0000-4000-8000-000000000971'), '1');

-- Deleting the account takes the stop with it.
DELETE FROM profiles WHERE id = '00000000-0000-4000-8000-000000000971';
SELECT pg_temp.assert_eq('a deleted account leaves no stop behind',
  (SELECT count(*)::text FROM quiet_stops WHERE user_id = '00000000-0000-4000-8000-000000000971'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
