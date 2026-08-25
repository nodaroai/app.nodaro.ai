-- ============================================================================
-- Behavioral proof: usage_logs is not browser-readable (migration 346).
--
-- The value being protected is `cost_usd` -- a COLUMN the REST projection
-- cannot reach -- so the grant IS the fix, and only the privilege system can
-- prove it. Runs on real Postgres in the migration-behavior CI job, after the
-- whole chain, in a transaction that rolls back.
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

-- 0. Not vacuous: the columns this protects still exist under these names.
SELECT pg_temp.assert_eq('usage_logs still has cost_usd and metadata',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='usage_logs'
      AND column_name IN ('cost_usd','metadata')), '2');

-- 1. THE LEAK: neither browser role may read the table at all.
SELECT pg_temp.assert_eq('authenticated cannot SELECT usage_logs',
  has_table_privilege('authenticated', 'public.usage_logs', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot SELECT usage_logs',
  has_table_privilege('anon', 'public.usage_logs', 'SELECT')::text, 'false');

-- 2. Column-wise too -- catches a future column-list GRANT that would leave
--    has_table_privilege false while re-opening cost_usd.
SELECT pg_temp.assert_eq('authenticated may SELECT no column of usage_logs',
  (SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='usage_logs'
      AND has_column_privilege('authenticated', 'public.usage_logs', column_name, 'SELECT')), '0');

-- 3. Writes are closed too (the browser never wrote here; the RPCs are
--    SECURITY DEFINER and the backend is service_role).
SELECT pg_temp.assert_eq('authenticated cannot INSERT into usage_logs',
  has_table_privilege('authenticated', 'public.usage_logs', 'INSERT')::text, 'false');

-- 4. ...and the backend is not locked out.
SELECT pg_temp.assert_eq('service_role still reads usage_logs',
  has_table_privilege('service_role', 'public.usage_logs', 'SELECT')::text, 'true');

-- 5. The admin Usage page's path is a SECURITY DEFINER RPC, so it is unaffected
--    by the table grant -- assert the function still exists and is DEFINER.
SELECT pg_temp.assert_eq('get_admin_usage_logs is still SECURITY DEFINER',
  (SELECT prosecdef::text FROM pg_proc WHERE proname = 'get_admin_usage_logs' LIMIT 1), 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
