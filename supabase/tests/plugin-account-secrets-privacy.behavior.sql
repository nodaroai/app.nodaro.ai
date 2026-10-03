-- ============================================================================
-- Behavioral proof: plugin_account_secrets is service-role only (migration 440).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000044001 upward).
--
-- The assertions that matter are #2 and #3: the API roles cannot read the
-- table at all — a signed-in user (even the row's OWNER) and an anonymous
-- caller are refused by privilege, before RLS is even consulted. A policy text
-- review cannot prove that; only executing as the role can. It also fails if
-- a future migration GRANTs the table back or adds a permissive policy, which
-- is the way this leak would come back. #4 pins the identity the backend
-- upserts on and the cascade.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/plugin-account-secrets-privacy.behavior.sql mig-test:/tmp/t.sql
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

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000044001', 'pas-owner@pas.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000044002', 'pas-stranger@pas.test', '{}', 'authenticated', 'authenticated');

-- 0. The proof is not vacuous: a row exists to be denied (written as the
--    service role would write it — as postgres here).
INSERT INTO plugin_account_secrets (id, plugin, kind, user_id, runtime_env, external_id, label, ciphertext)
VALUES ('00000000-0000-4000-8000-000000044003', 'acme-accounts', 'user', '00000000-0000-4000-8000-000000044001',
        'staging', '777', '@someone', 'ZW52ZWxvcGU=');
SELECT pg_temp.assert_eq('plugin_account_secrets has a row (as postgres)',
  (SELECT count(*)::text FROM plugin_account_secrets), '1');
SELECT pg_temp.assert_eq('a new row starts active with empty metadata',
  (SELECT status || '|' || metadata::text FROM plugin_account_secrets
    WHERE id = '00000000-0000-4000-8000-000000044003'), 'active|{}');

-- 1. Shape: RLS on, no policies at all, no table privileges for the API roles.
SELECT pg_temp.assert_eq('row level security is enabled on plugin_account_secrets',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'plugin_account_secrets'), 'true');
SELECT pg_temp.assert_eq('no policy of any kind on plugin_account_secrets',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='plugin_account_secrets'), '0');
SELECT pg_temp.assert_eq('authenticated holds no SELECT privilege on plugin_account_secrets',
  has_table_privilege('authenticated', 'public.plugin_account_secrets', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no INSERT/UPDATE/DELETE privilege on plugin_account_secrets',
  (has_table_privilege('authenticated', 'public.plugin_account_secrets', 'INSERT')
   OR has_table_privilege('authenticated', 'public.plugin_account_secrets', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.plugin_account_secrets', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('anon holds no privilege of any kind on plugin_account_secrets',
  (has_table_privilege('anon', 'public.plugin_account_secrets', 'SELECT')
   OR has_table_privilege('anon', 'public.plugin_account_secrets', 'INSERT')
   OR has_table_privilege('anon', 'public.plugin_account_secrets', 'UPDATE')
   OR has_table_privilege('anon', 'public.plugin_account_secrets', 'DELETE'))::text, 'false');

-- 2. THE LEAK: the row's OWNER, signed in, cannot read it through the API
--    role — refused by privilege (the envelope never reaches a browser).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000044001","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000044001';
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM plugin_account_secrets;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT plugin_account_secrets as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT plugin_account_secrets as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO plugin_account_secrets (plugin, kind, user_id, runtime_env, external_id, ciphertext)
    VALUES ('acme-accounts', 'user', '00000000-0000-4000-8000-000000044001', 'staging', 'forged', 'eA==');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [a signed-in user cannot INSERT plugin_account_secrets]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a signed-in user cannot INSERT plugin_account_secrets (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    DELETE FROM plugin_account_secrets WHERE id = '00000000-0000-4000-8000-000000044003';
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot DELETE plugin_account_secrets as authenticated]: the delete ran';
  END IF;
  RAISE NOTICE 'ok  the owner cannot DELETE plugin_account_secrets as authenticated (privilege denied)';
END $$;
RESET ROLE;

-- 3. Anonymous is refused the same way. Clear the JWT so this is a true anon
--    read, not the previous user's claims lingering under a different role.
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM plugin_account_secrets;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon cannot SELECT plugin_account_secrets]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  anon cannot SELECT plugin_account_secrets (privilege denied)';
END $$;
RESET ROLE;

-- 4. Integrity the backend relies on.
--    a) One row per (plugin, kind, environment, owner, account): a second
--       connect of the same account collides (the backend upserts on exactly
--       this identity).
DO $$
DECLARE dup boolean := false;
BEGIN
  BEGIN
    INSERT INTO plugin_account_secrets (plugin, kind, user_id, runtime_env, external_id, ciphertext)
    VALUES ('acme-accounts', 'user', '00000000-0000-4000-8000-000000044001', 'staging', '777', 'eA==');
  EXCEPTION WHEN unique_violation THEN
    dup := true;
  END;
  IF NOT dup THEN
    RAISE EXCEPTION 'ASSERT FAIL [the same account twice in one environment is refused]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  the same account twice in one environment is refused (unique_violation)';
END $$;
--    b) The upsert the backend issues resolves against that index.
INSERT INTO plugin_account_secrets (plugin, kind, user_id, runtime_env, external_id, ciphertext, status)
VALUES ('acme-accounts', 'user', '00000000-0000-4000-8000-000000044001', 'staging', '777', 'bmV3', 'active')
ON CONFLICT (plugin, kind, runtime_env, user_id, external_id)
DO UPDATE SET ciphertext = EXCLUDED.ciphertext, status = EXCLUDED.status;
SELECT pg_temp.assert_eq('a reconnect upsert replaces the envelope in place (same id, one row)',
  (SELECT count(*)::text || '|' || min(ciphertext) || '|' || min(id::text) FROM plugin_account_secrets
    WHERE plugin = 'acme-accounts' AND external_id = '777'),
  '1|bmV3|00000000-0000-4000-8000-000000044003');
--    c) The same account in ANOTHER environment is a separate row.
INSERT INTO plugin_account_secrets (plugin, kind, user_id, runtime_env, external_id, ciphertext)
VALUES ('acme-accounts', 'user', '00000000-0000-4000-8000-000000044001', 'production', '777', 'eA==');
SELECT pg_temp.assert_eq('the same account in another environment is its own row',
  (SELECT count(*)::text FROM plugin_account_secrets WHERE external_id = '777'), '2');
--    d) An environment is always named.
DO $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    INSERT INTO plugin_account_secrets (plugin, kind, user_id, external_id, ciphertext)
    VALUES ('acme-accounts', 'user', '00000000-0000-4000-8000-000000044002', '1', 'eA==');
  EXCEPTION WHEN not_null_violation THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'ASSERT FAIL [a row without runtime_env is refused]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a row without runtime_env is refused (not_null_violation)';
END $$;
--    e) Deleting the user removes their accounts.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000044001';
SELECT pg_temp.assert_eq('deleting the user cascades to their stored accounts',
  (SELECT count(*)::text FROM plugin_account_secrets
    WHERE user_id = '00000000-0000-4000-8000-000000044001'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
