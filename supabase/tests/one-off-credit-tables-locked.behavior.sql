-- ============================================================================
-- Behavioral proof: the one-off credit bookkeeping tables are server-only
-- (migration 558).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. 289 and 295 created these tables without RLS, so the public
-- (anon) key could read profile ids with their old balances and write rows.
-- For each table:
--   1. row level security is on;
--   2. anon and authenticated hold no privilege at all (read or write);
--   3. service_role (the server, migrations) still reads it.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.assert_eq(label text, actual text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL %: expected %, got %', label, expected, actual;
  END IF;
END;
$$;

DO $$
DECLARE
  t TEXT;
  role_name TEXT;
  priv TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.credit_redenomination_state',
    'public.credit_redenomination_snapshot',
    'public.free_grant_backfill_295'
  ] LOOP
    PERFORM pg_temp.assert_eq(t || ' exists', (to_regclass(t) IS NOT NULL)::text, 'true');
    PERFORM pg_temp.assert_eq(
      t || ' has RLS on',
      (SELECT relrowsecurity::text FROM pg_class WHERE oid = to_regclass(t)),
      'true'
    );
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        PERFORM pg_temp.assert_eq(
          format('%s %s on %s', role_name, priv, t),
          has_table_privilege(role_name, t, priv)::text,
          'false'
        );
      END LOOP;
    END LOOP;
    PERFORM pg_temp.assert_eq(
      'service_role SELECT on ' || t,
      has_table_privilege('service_role', t, 'SELECT')::text,
      'true'
    );
  END LOOP;
END
$$;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
