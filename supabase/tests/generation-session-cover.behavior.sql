-- ============================================================================
-- Behavioral proof: a generation session's cover (migration 532).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000053201 upward).
--
-- What it pins:
--   1. The tables stay service-role only (532 adds a column, no grant).
--   2. A cover must be one of the session's items: a job of another session,
--      and a stranger's job, are refused (42501).
--   3. The cover goes back to automatic (NULL) when its item leaves the
--      session — a removed link, or the job deleted — and nothing else moves.
--   4. Deleting the session, or the owner, is not tripped by the cover trigger.
--
-- Run locally: see the header of collections.behavior.sql (same steps).
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

-- Runs `stmt` and passes only if it is refused with SQLSTATE 42501.
CREATE FUNCTION pg_temp.assert_refused(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE refused boolean := false;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'ASSERT FAIL [%]: the statement succeeded', label;
  END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- A = owner, B = stranger.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-000000053201', 'cover-owner@cover.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000053202', 'cover-stranger@cover.test', '{}', 'authenticated', 'authenticated');

-- Two sessions of A. S1 holds J1 (born there) and J2 (imported); S2 holds J3.
INSERT INTO generation_sessions (id, user_id, tool) VALUES
  ('00000000-0000-4000-8000-000000053211', '00000000-0000-4000-8000-000000053201', 'create-image'),
  ('00000000-0000-4000-8000-000000053212', '00000000-0000-4000-8000-000000053201', 'create-image');
INSERT INTO jobs (id, user_id, status, session_id) VALUES
  ('00000000-0000-4000-8000-000000053221', '00000000-0000-4000-8000-000000053201', 'completed', '00000000-0000-4000-8000-000000053211'),
  ('00000000-0000-4000-8000-000000053223', '00000000-0000-4000-8000-000000053201', 'completed', '00000000-0000-4000-8000-000000053212');
INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000053222', '00000000-0000-4000-8000-000000053201', 'completed'),
  ('00000000-0000-4000-8000-000000053224', '00000000-0000-4000-8000-000000053202', 'completed');
INSERT INTO session_items (session_id, user_id, job_id, kind) VALUES
  ('00000000-0000-4000-8000-000000053211', '00000000-0000-4000-8000-000000053201', '00000000-0000-4000-8000-000000053222', 'imported');

-- 1. Shape.
SELECT pg_temp.assert_eq('the cover column exists and is nullable',
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'generation_sessions' AND column_name = 'cover_job_id'), 'YES');
SELECT pg_temp.assert_eq('authenticated still holds no privilege on generation_sessions',
  (has_table_privilege('authenticated', 'public.generation_sessions', 'SELECT')
   OR has_table_privilege('authenticated', 'public.generation_sessions', 'UPDATE'))::text, 'false');
SELECT pg_temp.assert_eq('anon still holds no privilege on generation_sessions',
  has_table_privilege('anon', 'public.generation_sessions', 'SELECT')::text, 'false');
SELECT pg_temp.assert_eq('no policy was added',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'generation_sessions'), '0');

-- 2. A cover must be one of the session's items.
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053221'
 WHERE id = '00000000-0000-4000-8000-000000053211';
