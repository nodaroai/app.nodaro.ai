-- ============================================================================
-- Behavioral proof: the bytes' record of a restriction (migration 583).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000961 upward).
--
-- WHY THIS PROOF EXISTS. The record of a restriction is immutable (581) but
-- for its lift; 583 adds the one column the server writes as the bytes move
-- (`bytes`), written by MERGE through `merge_restriction_bytes` so the
-- lift's phase never erases the restriction's. That write must pass, before
-- and after the lift, while every other change is still refused, a value
-- that is not an object is refused, and the browser cannot call the merge.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/restriction-bytes.behavior.sql mig-test:/tmp/t.sql
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

CREATE FUNCTION pg_temp.as_user(who uuid, q text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', who::text, true);
  EXECUTE q INTO out;
  EXECUTE 'RESET ROLE';
  RETURN out;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RAISE;
END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000000961', 'rb-owner@cr.test', '{}', 'authenticated', 'authenticated');
INSERT INTO assets (id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url)
VALUES ('00000000-0000-4000-8000-000000000962', '00000000-0000-4000-8000-000000000961', 'image', 'a.png', 'image/png', 10,
        'uploads/rb-a.png', 'https://cdn.example.test/uploads/rb-a.png');
SELECT restrict_content('00000000-0000-4000-8000-000000000962', NULL, '{uploads/rb-a.png}', NULL, NULL,
                        '00000000-0000-4000-8000-000000000961', 'complaint', NULL, NULL);

-- 1. The record starts with an empty bytes record; the merge writes the restrict phase.
SELECT pg_temp.assert_eq('bytes starts empty', (SELECT bytes::text FROM content_restrictions WHERE asset_id = '00000000-0000-4000-8000-000000000962'), '{}');
SELECT merge_restriction_bytes((SELECT id FROM content_restrictions WHERE asset_id = '00000000-0000-4000-8000-000000000962'),
  '{"restrict": {"keys": {"uploads/rb-a.png": {"state": "moved", "at": "2026-11-02T00:00:00Z"}}, "purge": {"status": "not_configured", "at": "2026-11-02T00:00:00Z"}}}'::jsonb);
SELECT pg_temp.assert_eq('the restrict phase is written',
  (SELECT bytes -> 'restrict' -> 'keys' -> 'uploads/rb-a.png' ->> 'state' FROM content_restrictions WHERE asset_id = '00000000-0000-4000-8000-000000000962'), 'moved');

-- 2. Everything else stays immutable, and a bytes value that is not an object is refused.
SELECT pg_temp.expect_error('the keys cannot change',
  $q$UPDATE content_restrictions SET r2_keys = '{}' WHERE asset_id = '00000000-0000-4000-8000-000000000962'$q$, '55000');
SELECT pg_temp.expect_error('bytes must be an object',
  $q$UPDATE content_restrictions SET bytes = '[]'::jsonb WHERE asset_id = '00000000-0000-4000-8000-000000000962'$q$, '55000');
SELECT pg_temp.expect_error('the merge refuses a patch that is not an object',
  $q$SELECT merge_restriction_bytes((SELECT id FROM content_restrictions WHERE asset_id = '00000000-0000-4000-8000-000000000962'), '"x"'::jsonb)$q$, '22023');
SELECT pg_temp.expect_error('the merge refuses an unknown record',
  $q$SELECT merge_restriction_bytes('00000000-0000-4000-8000-000000000999', '{}'::jsonb)$q$, 'P0002');
SELECT pg_temp.expect_error('the merge is not the browser''s',
  $q$SELECT pg_temp.as_user('00000000-0000-4000-8000-000000000961', 'SELECT (merge_restriction_bytes((SELECT id FROM content_restrictions LIMIT 1), ''{}''::jsonb)).id::text')$q$, '42501');

-- 3. After the lift the lift phase is merged BESIDE the restrict phase, never over it.
SELECT lift_content_restriction((SELECT id FROM content_restrictions WHERE asset_id = '00000000-0000-4000-8000-000000000962'), NULL, 'lifted');
SELECT merge_restriction_bytes((SELECT id FROM content_restrictions WHERE asset_id = '00000000-0000-4000-8000-000000000962'),
  '{"lift": {"keys": {"uploads/rb-a.png": {"state": "restored", "at": "2026-11-02T00:01:00Z"}}, "purge": {"status": "done", "at": "2026-11-02T00:01:00Z"}}}'::jsonb);
SELECT pg_temp.assert_eq('both phases stand',
  (SELECT (bytes -> 'restrict' -> 'keys' -> 'uploads/rb-a.png' ->> 'state') || ',' || (bytes -> 'lift' -> 'keys' -> 'uploads/rb-a.png' ->> 'state')
     FROM content_restrictions WHERE asset_id = '00000000-0000-4000-8000-000000000962'), 'moved,restored');
SELECT pg_temp.expect_error('the reason cannot change after the lift',
  $q$UPDATE content_restrictions SET reason = 'other' WHERE asset_id = '00000000-0000-4000-8000-000000000962'$q$, '55000');
SELECT pg_temp.expect_error('the record cannot be deleted',
  $q$DELETE FROM content_restrictions WHERE asset_id = '00000000-0000-4000-8000-000000000962'$q$, '55000');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
