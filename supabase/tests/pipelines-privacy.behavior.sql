-- ============================================================================
-- Behavioral proof: pipelines is not browser-writable (migration 359).
--
-- The value being protected is `config.billingContext` -- the pipeline's
-- durable payer stamp. The application funnel strips a caller-supplied stamp
-- at create/seed/branch, but a funnel cannot guard a directly writable
-- COLUMN: the 121 owner policy is FOR ALL and the platform default grants
-- let the row owner UPDATE `config` over PostgREST, replacing the stamp
-- after creation. Only the grant closes it, and only the privilege system
-- can prove it. Runs on real Postgres in the migration-behavior CI job,
-- after the whole chain, in a transaction that rolls back.
--
-- Run locally: same recipe as supabase/tests/usage-logs-privacy.behavior.sql
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

-- 0. Not vacuous: the column this protects still exists under this name.
SELECT pg_temp.assert_eq('pipelines still has config',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pipelines'
      AND column_name = 'config'), '1');

-- 1. THE DOOR: neither browser role may write the table at all.
SELECT pg_temp.assert_eq('authenticated cannot UPDATE pipelines',
  has_table_privilege('authenticated', 'public.pipelines', 'UPDATE')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot UPDATE pipelines',
  has_table_privilege('anon', 'public.pipelines', 'UPDATE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot INSERT into pipelines',
  has_table_privilege('authenticated', 'public.pipelines', 'INSERT')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot INSERT into pipelines',
  has_table_privilege('anon', 'public.pipelines', 'INSERT')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot SELECT pipelines',
  has_table_privilege('anon', 'public.pipelines', 'SELECT')::text, 'false');

-- 2. Column-wise too -- catches a future column-list GRANT that would leave
--    has_table_privilege false while re-opening config.
SELECT pg_temp.assert_eq('authenticated may UPDATE no column of pipelines',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pipelines'
      AND has_column_privilege('authenticated', 'public.pipelines', column_name, 'UPDATE')), '0');
SELECT pg_temp.assert_eq('anon may UPDATE no column of pipelines',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pipelines'
      AND has_column_privilege('anon', 'public.pipelines', column_name, 'UPDATE')), '0');

-- 3. Reads are closed with the same stroke (nothing first-party reads this
--    table from a browser; every application surface goes through routes).
SELECT pg_temp.assert_eq('authenticated cannot SELECT pipelines',
  has_table_privilege('authenticated', 'public.pipelines', 'SELECT')::text, 'false');

-- 4. ...and the backend is not locked out.
SELECT pg_temp.assert_eq('service_role still writes pipelines',
  has_table_privilege('service_role', 'public.pipelines', 'UPDATE')::text, 'true');
SELECT pg_temp.assert_eq('service_role still reads pipelines',
  has_table_privilege('service_role', 'public.pipelines', 'SELECT')::text, 'true');

-- 5. The 121 owner policy is deliberately still there -- belt and braces
--    behind the privilege denial, not a substitute for it.
SELECT pg_temp.assert_eq('the pipelines_owner row policy still exists',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='pipelines' AND policyname='pipelines_owner'), '1');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
