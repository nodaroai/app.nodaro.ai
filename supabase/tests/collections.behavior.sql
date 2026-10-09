-- ============================================================================
-- Behavioral proof: collections + collection_records are service-role only and
-- keep the rules the API relies on (migration 462).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000961 upward).
--
-- What matters is #2 / #3: a signed-in user (even the row's OWNER) and an
-- anonymous caller cannot read or write either table through the API roles —
-- refused by privilege, before RLS is consulted. A policy text review cannot
-- prove that; executing as the role can. It also fails if a future migration
-- GRANTs a table back or adds a permissive policy. #4 pins the integrity the
-- backend relies on: one name per person whatever its case, one record per
-- dedupe key and per idempotency key within a collection (a NULL key is no
-- rule), and the cascades.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/collections.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000000961', 'coll-owner@coll.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000962', 'coll-stranger@coll.test', '{}', 'authenticated', 'authenticated');

-- 0. The proof is not vacuous: rows exist to be denied (written as the service
--    role would write them — as postgres here).
INSERT INTO collections (id, user_id, name, description)
VALUES ('00000000-0000-4000-8000-000000000963', '00000000-0000-4000-8000-000000000961', 'News', 'Articles the pipeline wrote');
INSERT INTO collection_records (id, collection_id, user_id, dedupe_key, idempotency_key, title, text, url)
VALUES ('00000000-0000-4000-8000-000000000964', '00000000-0000-4000-8000-000000000963', '00000000-0000-4000-8000-000000000961',
        'https://t.me/telegram/441', 'wf-exec1-node1-0', 'Telegram turns ten', 'The body.', 'https://t.me/telegram/441');
SELECT pg_temp.assert_eq('collections has a row (as postgres)',
  (SELECT count(*)::text FROM collections), '1');
SELECT pg_temp.assert_eq('collection_records has a row (as postgres)',
  (SELECT count(*)::text FROM collection_records), '1');