SELECT pg_temp.assert_eq('a born-in item can be the cover',
  (SELECT cover_job_id::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000053211'),
  '00000000-0000-4000-8000-000000053221');
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053222'
 WHERE id = '00000000-0000-4000-8000-000000053211';
SELECT pg_temp.assert_eq('an imported item can be the cover',
  (SELECT cover_job_id::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000053211'),
  '00000000-0000-4000-8000-000000053222');
SELECT pg_temp.assert_refused('the owner''s job in ANOTHER session cannot be the cover',
  $s$UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053223'
     WHERE id = '00000000-0000-4000-8000-000000053211'$s$);
SELECT pg_temp.assert_refused('a stranger''s job cannot be the cover',
  $s$UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053224'
     WHERE id = '00000000-0000-4000-8000-000000053211'$s$);
SELECT pg_temp.assert_refused('a session cannot be created with a cover that is not its item',
  $s$INSERT INTO generation_sessions (user_id, tool, cover_job_id)
     VALUES ('00000000-0000-4000-8000-000000053201', 'create-image', '00000000-0000-4000-8000-000000053222')$s$);
UPDATE generation_sessions SET cover_job_id = NULL WHERE id = '00000000-0000-4000-8000-000000053211';
SELECT pg_temp.assert_eq('null goes back to automatic',
  (SELECT (cover_job_id IS NULL)::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000053211'), 'true');

-- 3a. Removing the cover's item from the session clears the cover; the job stays.
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053222'
 WHERE id = '00000000-0000-4000-8000-000000053211';
DELETE FROM session_items
 WHERE session_id = '00000000-0000-4000-8000-000000053211' AND job_id = '00000000-0000-4000-8000-000000053222';
SELECT pg_temp.assert_eq('removing the cover''s item clears the cover',
  (SELECT (cover_job_id IS NULL)::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000053211'), 'true');
SELECT pg_temp.assert_eq('the job itself stays',
  (SELECT count(*)::text FROM jobs WHERE id = '00000000-0000-4000-8000-000000053222'), '1');

-- 3b. Removing ANOTHER item leaves the cover alone.
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053221'
 WHERE id = '00000000-0000-4000-8000-000000053211';
INSERT INTO session_items (session_id, user_id, job_id, kind) VALUES
  ('00000000-0000-4000-8000-000000053211', '00000000-0000-4000-8000-000000053201', '00000000-0000-4000-8000-000000053222', 'imported');
DELETE FROM session_items
 WHERE session_id = '00000000-0000-4000-8000-000000053211' AND job_id = '00000000-0000-4000-8000-000000053222';
SELECT pg_temp.assert_eq('removing another item keeps the cover',
  (SELECT cover_job_id::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000053211'),
  '00000000-0000-4000-8000-000000053221');

-- 3c. Deleting the cover's job clears the cover.
DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000053221';
SELECT pg_temp.assert_eq('deleting the cover''s job clears the cover',
  (SELECT (cover_job_id IS NULL)::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000053211'), 'true');

-- 4. Deleting a covered session, then the owner with a covered session, succeeds.
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053223'
 WHERE id = '00000000-0000-4000-8000-000000053212';
DELETE FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000053212';
SELECT pg_temp.assert_eq('a covered session can be deleted',
  (SELECT count(*)::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000053212'), '0');
INSERT INTO session_items (session_id, user_id, job_id, kind) VALUES
  ('00000000-0000-4000-8000-000000053211', '00000000-0000-4000-8000-000000053201', '00000000-0000-4000-8000-000000053222', 'imported');
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053222'
 WHERE id = '00000000-0000-4000-8000-000000053211';
-- A second session that imported the same job from the first and also uses it
-- as its cover: the owner delete takes both sessions, the job and all the
-- links in ONE statement, in whatever order the cascades run (518 section 4f).
INSERT INTO generation_sessions (id, user_id, tool) VALUES
  ('00000000-0000-4000-8000-000000053213', '00000000-0000-4000-8000-000000053201', 'create-image');
INSERT INTO session_items (session_id, user_id, job_id, kind, imported_from_session_id) VALUES
  ('00000000-0000-4000-8000-000000053213', '00000000-0000-4000-8000-000000053201',
   '00000000-0000-4000-8000-000000053222', 'imported', '00000000-0000-4000-8000-000000053211');
UPDATE generation_sessions SET cover_job_id = '00000000-0000-4000-8000-000000053222'
 WHERE id = '00000000-0000-4000-8000-000000053213';
SELECT pg_temp.assert_eq('two sessions can share a cover item',
  (SELECT count(*)::text FROM generation_sessions WHERE cover_job_id = '00000000-0000-4000-8000-000000053222'), '2');
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000053201';
SELECT pg_temp.assert_eq('deleting the owner removes their covered sessions',
  (SELECT count(*)::text FROM generation_sessions WHERE user_id = '00000000-0000-4000-8000-000000053201'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
