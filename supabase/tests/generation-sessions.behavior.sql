-- ============================================================================
-- Behavioral proof: generation sessions (migration 518).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000051801 upward).
--
-- What it pins:
--   1. Both tables are service-role only (RLS on, no policies, no grants), and
--      the preview function is not callable by the API roles.
--   2. Owner-only in the DATABASE, not just the API: a session's project, a
--      job born in a session, and an imported item must all be the session
--      owner's — whatever a route forgets.
--   3. A session's owner/project are fixed; jobs.session_id is immutable.
--   4. The born-in link is written with the job; deleting a job removes it
--      from every session; deleting a session keeps its jobs; removing a link
--      touches nothing else.
--   5. The preview function counts every item and previews completed ones.
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
  ('00000000-0000-4000-8000-000000051801', 'gs-owner@gs.test',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000051802', 'gs-stranger@gs.test', '{}', 'authenticated', 'authenticated');

INSERT INTO projects (id, user_id, name) VALUES
  ('00000000-0000-4000-8000-000000051811', '00000000-0000-4000-8000-000000051801', 'Summer 2026'),
  ('00000000-0000-4000-8000-000000051812', '00000000-0000-4000-8000-000000051802', 'Stranger project');

-- 1. Shape.
SELECT pg_temp.assert_eq('row level security is enabled on generation_sessions',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'generation_sessions'), 'true');
SELECT pg_temp.assert_eq('row level security is enabled on session_items',
  (SELECT relrowsecurity::text FROM pg_class WHERE relname = 'session_items'), 'true');
