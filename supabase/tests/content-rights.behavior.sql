-- ============================================================================
-- Behavioral proof: content rights (migration 577).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000000971 upward).
--
-- WHY THIS PROOF EXISTS. A confirmation is a legal record: it must never be
-- edited or deleted, it must outlive the account that made it, and it must
-- open exactly ONE download — the one-use lock is a partial unique index, and
-- a regression there lets one checkbox cover any number of imports.
--
-- Run locally (throwaway container, same image as CI):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/content-rights.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000000971', 'cr-owner@cr.test', '{}', 'authenticated', 'authenticated');

-- 1. The seeded declaration is version 1 and its hash is of its text.
SELECT pg_temp.assert_eq('declaration v1 seeded', (SELECT count(*)::text FROM rights_declarations WHERE version = 1), '1');
SELECT pg_temp.assert_eq('declaration hash is of its text', (SELECT (text_hash = md5(text))::text FROM rights_declarations WHERE version = 1), 'true');

-- 2. A confirmation is written by the server with the declaration it agreed to.
INSERT INTO content_rights_confirmations (id, user_id, declaration_version, declaration_hash, source_url, normalized_url, platform, lane)
VALUES ('00000000-0000-4000-8000-000000000981', '00000000-0000-4000-8000-000000000971', 1, (SELECT text_hash FROM rights_declarations WHERE version = 1),
        'https://www.youtube.com/watch?v=abc&si=1', 'https://youtube.com/watch?v=abc', 'youtube', 'editor');
SELECT pg_temp.assert_eq('confirmation stored', (SELECT count(*)::text FROM content_rights_confirmations WHERE id = '00000000-0000-4000-8000-000000000981'), '1');

-- 3. It is a record: no edit, no delete.
SELECT pg_temp.expect_error('confirmation cannot be edited',
  $q$UPDATE content_rights_confirmations SET normalized_url = 'https://youtube.com/watch?v=zzz' WHERE id = '00000000-0000-4000-8000-000000000981'$q$, '55000');
SELECT pg_temp.expect_error('confirmation cannot be deleted',
  $q$DELETE FROM content_rights_confirmations WHERE id = '00000000-0000-4000-8000-000000000981'$q$, '55000');

-- 3b. A scrub is allowed: the personal data may go to null, nothing else may change.
INSERT INTO content_rights_confirmations (id, user_id, declaration_version, declaration_hash, source_url, normalized_url, ip, email, user_agent, lane)
VALUES ('00000000-0000-4000-8000-000000000982', '00000000-0000-4000-8000-000000000971', 1, (SELECT text_hash FROM rights_declarations WHERE version = 1),
        'https://youtu.be/def', 'https://youtu.be/def', '203.0.113.7', 'cr-owner@cr.test', 'ua', 'editor');
UPDATE content_rights_confirmations SET ip = NULL, email = NULL, user_agent = NULL WHERE id = '00000000-0000-4000-8000-000000000982';
SELECT pg_temp.assert_eq('scrub nulls the personal data', (SELECT (ip IS NULL AND email IS NULL AND user_agent IS NULL)::text FROM content_rights_confirmations WHERE id = '00000000-0000-4000-8000-000000000982'), 'true');
SELECT pg_temp.expect_error('a scrub cannot put another value in',
  $q$UPDATE content_rights_confirmations SET email = 'other@cr.test' WHERE id = '00000000-0000-4000-8000-000000000982'$q$, '55000');
-- (The confirmations table is referenced by a foreign key, so Postgres refuses
-- its TRUNCATE before any trigger runs; the events table shows the trigger.)
SELECT pg_temp.expect_error('the tables cannot be truncated',
  $q$TRUNCATE rights_events$q$, '55000');

-- 4. One download per confirmation: the second consumed event is refused by the index.
INSERT INTO rights_events (confirmation_id, kind, lane) VALUES ('00000000-0000-4000-8000-000000000981', 'confirmed', 'editor');
INSERT INTO rights_events (confirmation_id, kind, lane) VALUES ('00000000-0000-4000-8000-000000000981', 'consumed', 'route');
SELECT pg_temp.expect_error('a confirmation is consumed once',
  $q$INSERT INTO rights_events (confirmation_id, kind, lane) VALUES ('00000000-0000-4000-8000-000000000981', 'consumed', 'run')$q$, '23505');
INSERT INTO rights_events (confirmation_id, kind, download_id) VALUES ('00000000-0000-4000-8000-000000000981', 'download_completed', 'dl-1');
SELECT pg_temp.assert_eq('three events kept', (SELECT count(*)::text FROM rights_events WHERE confirmation_id = '00000000-0000-4000-8000-000000000981'), '3');
SELECT pg_temp.expect_error('an event cannot be edited',
  $q$UPDATE rights_events SET kind = 'download_failed' WHERE confirmation_id = '00000000-0000-4000-8000-000000000981' AND kind = 'download_completed'$q$, '55000');
SELECT pg_temp.expect_error('an event cannot be deleted',
  $q$DELETE FROM rights_events WHERE confirmation_id = '00000000-0000-4000-8000-000000000981'$q$, '55000');
SELECT pg_temp.expect_error('an unknown event kind is refused',
  $q$INSERT INTO rights_events (confirmation_id, kind) VALUES ('00000000-0000-4000-8000-000000000981', 'edited')$q$, '23514');

-- 5. The stored file carries its confirmation and its fingerprint; a bad fingerprint is refused.
INSERT INTO assets (user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, upload_source, rights_confirmation_id, content_hash)
VALUES ('00000000-0000-4000-8000-000000000971', 'video', 'yt-1.mp4', 'video/mp4', 16, 'videos/yt-1.mp4', 'https://cdn.test/videos/yt-1.mp4', 'social_download',
        '00000000-0000-4000-8000-000000000981', repeat('ab', 32));
SELECT pg_temp.assert_eq('asset carries the confirmation', (SELECT rights_confirmation_id::text FROM assets WHERE r2_key = 'videos/yt-1.mp4'), '00000000-0000-4000-8000-000000000981');
SELECT pg_temp.expect_error('a fingerprint must be a sha256',
  $q$UPDATE assets SET content_hash = 'nope' WHERE r2_key = 'videos/yt-1.mp4'$q$, '23514');

-- 6. The record outlives the account: deleting the user nulls the owner and keeps the row.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000971';
SELECT pg_temp.assert_eq('confirmation survives the account', (SELECT count(*)::text FROM content_rights_confirmations WHERE id = '00000000-0000-4000-8000-000000000981'), '1');
SELECT pg_temp.assert_eq('owner is null after deletion', (SELECT (user_id IS NULL)::text FROM content_rights_confirmations WHERE id = '00000000-0000-4000-8000-000000000981'), 'true');
SELECT pg_temp.assert_eq('its events survive too', (SELECT count(*)::text FROM rights_events WHERE confirmation_id = '00000000-0000-4000-8000-000000000981'), '3');

-- 7. Nobody but the server reads or writes these tables.
SELECT pg_temp.assert_eq('confirmations revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'content_rights_confirmations' AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('events revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'rights_events' AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('declarations revoked from anon/authenticated',
  (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'rights_declarations' AND grantee IN ('anon', 'authenticated')), '0');
SELECT pg_temp.assert_eq('rls on', (SELECT string_agg(relname || '=' || relrowsecurity::text, ',' ORDER BY relname) FROM pg_class WHERE relname IN ('content_rights_confirmations', 'rights_events', 'rights_declarations')),
  'content_rights_confirmations=true,rights_declarations=true,rights_events=true');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
