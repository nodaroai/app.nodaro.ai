-- ============================================================================
-- Behavioral proof: import source policies (migration 578).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000001201 upward).
--
-- WHY THIS PROOF EXISTS. An admin's save replaces the list whole through ONE
-- function: a regression that split it into an upsert and a delete again would
-- leave a half-saved list when the second statement failed, and a save made
-- against a list that moved since it was loaded would silently overwrite the
-- other admin's rows. The CHECKs are what keeps a malformed domain out.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/import-source-policies.behavior.sql mig-test:/tmp/t.sql
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

-- Runs a statement that must fail, and answers the SQLSTATE it failed with.
CREATE FUNCTION pg_temp.expect_error(label text, stmt text, want_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> want_state THEN
      RAISE EXCEPTION 'ASSERT FAIL [%]: failed with % (%) expected %', label, SQLSTATE, SQLERRM, want_state;
    END IF;
    RAISE NOTICE 'ok  %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERT FAIL [%]: did not fail', label;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000001201', 'isp-admin-a@isp.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000001202', 'isp-admin-b@isp.test', '{}', 'authenticated', 'authenticated');

-- 1. Empty list: version 0:0, and a first save against it lands.
SELECT pg_temp.assert_eq('empty list version', import_source_policies_version(), '0:0');
SELECT replace_import_source_policies(
  '[{"domain":"blocked.test","status":"disabled","note":"  legal  "},{"domain":"fine.test","status":"restricted","note":""}]'::jsonb,
  '00000000-0000-4000-8000-000000001201', '0:0');
SELECT pg_temp.assert_eq('two rows saved', (SELECT count(*)::text FROM import_source_policies), '2');
SELECT pg_temp.assert_eq('note trimmed', (SELECT note FROM import_source_policies WHERE domain = 'blocked.test'), 'legal');
SELECT pg_temp.assert_eq('empty note is null', (SELECT (note IS NULL)::text FROM import_source_policies WHERE domain = 'fine.test'), 'true');
SELECT pg_temp.assert_eq('set by admin a', (SELECT updated_by::text FROM import_source_policies WHERE domain = 'blocked.test'), '00000000-0000-4000-8000-000000001201');

-- 2. The version follows the rows: count and the newest change.
SELECT pg_temp.assert_eq('version after save',
  import_source_policies_version(),
  '2:' || floor(extract(epoch FROM (SELECT max(updated_at) FROM import_source_policies)) * 1000)::bigint::text);

-- 3. A save against the version loaded before: refused whole, nothing changed.
SELECT pg_temp.expect_error('stale save refused',
  $q$SELECT replace_import_source_policies('[{"domain":"other.test","status":"disabled"}]'::jsonb, '00000000-0000-4000-8000-000000001202', '0:0')$q$,
  '40001');
SELECT pg_temp.assert_eq('stale save changed nothing', (SELECT string_agg(domain, ',' ORDER BY domain) FROM import_source_policies), 'blocked.test,fine.test');

-- 4. A save with one bad row lands nothing (one transaction): the CHECK refuses it.
SELECT pg_temp.expect_error('bad domain refuses the whole save',
  $q$SELECT replace_import_source_policies('[{"domain":"ok.test","status":"disabled"},{"domain":"www.bad.test","status":"disabled"}]'::jsonb, '00000000-0000-4000-8000-000000001202', import_source_policies_version())$q$,
  '23514');
SELECT pg_temp.assert_eq('bad save changed nothing', (SELECT string_agg(domain, ',' ORDER BY domain) FROM import_source_policies), 'blocked.test,fine.test');
SELECT pg_temp.expect_error('bad status refused',
  $q$SELECT replace_import_source_policies('[{"domain":"ok.test","status":"banned"}]'::jsonb, '00000000-0000-4000-8000-000000001202', import_source_policies_version())$q$,
  '23514');
SELECT pg_temp.expect_error('punycode is a domain, a leading dot is not',
  $q$INSERT INTO import_source_policies (domain, status) VALUES ('.example.com', 'disabled')$q$, '23514');

-- 5. A fresh save by admin b: the unchanged row keeps admin a, the changed row
--    is b's, the row not named is gone, a new one is added. (One transaction
--    here, so `now()` never moves between saves; the time itself is not asserted.)
SELECT replace_import_source_policies(
  '[{"domain":"blocked.test","status":"disabled","note":"legal"},{"domain":"fine.test","status":"approved"},{"domain":"xn--80ak6aa92e.xn--p1ai","status":"pending_legal_review"}]'::jsonb,
  '00000000-0000-4000-8000-000000001202', import_source_policies_version());
SELECT pg_temp.assert_eq('rows after second save', (SELECT string_agg(domain || '=' || status, ',' ORDER BY domain) FROM import_source_policies),
  'blocked.test=disabled,fine.test=approved,xn--80ak6aa92e.xn--p1ai=pending_legal_review');
SELECT pg_temp.assert_eq('unchanged row keeps admin a', (SELECT updated_by::text FROM import_source_policies WHERE domain = 'blocked.test'), '00000000-0000-4000-8000-000000001201');
SELECT pg_temp.assert_eq('changed row is admin b', (SELECT updated_by::text FROM import_source_policies WHERE domain = 'fine.test'), '00000000-0000-4000-8000-000000001202');
SELECT pg_temp.assert_eq('new row is admin b', (SELECT updated_by::text FROM import_source_policies WHERE domain = 'xn--80ak6aa92e.xn--p1ai'), '00000000-0000-4000-8000-000000001202');

-- 6. An empty save clears the list.
SELECT replace_import_source_policies('[]'::jsonb, '00000000-0000-4000-8000-000000001202', import_source_policies_version());
SELECT pg_temp.assert_eq('list cleared', import_source_policies_version(), '0:0');

-- 7. Only the service role reaches the table and the functions.
SELECT pg_temp.assert_eq('rls on', (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.import_source_policies'::regclass), 'true');
SELECT pg_temp.assert_eq('authenticated cannot read', has_table_privilege('authenticated', 'public.import_source_policies', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot read', has_table_privilege('anon', 'public.import_source_policies', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot save', has_function_privilege('authenticated', 'public.replace_import_source_policies(jsonb, uuid, text)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot save', has_function_privilege('anon', 'public.replace_import_source_policies(jsonb, uuid, text)', 'EXECUTE')::text, 'false');
-- The backend (service role) is what reads and saves: a missing grant here is a 500 on every admin save.
SELECT pg_temp.assert_eq('service_role reads', has_table_privilege('service_role', 'public.import_source_policies', 'SELECT')::text, 'true');
SELECT pg_temp.assert_eq('service_role saves', has_function_privilege('service_role', 'public.replace_import_source_policies(jsonb, uuid, text)', 'EXECUTE')::text, 'true');
SELECT pg_temp.assert_eq('service_role reads the version', has_function_privilege('service_role', 'public.import_source_policies_version()', 'EXECUTE')::text, 'true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
