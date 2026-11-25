-- ============================================================================
-- Behavioral proof: a delete for good answers the stored bytes of the jobs it
-- takes (migration 708).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000070501 upward).
--
-- WHY THIS PROOF EXISTS. A job's record of the files its video store kept
-- (`jobs.server_output.stored`, migration 695) is what every delete of such a
-- file gives back from. Deleting the job destroys that record, so the delete
-- itself must answer the bytes, per owner, in the same transaction, and answer
-- nothing when the database refuses the delete. Each assertion below is a
-- charge left for good, or a refund for a delete that did not happen, if it
-- regresses.
--
-- Run locally (throwaway container; CI runs the image named below):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/job-delete-stored-bytes.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000070501', 'delete-owner@jd.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000070502', 'delete-member@jd.test', '{}', 'authenticated', 'authenticated');

INSERT INTO projects (id, user_id, name) VALUES
  ('00000000-0000-4000-8000-0000000705f1', '00000000-0000-4000-8000-000000070501', 'p'),
  ('00000000-0000-4000-8000-0000000705f2', '00000000-0000-4000-8000-000000070501', 'p2');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('00000000-0000-4000-8000-0000000705e1', '00000000-0000-4000-8000-0000000705f1', '00000000-0000-4000-8000-000000070501', 'w'),
  ('00000000-0000-4000-8000-0000000705e2', '00000000-0000-4000-8000-0000000705f2', '00000000-0000-4000-8000-000000070501', 'w2');

-- A job with a child, each holding a recorded file; a job holding nothing.
INSERT INTO jobs (id, user_id, status, server_output) VALUES
  ('00000000-0000-4000-8000-0000000705a1', '00000000-0000-4000-8000-000000070501', 'completed', '{"stored": {"videos/a1-master.mov": 9000}}'),
  ('00000000-0000-4000-8000-0000000705a3', '00000000-0000-4000-8000-000000070501', 'completed', NULL);