-- 1. Shape: RLS on, no policies at all, no table privileges for the API roles.
SELECT pg_temp.assert_eq('row level security is enabled on collections',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'collections'), 'true');
SELECT pg_temp.assert_eq('row level security is enabled on collection_records',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'collection_records'), 'true');
SELECT pg_temp.assert_eq('no policy of any kind on either table',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('collections', 'collection_records')), '0');
SELECT pg_temp.assert_eq('authenticated holds no SELECT privilege on collections',
  has_table_privilege('authenticated', 'public.collections', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no INSERT/UPDATE/DELETE privilege on collections',
  (has_table_privilege('authenticated', 'public.collections', 'INSERT')
   OR has_table_privilege('authenticated', 'public.collections', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.collections', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no SELECT privilege on collection_records',
  has_table_privilege('authenticated', 'public.collection_records', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no INSERT/UPDATE/DELETE privilege on collection_records',
  (has_table_privilege('authenticated', 'public.collection_records', 'INSERT')
   OR has_table_privilege('authenticated', 'public.collection_records', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.collection_records', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('anon holds no SELECT privilege on collections',
  has_table_privilege('anon', 'public.collections', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('anon holds no SELECT privilege on collection_records',
  has_table_privilege('anon', 'public.collection_records', 'SELECT')::text, 'false');

-- 2. THE LEAK: the rows' OWNER, signed in, cannot read them through the API
--    role — refused by privilege.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000961","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000961';
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM collections;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT collections as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT collections as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false; n int;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM collection_records;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [the owner cannot SELECT collection_records as authenticated]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  the owner cannot SELECT collection_records as authenticated (privilege denied)';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO collection_records (collection_id, user_id, title)
    VALUES ('00000000-0000-4000-8000-000000000963', '00000000-0000-4000-8000-000000000961', 'forged');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [a signed-in user cannot INSERT collection_records]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a signed-in user cannot INSERT collection_records (privilege denied)';
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
    SELECT count(*) INTO n FROM collections;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'ASSERT FAIL [anon cannot SELECT collections]: the read succeeded (% rows)', n;
  END IF;
  RAISE NOTICE 'ok  anon cannot SELECT collections (privilege denied)';
END $$;
RESET ROLE;

-- 4. Integrity the backend relies on.
-- 4a. One name per person, whatever its case; another person may reuse it.
DO $$
DECLARE dup boolean := false;
BEGIN
  BEGIN
    INSERT INTO collections (user_id, name) VALUES ('00000000-0000-4000-8000-000000000961', 'news');
  EXCEPTION WHEN unique_violation THEN
    dup := true;
  END;
  IF NOT dup THEN
    RAISE EXCEPTION 'ASSERT FAIL [a name is unique per person whatever its case]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  a name is unique per person whatever its case (unique_violation)';
END $$;
INSERT INTO collections (id, user_id, name)
VALUES ('00000000-0000-4000-8000-000000000965', '00000000-0000-4000-8000-000000000962', 'News');
SELECT pg_temp.assert_eq('another person may use the same name',
  (SELECT count(*)::text FROM collections WHERE lower(name) = 'news'), '2');

-- 4b. One record per dedupe key within a collection, by the dedupe index.
DO $$
DECLARE dup boolean := false; msg text;
BEGIN
  BEGIN
    INSERT INTO collection_records (collection_id, user_id, dedupe_key, title)
    VALUES ('00000000-0000-4000-8000-000000000963', '00000000-0000-4000-8000-000000000961', 'https://t.me/telegram/441', 'again');
  EXCEPTION WHEN unique_violation THEN
    dup := true;
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF position('uq_collection_records_dedupe' in msg) = 0 THEN
      RAISE EXCEPTION 'ASSERT FAIL [the dedupe violation names its index]: %', msg;
    END IF;
  END;
  IF NOT dup THEN
    RAISE EXCEPTION 'ASSERT FAIL [one record per dedupe key within a collection]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  one record per dedupe key within a collection (unique_violation names uq_collection_records_dedupe)';
END $$;
-- The same key in ANOTHER collection is a different record.
INSERT INTO collection_records (collection_id, user_id, dedupe_key, title)
VALUES ('00000000-0000-4000-8000-000000000965', '00000000-0000-4000-8000-000000000962', 'https://t.me/telegram/441', 'theirs');
SELECT pg_temp.assert_eq('the same dedupe key in another collection is allowed',
  (SELECT count(*)::text FROM collection_records WHERE dedupe_key = 'https://t.me/telegram/441'), '2');

-- 4c. One record per idempotency key within a collection, by the idempotency index.
DO $$
DECLARE dup boolean := false; msg text;
BEGIN
  BEGIN
    INSERT INTO collection_records (collection_id, user_id, idempotency_key, title)
    VALUES ('00000000-0000-4000-8000-000000000963', '00000000-0000-4000-8000-000000000961', 'wf-exec1-node1-0', 'replay');
  EXCEPTION WHEN unique_violation THEN
    dup := true;
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF position('uq_collection_records_idempotency' in msg) = 0 THEN
      RAISE EXCEPTION 'ASSERT FAIL [the idempotency violation names its index]: %', msg;
    END IF;
  END;
  IF NOT dup THEN
    RAISE EXCEPTION 'ASSERT FAIL [one record per idempotency key within a collection]: the insert succeeded';
  END IF;
  RAISE NOTICE 'ok  one record per idempotency key within a collection (unique_violation names uq_collection_records_idempotency)';
END $$;

-- 4d. A NULL key is no rule: two records with neither key coexist.
INSERT INTO collection_records (collection_id, user_id, title)
VALUES ('00000000-0000-4000-8000-000000000963', '00000000-0000-4000-8000-000000000961', 'no key one'),
       ('00000000-0000-4000-8000-000000000963', '00000000-0000-4000-8000-000000000961', 'no key two');
SELECT pg_temp.assert_eq('records without a key coexist',
  (SELECT count(*)::text FROM collection_records WHERE collection_id = '00000000-0000-4000-8000-000000000963'), '3');

-- 4f. Usage (migration 494): a new record is not used, with an empty "used by";
--     marking it used round-trips, and so does marking it not used again.
SELECT pg_temp.assert_eq('a new record is not used',
  (SELECT (used_at IS NULL)::text FROM collection_records WHERE title = 'no key one'), 'true');
SELECT pg_temp.assert_eq('a new record has an empty used_by',
  (SELECT used_by::text FROM collection_records WHERE title = 'no key one'), '{}');
UPDATE collection_records
  SET used_at = '2026-10-08T17:00:00Z', used_by = '{"via":"node","nodeType":"collection-write","workflowId":"wf-1"}'::jsonb
  WHERE title = 'no key one';
SELECT pg_temp.assert_eq('marking a record used keeps when and by whom',
  (SELECT (used_at = '2026-10-08T17:00:00Z'::timestamptz)::text || ' ' || (used_by->>'workflowId') FROM collection_records WHERE title = 'no key one'),
  'true wf-1');
SELECT pg_temp.assert_eq('the live, "not used yet", "used" and Trash partial indexes exist',
  (SELECT count(*)::text FROM pg_indexes WHERE indexname IN ('idx_collection_records_live', 'idx_collection_records_live_unused', 'idx_collection_records_live_used', 'idx_collection_records_trash')), '4');
SELECT pg_temp.assert_eq('each partial index carries the predicate of its list',
  (SELECT count(*)::text FROM pg_indexes
    WHERE (indexname = 'idx_collection_records_live' AND indexdef LIKE '%WHERE (deleted_at IS NULL)%')
       OR (indexname = 'idx_collection_records_live_unused' AND indexdef LIKE '%deleted_at IS NULL%' AND indexdef LIKE '%used_at IS NULL%')
       OR (indexname = 'idx_collection_records_live_used' AND indexdef LIKE '%deleted_at IS NULL%' AND indexdef LIKE '%used_at IS NOT NULL%')
       OR (indexname = 'idx_collection_records_trash' AND indexdef LIKE '%WHERE (deleted_at IS NOT NULL)%')), '4');
UPDATE collection_records SET used_at = NULL, used_by = '{}'::jsonb WHERE title = 'no key one';
SELECT pg_temp.assert_eq('a record can be marked not used again',
  (SELECT (used_at IS NULL)::text FROM collection_records WHERE title = 'no key one'), 'true');
-- 4g. The Trash (migration 494): a new record is live; a delete stamps deleted_at
--     (the row stays, so the dedupe key still holds); a restore clears it.
SELECT pg_temp.assert_eq('a new record is not in the Trash',
  (SELECT (deleted_at IS NULL)::text FROM collection_records WHERE title = 'no key one'), 'true');
UPDATE collection_records SET deleted_at = '2026-10-08T20:00:00Z' WHERE title = 'no key one';
SELECT pg_temp.assert_eq('a record in the Trash keeps its row and its stamp',
  (SELECT (deleted_at = '2026-10-08T20:00:00Z'::timestamptz)::text FROM collection_records WHERE title = 'no key one'), 'true');
UPDATE collection_records SET deleted_at = NULL WHERE title = 'no key one';
SELECT pg_temp.assert_eq('a record can be restored from the Trash',
  (SELECT (deleted_at IS NULL)::text FROM collection_records WHERE title = 'no key one'), 'true');

-- 4e. Deleting a collection removes its records; deleting the user removes the rest.
DELETE FROM collections WHERE id = '00000000-0000-4000-8000-000000000965';
SELECT pg_temp.assert_eq('deleting a collection cascades to its records',
  (SELECT count(*)::text FROM collection_records WHERE collection_id = '00000000-0000-4000-8000-000000000965'), '0');
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000961';
SELECT pg_temp.assert_eq('deleting the user cascades to their collections',
  (SELECT count(*)::text FROM collections WHERE user_id = '00000000-0000-4000-8000-000000000961'), '0');
SELECT pg_temp.assert_eq('deleting the user cascades to their records',
  (SELECT count(*)::text FROM collection_records WHERE user_id = '00000000-0000-4000-8000-000000000961'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