SELECT pg_temp.assert_eq('no policy of any kind on either table',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('generation_sessions', 'session_items')), '0');
SELECT pg_temp.assert_eq('authenticated holds no privilege on generation_sessions',
  (has_table_privilege('authenticated', 'public.generation_sessions', 'SELECT')
   OR has_table_privilege('authenticated', 'public.generation_sessions', 'INSERT')
   OR has_table_privilege('authenticated', 'public.generation_sessions', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.generation_sessions', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('authenticated holds no privilege on session_items',
  (has_table_privilege('authenticated', 'public.session_items', 'SELECT')
   OR has_table_privilege('authenticated', 'public.session_items', 'INSERT')
   OR has_table_privilege('authenticated', 'public.session_items', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.session_items', 'DELETE'))::text, 'false');
SELECT pg_temp.assert_eq('anon holds no SELECT on either table',
  (has_table_privilege('anon', 'public.generation_sessions', 'SELECT')
   OR has_table_privilege('anon', 'public.session_items', 'SELECT'))::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot run the preview function',
  has_function_privilege('authenticated', 'public.generation_session_previews(uuid[])', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot run the preview function',
  has_function_privilege('anon', 'public.generation_session_previews(uuid[])', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('the browser grant on jobs does not include session_id',
  has_column_privilege('authenticated', 'public.jobs', 'session_id', 'SELECT')::text, 'false');

-- 2a. A session's project must be the session owner's; the workspace is copied.
INSERT INTO generation_sessions (id, user_id, project_id, title, tool) VALUES
  ('00000000-0000-4000-8000-000000051821', '00000000-0000-4000-8000-000000051801',
   '00000000-0000-4000-8000-000000051811', 'Beach', 'create-image'),
  ('00000000-0000-4000-8000-000000051822', '00000000-0000-4000-8000-000000051801',
   NULL, NULL, 'create-image');
SELECT pg_temp.assert_refused('a session cannot sit in a stranger''s project',
  $s$INSERT INTO generation_sessions (user_id, project_id, tool)
     VALUES ('00000000-0000-4000-8000-000000051801', '00000000-0000-4000-8000-000000051812', 'create-image')$s$);

-- 3a. Owner and project are fixed at creation; the title is not.
SELECT pg_temp.assert_refused('a session cannot move to another project',
  $s$UPDATE generation_sessions SET project_id = '00000000-0000-4000-8000-000000051812'
     WHERE id = '00000000-0000-4000-8000-000000051821'$s$);
SELECT pg_temp.assert_refused('a session cannot change owner',
  $s$UPDATE generation_sessions SET user_id = '00000000-0000-4000-8000-000000051802'
     WHERE id = '00000000-0000-4000-8000-000000051821'$s$);
UPDATE generation_sessions SET title = 'Beach day' WHERE id = '00000000-0000-4000-8000-000000051821';
SELECT pg_temp.assert_eq('a session can be renamed',
  (SELECT title FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000051821'), 'Beach day');

-- 4a. A job born in a session gets its link in the same statement.
INSERT INTO jobs (id, user_id, status, session_id, output_data) VALUES
  ('00000000-0000-4000-8000-000000051831', '00000000-0000-4000-8000-000000051801', 'completed',
   '00000000-0000-4000-8000-000000051821', '{"imageUrl":"https://cdn.test/a.png"}'),
  ('00000000-0000-4000-8000-000000051832', '00000000-0000-4000-8000-000000051801', 'processing',
   '00000000-0000-4000-8000-000000051821', NULL);
INSERT INTO jobs (id, user_id, status) VALUES
  ('00000000-0000-4000-8000-000000051833', '00000000-0000-4000-8000-000000051801', 'completed'),
  ('00000000-0000-4000-8000-000000051834', '00000000-0000-4000-8000-000000051802', 'completed');
SELECT pg_temp.assert_eq('a born-in job is linked as native, owned by the job owner',
  (SELECT string_agg(kind || ':' || (user_id = '00000000-0000-4000-8000-000000051801')::text, ',' ORDER BY job_id)
     FROM session_items WHERE session_id = '00000000-0000-4000-8000-000000051821'),
  'native:true,native:true');
SELECT pg_temp.assert_eq('the native link is dated with the job',
  (SELECT (i.added_at = j.created_at)::text FROM session_items i JOIN jobs j ON j.id = i.job_id
    WHERE i.job_id = '00000000-0000-4000-8000-000000051831'), 'true');

-- 2b. A job cannot be born in someone else's session (the job insert fails).
SELECT pg_temp.assert_refused('a stranger''s job cannot be born in the owner''s session',
  $s$INSERT INTO jobs (user_id, status, session_id)
     VALUES ('00000000-0000-4000-8000-000000051802', 'pending', '00000000-0000-4000-8000-000000051821')$s$);

-- 3b. "Born in" is immutable.
SELECT pg_temp.assert_refused('jobs.session_id cannot be re-pointed',
  $s$UPDATE jobs SET session_id = '00000000-0000-4000-8000-000000051822'
     WHERE id = '00000000-0000-4000-8000-000000051831'$s$);
SELECT pg_temp.assert_refused('jobs.session_id cannot be set after insert',
  $s$UPDATE jobs SET session_id = '00000000-0000-4000-8000-000000051822'
     WHERE id = '00000000-0000-4000-8000-000000051833'$s$);

-- 2c. Imports: the owner's own job only, with the owner's user_id.
INSERT INTO session_items (session_id, user_id, job_id, kind, imported_from_session_id) VALUES
  ('00000000-0000-4000-8000-000000051822', '00000000-0000-4000-8000-000000051801',
   '00000000-0000-4000-8000-000000051831', 'imported', '00000000-0000-4000-8000-000000051821'),
  ('00000000-0000-4000-8000-000000051822', '00000000-0000-4000-8000-000000051801',
   '00000000-0000-4000-8000-000000051833', 'imported', NULL);
SELECT pg_temp.assert_refused('a stranger''s job cannot be imported',
  $s$INSERT INTO session_items (session_id, user_id, job_id, kind)
     VALUES ('00000000-0000-4000-8000-000000051822', '00000000-0000-4000-8000-000000051801',
             '00000000-0000-4000-8000-000000051834', 'imported')$s$);
SELECT pg_temp.assert_refused('an item cannot claim another owner',
  $s$INSERT INTO session_items (session_id, user_id, job_id, kind)
     VALUES ('00000000-0000-4000-8000-000000051821', '00000000-0000-4000-8000-000000051802',
             '00000000-0000-4000-8000-000000051833', 'imported')$s$);

-- 5. Previews: every item counted, completed ones previewed, newest first.
SELECT pg_temp.assert_eq('the preview counts every item of each session',
  (SELECT string_agg(item_count::text, ',' ORDER BY session_id)
     FROM generation_session_previews(ARRAY['00000000-0000-4000-8000-000000051821',
                                             '00000000-0000-4000-8000-000000051822']::uuid[])), '2,2');
SELECT pg_temp.assert_eq('only completed items are previewed',
  (SELECT jsonb_array_length(recent)::text
     FROM generation_session_previews(ARRAY['00000000-0000-4000-8000-000000051821']::uuid[])), '1');

-- 4b. Removing a link touches nothing else.
DELETE FROM session_items
 WHERE session_id = '00000000-0000-4000-8000-000000051821' AND job_id = '00000000-0000-4000-8000-000000051831';
SELECT pg_temp.assert_eq('removing a link keeps the job',
  (SELECT count(*)::text FROM jobs WHERE id = '00000000-0000-4000-8000-000000051831'), '1');
SELECT pg_temp.assert_eq('removing a link keeps the job in the other session',
  (SELECT count(*)::text FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000051822' AND job_id = '00000000-0000-4000-8000-000000051831'), '1');

-- 4c. Deleting a session keeps its jobs, clears their "born in", and blanks
--     "imported from" elsewhere.
DELETE FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000051821';
SELECT pg_temp.assert_eq('deleting a session keeps the jobs born in it',
  (SELECT count(*)::text FROM jobs
    WHERE id IN ('00000000-0000-4000-8000-000000051831', '00000000-0000-4000-8000-000000051832')), '2');
SELECT pg_temp.assert_eq('their born-in session becomes null',
  (SELECT count(*)::text FROM jobs
    WHERE id IN ('00000000-0000-4000-8000-000000051831', '00000000-0000-4000-8000-000000051832')
      AND session_id IS NULL), '2');
SELECT pg_temp.assert_eq('its links are gone',
  (SELECT count(*)::text FROM session_items WHERE session_id = '00000000-0000-4000-8000-000000051821'), '0');
SELECT pg_temp.assert_eq('an import from it elsewhere stays, with no source',
  (SELECT (imported_from_session_id IS NULL)::text FROM session_items
    WHERE session_id = '00000000-0000-4000-8000-000000051822' AND job_id = '00000000-0000-4000-8000-000000051831'), 'true');

-- 4d. Deleting a job removes it from every session.
DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000051831';
SELECT pg_temp.assert_eq('deleting a job removes it from every session',
  (SELECT count(*)::text FROM session_items WHERE job_id = '00000000-0000-4000-8000-000000051831'), '0');

-- 4e. Deleting the project leaves its sessions, project-less.
INSERT INTO generation_sessions (id, user_id, project_id, tool) VALUES
  ('00000000-0000-4000-8000-000000051823', '00000000-0000-4000-8000-000000051801',
   '00000000-0000-4000-8000-000000051811', 'create-image');
DELETE FROM projects WHERE id = '00000000-0000-4000-8000-000000051811';
SELECT pg_temp.assert_eq('deleting a project keeps its sessions without a project',
  (SELECT (project_id IS NULL)::text FROM generation_sessions WHERE id = '00000000-0000-4000-8000-000000051823'), 'true');

-- 4f. Several sessions of one owner deleted in ONE statement, one importing
--     from another: the FK's SET NULL must not trip the item guard.
INSERT INTO generation_sessions (id, user_id, tool) VALUES
  ('00000000-0000-4000-8000-000000051824', '00000000-0000-4000-8000-000000051801', 'create-image');
INSERT INTO session_items (session_id, user_id, job_id, kind, imported_from_session_id) VALUES
  ('00000000-0000-4000-8000-000000051824', '00000000-0000-4000-8000-000000051801',
   '00000000-0000-4000-8000-000000051833', 'imported', '00000000-0000-4000-8000-000000051822');
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000051801';
SELECT pg_temp.assert_eq('deleting the owner removes all their sessions in one statement',
  (SELECT count(*)::text FROM generation_sessions WHERE user_id = '00000000-0000-4000-8000-000000051801'), '0');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