INSERT INTO jobs (id, user_id, status, parent_job_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000705a2', '00000000-0000-4000-8000-000000070501', 'completed', '00000000-0000-4000-8000-0000000705a1', '{"stored": {"videos/a2-master.mov": 500}}');

-- 1. A job delete answers the bytes its job and its child recorded, per owner.
SELECT pg_temp.assert_eq('job delete: the stored bytes of the job and its child',
  (public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000705a1', '00000000-0000-4000-8000-000000070501', false) -> 'storedBytesByOwner')::text,
  '{"00000000-0000-4000-8000-000000070501": 9500}');
SELECT pg_temp.assert_eq('job delete: the rows are gone',
  (SELECT count(*)::text FROM jobs WHERE id IN ('00000000-0000-4000-8000-0000000705a1', '00000000-0000-4000-8000-0000000705a2')), '0');
SELECT pg_temp.assert_eq('a job with nothing recorded answers an empty map',
  (public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000705a3', '00000000-0000-4000-8000-000000070501', false) -> 'storedBytesByOwner')::text,
  '{}');
SELECT pg_temp.assert_eq('a delete of no row answers no map',
  coalesce((public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000705a1', '00000000-0000-4000-8000-000000070501', false) -> 'storedBytesByOwner')::text, '<none>'),
  '<none>');

-- 2. Another user's job is not deleted and answers nothing.
INSERT INTO jobs (id, user_id, status, server_output) VALUES
  ('00000000-0000-4000-8000-0000000705a4', '00000000-0000-4000-8000-000000070502', 'completed', '{"stored": {"videos/a4-master.mov": 700}}');
SELECT pg_temp.assert_eq('another user''s job: not deleted',
  (public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000705a4', '00000000-0000-4000-8000-000000070501', false) ->> 'deleted'), 'false');
SELECT pg_temp.assert_eq('another user''s job: its record intact',
  (SELECT server_output->'stored'->>'videos/a4-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000705a4'), '700');

-- 3. The Trash's delete answers the same field; one not trashed long enough answers none.
INSERT INTO jobs (id, user_id, status, server_output, deleted_at) VALUES
  ('00000000-0000-4000-8000-0000000705a5', '00000000-0000-4000-8000-000000070501', 'completed', '{"stored": {"videos/a5-master.mov": 300}}', now() - interval '40 days');
SELECT pg_temp.assert_eq('trash delete before a cutoff it is newer than: nothing',
  coalesce((public.delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-0000000705a5', '00000000-0000-4000-8000-000000070501', false, now() - interval '50 days') -> 'storedBytesByOwner')::text, '<none>'),
  '<none>');
SELECT pg_temp.assert_eq('trash delete: the stored bytes',
  (public.delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-0000000705a5', '00000000-0000-4000-8000-000000070501', false, now()) -> 'storedBytesByOwner')::text,
  '{"00000000-0000-4000-8000-000000070501": 300}');

-- 4. A workflow delete answers each job's own owner, a member's job included.
INSERT INTO jobs (id, user_id, status, workflow_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000705b1', '00000000-0000-4000-8000-000000070501', 'completed', '00000000-0000-4000-8000-0000000705e1', '{"stored": {"videos/b1-master.mov": 1000}}'),
  ('00000000-0000-4000-8000-0000000705b2', '00000000-0000-4000-8000-000000070502', 'completed', '00000000-0000-4000-8000-0000000705e1', '{"stored": {"videos/b2-master.mov": 200}}');
INSERT INTO jobs (id, user_id, status, parent_job_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000705b3', '00000000-0000-4000-8000-000000070501', 'completed', '00000000-0000-4000-8000-0000000705b1', '{"stored": {"videos/b3-master.mov": 30, "videos/b3-raw.mov": 4}}');
SELECT pg_temp.assert_eq('workflow delete: each owner''s bytes, a member and a child job included',
  (public.delete_workflow_with_recast_cleanup('00000000-0000-4000-8000-0000000705e1', '00000000-0000-4000-8000-000000070501') -> 'storedBytesByOwner')::text,
  '{"00000000-0000-4000-8000-000000070501": 1034, "00000000-0000-4000-8000-000000070502": 200}');

-- 5. A project delete answers the jobs of its workflows.
INSERT INTO jobs (id, user_id, status, workflow_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000705c1', '00000000-0000-4000-8000-000000070501', 'completed', '00000000-0000-4000-8000-0000000705e2', '{"stored": {"videos/c1-master.mov": 77}}');
SELECT pg_temp.assert_eq('project delete: the bytes of its workflows'' jobs',
  (public.delete_project_with_recast_cleanup('00000000-0000-4000-8000-0000000705f2', '00000000-0000-4000-8000-000000070501') -> 'storedBytesByOwner')::text,
  '{"00000000-0000-4000-8000-000000070501": 77}');

-- 6. A delete the database refuses rolls back with the record intact and answers nothing.
INSERT INTO jobs (id, user_id, status, server_output) VALUES
  ('00000000-0000-4000-8000-0000000705d1', '00000000-0000-4000-8000-000000070501', 'completed', '{"stored": {"videos/d1-master.mov": 600}}');
CREATE FUNCTION pg_temp.refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id = '00000000-0000-4000-8000-0000000705d1' THEN RAISE EXCEPTION 'refused for the test'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER refuse_delete_for_test BEFORE DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_delete();
DO $$
DECLARE answer jsonb;
BEGIN
  BEGIN
    answer := public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000705d1', '00000000-0000-4000-8000-000000070501', false);
    RAISE EXCEPTION 'ASSERT FAIL [a refused delete answered]: %', answer;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'refused for the test' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  a refused delete answers nothing';
END $$;
DROP TRIGGER refuse_delete_for_test ON public.jobs;
SELECT pg_temp.assert_eq('a refused delete: the row and its record intact',
  (SELECT server_output->'stored'->>'videos/d1-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000705d1'), '600');

-- 7. The helper is the service role's only.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.stored_bytes_by_owner(ARRAY['00000000-0000-4000-8000-0000000705d1'::uuid]);
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls stored_bytes_by_owner]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call stored_bytes_by_owner';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.stored_bytes_by_owner(ARRAY['00000000-0000-4000-8000-0000000705d1'::uuid]);
  RAISE EXCEPTION 'ASSERT FAIL [anon calls stored_bytes_by_owner]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call stored_bytes_by_owner';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('service_role: stored_bytes_by_owner',
  public.stored_bytes_by_owner(ARRAY['00000000-0000-4000-8000-0000000705d1'::uuid])::text,
  '{"00000000-0000-4000-8000-000000070501": 600}');
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
