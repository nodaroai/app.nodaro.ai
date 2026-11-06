-- ============================================================================
-- Behavioral proof: every write to app_settings moves app_settings_version
-- (migration 605).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back.
--
-- WHY THIS PROOF EXISTS. Each backend process keeps the app settings in
-- memory and reads them again only when this version moved
-- (backend/src/lib/app-settings-version.ts). A kind of write that does not
-- move it would leave every other process on the old settings until their
-- 60 s TTL: the delay this version exists to remove. So each kind of write is
-- asserted here, as the writers use them (upsert, update, delete, truncate),
-- and so is the version row's own protection. A later migration that drops
-- or narrows the trigger fails here.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/app-settings-version.behavior.sql mig-test:/tmp/t.sql
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

CREATE FUNCTION pg_temp.version() RETURNS bigint
LANGUAGE sql AS $$ SELECT version FROM public.app_settings_version WHERE id = 1 $$;

CREATE TEMP TABLE seen (label text PRIMARY KEY, v bigint);
CREATE FUNCTION pg_temp.moved(label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE before bigint := (SELECT max(v) FROM seen);
BEGIN
  INSERT INTO seen VALUES (label, pg_temp.version());
  PERFORM pg_temp.assert_eq(label || ' moves the version',
    (pg_temp.version() > before)::text, 'true');
END $$;

-- 0. Not vacuous: the row is there, and exactly one.
SELECT pg_temp.assert_eq('the version row exists',
  (SELECT count(*)::text FROM public.app_settings_version), '1');
INSERT INTO seen VALUES ('start', pg_temp.version());

-- 1. Every write the backend makes, in the shapes it uses.
INSERT INTO app_settings (key, value) VALUES ('asv_probe_key', '{"faceMesh":false}'::jsonb);
SELECT pg_temp.moved('an INSERT');

INSERT INTO app_settings (key, value) VALUES ('asv_probe_key', '{"faceMesh":true}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SELECT pg_temp.moved('an upsert that updates');

UPDATE app_settings SET value = '{"faceMesh":true,"faceMeshParts":"contours"}'::jsonb WHERE key = 'asv_probe_key';
SELECT pg_temp.moved('an UPDATE');

-- An optimistic-concurrency write that lost (matched nothing): harmless.
UPDATE app_settings SET value = '1'::jsonb WHERE key = 'asv_probe_key' AND updated_at = '1970-01-01';
SELECT pg_temp.moved('an UPDATE that matched no row');

DELETE FROM app_settings WHERE key = 'asv_probe_key';
SELECT pg_temp.moved('a DELETE');

-- 2. Two statements in one transaction move it twice (per statement).
INSERT INTO seen VALUES ('before two', pg_temp.version());
INSERT INTO app_settings (key, value) VALUES ('asv_probe_a', '1'::jsonb);
INSERT INTO app_settings (key, value) VALUES ('asv_probe_b', '2'::jsonb);
SELECT pg_temp.assert_eq('two statements move it by two',
  (pg_temp.version() - (SELECT v FROM seen WHERE label = 'before two'))::text, '2');

-- 3. A deleted version row comes back on the next write (the bump is an upsert).
DELETE FROM public.app_settings_version;
UPDATE app_settings SET value = '3'::jsonb WHERE key = 'asv_probe_a';
SELECT pg_temp.assert_eq('a deleted version row is recreated by the next write',
  (SELECT count(*)::text FROM public.app_settings_version), '1');
-- Reset the baseline: the recreated row restarts its count.
DELETE FROM seen;
INSERT INTO seen VALUES ('recreated', pg_temp.version());

-- 4. A write by a role that cannot touch the version row still moves it
--    (SECURITY DEFINER). `authenticated` cannot write app_settings rows (363),
--    so its UPDATE matches nothing, yet the statement fires the trigger and
--    must not fail on the version table's privileges.
SET LOCAL ROLE authenticated;
UPDATE app_settings SET value = '4'::jsonb WHERE key = 'asv_probe_a';
RESET ROLE;
SELECT pg_temp.moved('a statement run as authenticated');
SELECT pg_temp.assert_eq('the authenticated UPDATE changed nothing',
  (SELECT value::text FROM app_settings WHERE key = 'asv_probe_a'), '3');

-- 5. The version row is the service role's to read, nobody else's.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM version FROM public.app_settings_version;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated read app_settings_version';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot read the version';
END $$;
DO $$ BEGIN
  UPDATE public.app_settings_version SET version = 0;
  RAISE EXCEPTION 'ASSERT FAIL: authenticated wrote app_settings_version';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  authenticated cannot write the version';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM version FROM public.app_settings_version;
  RAISE EXCEPTION 'ASSERT FAIL: anon read app_settings_version';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  anon cannot read the version';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('the service role reads the version',
  (SELECT (count(*) = 1)::text FROM public.app_settings_version), 'true');
RESET ROLE;

-- 6. TRUNCATE moves it too (last: it empties the table, rolled back below).
SELECT pg_temp.assert_eq('the trigger covers INSERT, UPDATE, DELETE and TRUNCATE, per statement',
  (SELECT string_agg(event_manipulation, ',' ORDER BY event_manipulation)
     FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'app_settings'
      AND trigger_name = 'app_settings_bump_version' AND action_orientation = 'STATEMENT'),
  'DELETE,INSERT,UPDATE');
TRUNCATE app_settings;
SELECT pg_temp.moved('a TRUNCATE');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;

ROLLBACK;
