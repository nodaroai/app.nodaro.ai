-- ============================================================================
-- Behavioral proof: a delete for good answers the files its jobs' server-only
-- records hold (migration 736).
--
-- Runs AFTER the whole migration chain, as `postgres`, in a transaction that
-- rolls back. Its own uuid range (...-000000073601 upward).
--
-- WHY THIS PROOF EXISTS. A job's record of the files its video store kept
-- (`jobs.server_output.stored`, migration 695) is the only thing that can find
-- them again. Deleting the job destroys it, so the delete itself must answer
-- the keys, from exactly the rows it deletes, in the same transaction, and
-- answer nothing when the database refuses the delete. The backend removes a
-- file only from this answer: a key answered for a row the delete did not take
-- would remove a live job's file, and a key not answered stays in storage for
-- good. `named` lets the backend keep an original the job delivered as its
-- result.
--
-- Run locally (throwaway container; CI runs the image named below):
--   docker run -d --rm --name mig-test -e POSTGRES_PASSWORD=postgres -p 5433:5432 supabase/postgres:15.8.1.085
--   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres node backend/scripts/run-migrations.mjs
--   docker cp supabase/tests/job-delete-recorded-files.behavior.sql mig-test:/tmp/t.sql
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
  ('00000000-0000-4000-8000-000000073601', 'files-owner@jd.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000073602', 'files-member@jd.test', '{}', 'authenticated', 'authenticated');

INSERT INTO projects (id, user_id, name) VALUES
  ('00000000-0000-4000-8000-0000000736f1', '00000000-0000-4000-8000-000000073601', 'p'),
  ('00000000-0000-4000-8000-0000000736f2', '00000000-0000-4000-8000-000000073601', 'p2');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('00000000-0000-4000-8000-0000000736e1', '00000000-0000-4000-8000-0000000736f1', '00000000-0000-4000-8000-000000073601', 'w'),
  ('00000000-0000-4000-8000-0000000736e2', '00000000-0000-4000-8000-0000000736f2', '00000000-0000-4000-8000-000000073601', 'w2');

-- A job whose record holds its original and a raw clip, with a child holding
-- an original; its output names its preview, its original (in
-- `originalVideoUrl`) and an echoed input of another job. A job holding nothing.
INSERT INTO jobs (id, user_id, status, server_output, output_data) VALUES
  ('00000000-0000-4000-8000-0000000736a1', '00000000-0000-4000-8000-000000073601', 'completed',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736a1-master.mov": 9000, "videos/00000000-0000-4000-8000-0000000736a1-raw-x.mov": 40}}',
   '{"videoUrl": "https://cdn.test/videos/00000000-0000-4000-8000-0000000736a1.mp4",
     "originalVideoUrl": "https://cdn.test/videos/00000000-0000-4000-8000-0000000736a1-master.mov",
     "source": {"url": "https://cdn.test/images/00000000-0000-4000-8000-0000000736ff.png"},
     "transcript": "no url here"}'),
  ('00000000-0000-4000-8000-0000000736a3', '00000000-0000-4000-8000-000000073601', 'completed', NULL,
   '{"videoUrl": "https://cdn.test/videos/00000000-0000-4000-8000-0000000736a3.mp4"}');
INSERT INTO jobs (id, user_id, status, parent_job_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000736a2', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736a1',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736a2-master.mp4": 500}}');

-- 1. A job delete answers its job's and its child's recorded files; named
-- keeps the output's urls that carry the job's id, without `originalVideoUrl`.
CREATE TEMP TABLE answer AS
  SELECT public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736a1', '00000000-0000-4000-8000-000000073601', false) AS a;
SELECT pg_temp.assert_eq('job delete: the job''s recorded keys',
  (SELECT (a -> 'recordedFilesByJob' -> '00000000-0000-4000-8000-0000000736a1' -> 'recorded')::text FROM answer),
  '["videos/00000000-0000-4000-8000-0000000736a1-master.mov", "videos/00000000-0000-4000-8000-0000000736a1-raw-x.mov"]');
SELECT pg_temp.assert_eq('job delete: the urls its own output names, its original''s field left out',
  (SELECT (a -> 'recordedFilesByJob' -> '00000000-0000-4000-8000-0000000736a1' -> 'named')::text FROM answer),
  '["https://cdn.test/videos/00000000-0000-4000-8000-0000000736a1.mp4"]');
SELECT pg_temp.assert_eq('job delete: its child''s recorded keys, which the delete takes too',
  (SELECT (a -> 'recordedFilesByJob' -> '00000000-0000-4000-8000-0000000736a2' -> 'recorded')::text FROM answer),
  '["videos/00000000-0000-4000-8000-0000000736a2-master.mp4"]');
SELECT pg_temp.assert_eq('job delete: the bytes answered beside them, as before',
  (SELECT (a -> 'storedBytesByOwner')::text FROM answer),
  '{"00000000-0000-4000-8000-000000073601": 9540}');
SELECT pg_temp.assert_eq('job delete: the rows are gone',
  (SELECT count(*)::text FROM jobs WHERE id IN ('00000000-0000-4000-8000-0000000736a1', '00000000-0000-4000-8000-0000000736a2')), '0');
SELECT pg_temp.assert_eq('a job with nothing recorded answers an empty map',
  (public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736a3', '00000000-0000-4000-8000-000000073601', false) -> 'recordedFilesByJob')::text,
  '{}');
SELECT pg_temp.assert_eq('a delete of no row answers no files',
  coalesce((public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736a1', '00000000-0000-4000-8000-000000073601', false) -> 'recordedFilesByJob')::text, '<none>'),
  '<none>');

-- 2. An original the job delivered as its result is named by its output.
INSERT INTO jobs (id, user_id, status, server_output, output_data) VALUES
  ('00000000-0000-4000-8000-0000000736a4', '00000000-0000-4000-8000-000000073601', 'completed',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736a4-master.mov": 800}}',
   '{"videoUrl": "https://cdn.test/videos/00000000-0000-4000-8000-0000000736a4-master.mov",
     "originalVideoUrl": "https://cdn.test/videos/00000000-0000-4000-8000-0000000736a4-master.mov",
     "videoPreviewUnavailable": true}');
SELECT pg_temp.assert_eq('a delivered original: its output names it',
  (public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736a4', '00000000-0000-4000-8000-000000073601', false) -> 'recordedFilesByJob' -> '00000000-0000-4000-8000-0000000736a4' -> 'named')::text,
  '["https://cdn.test/videos/00000000-0000-4000-8000-0000000736a4-master.mov"]');

-- 3. Another user's job is not deleted and answers no files.
INSERT INTO jobs (id, user_id, status, server_output) VALUES
  ('00000000-0000-4000-8000-0000000736a5', '00000000-0000-4000-8000-000000073602', 'completed',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736a5-master.mov": 700}}');
SELECT pg_temp.assert_eq('another user''s job: no files answered',
  coalesce((public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736a5', '00000000-0000-4000-8000-000000073601', false) -> 'recordedFilesByJob')::text, '<none>'),
  '<none>');
SELECT pg_temp.assert_eq('another user''s job: its record intact',
  (SELECT server_output->'stored'->>'videos/00000000-0000-4000-8000-0000000736a5-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000736a5'), '700');

-- 4. The Trash's delete answers the same field; one not trashed long enough answers none.
INSERT INTO jobs (id, user_id, status, server_output, deleted_at) VALUES
  ('00000000-0000-4000-8000-0000000736a6', '00000000-0000-4000-8000-000000073601', 'completed',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736a6-master.mov": 300}}', now() - interval '40 days');
SELECT pg_temp.assert_eq('trash delete before a cutoff it is newer than: no files',
  coalesce((public.delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736a6', '00000000-0000-4000-8000-000000073601', false, now() - interval '50 days') -> 'recordedFilesByJob')::text, '<none>'),
  '<none>');
SELECT pg_temp.assert_eq('trash delete: its recorded keys',
  (public.delete_trashed_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736a6', '00000000-0000-4000-8000-000000073601', false, now()) -> 'recordedFilesByJob' -> '00000000-0000-4000-8000-0000000736a6' -> 'recorded')::text,
  '["videos/00000000-0000-4000-8000-0000000736a6-master.mov"]');

-- 5. A workflow delete answers every job it takes: a member's and a child included.
INSERT INTO jobs (id, user_id, status, workflow_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000736b1', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736e1',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736b1-master.mov": 1000}}'),
  ('00000000-0000-4000-8000-0000000736b2', '00000000-0000-4000-8000-000000073602', 'completed', '00000000-0000-4000-8000-0000000736e1',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736b2-master.mov": 200}}');
INSERT INTO jobs (id, user_id, status, parent_job_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000736b3', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736b1',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736b3-master.mov": 30}}');
SELECT pg_temp.assert_eq('workflow delete: the jobs whose records hold files',
  (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(
    public.delete_workflow_with_recast_cleanup('00000000-0000-4000-8000-0000000736e1', '00000000-0000-4000-8000-000000073601') -> 'recordedFilesByJob') AS k),
  '00000000-0000-4000-8000-0000000736b1,00000000-0000-4000-8000-0000000736b2,00000000-0000-4000-8000-0000000736b3');

-- 6. A project delete answers the jobs of its workflows.
INSERT INTO jobs (id, user_id, status, workflow_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000736c1', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736e2',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736c1-master.mov": 77}}');
SELECT pg_temp.assert_eq('project delete: the recorded keys of its workflows'' jobs',
  (public.delete_project_with_recast_cleanup('00000000-0000-4000-8000-0000000736f2', '00000000-0000-4000-8000-000000073601') -> 'recordedFilesByJob' -> '00000000-0000-4000-8000-0000000736c1' -> 'recorded')::text,
  '["videos/00000000-0000-4000-8000-0000000736c1-master.mov"]');

-- 7. A delete the database refuses rolls back with the record intact and answers nothing.
INSERT INTO jobs (id, user_id, status, server_output) VALUES
  ('00000000-0000-4000-8000-0000000736d1', '00000000-0000-4000-8000-000000073601', 'completed',
   '{"stored": {"videos/00000000-0000-4000-8000-0000000736d1-master.mov": 600}}');
CREATE FUNCTION pg_temp.refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id = '00000000-0000-4000-8000-0000000736d1' THEN RAISE EXCEPTION 'refused for the test'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER refuse_delete_for_test BEFORE DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_delete();
DO $$
DECLARE answer jsonb;
BEGIN
  BEGIN
    answer := public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736d1', '00000000-0000-4000-8000-000000073601', false);
    RAISE EXCEPTION 'ASSERT FAIL [a refused delete answered]: %', answer;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'refused for the test' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  a refused delete answers nothing';
END $$;
DROP TRIGGER refuse_delete_for_test ON public.jobs;
SELECT pg_temp.assert_eq('a refused delete: the row and its record intact',
  (SELECT server_output->'stored'->>'videos/00000000-0000-4000-8000-0000000736d1-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000736d1'), '600');

-- 7b. A row that leaves the cascade while the delete runs (a concurrent move
-- that commits between the collection and the DELETE, played here by a
-- trigger on the deleted row) is answered for neither its bytes nor its files,
-- and keeps its record.
INSERT INTO projects (id, user_id, name) VALUES
  ('00000000-0000-4000-8000-0000000736f3', '00000000-0000-4000-8000-000000073601', 'p3'),
  ('00000000-0000-4000-8000-0000000736f4', '00000000-0000-4000-8000-000000073601', 'p4');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('00000000-0000-4000-8000-0000000736e3', '00000000-0000-4000-8000-0000000736f3', '00000000-0000-4000-8000-000000073601', 'w3'),
  ('00000000-0000-4000-8000-0000000736e4', '00000000-0000-4000-8000-0000000736f3', '00000000-0000-4000-8000-000000073601', 'w4'),
  ('00000000-0000-4000-8000-0000000736e5', '00000000-0000-4000-8000-0000000736f4', '00000000-0000-4000-8000-000000073601', 'w5'),
  ('00000000-0000-4000-8000-0000000736e6', '00000000-0000-4000-8000-0000000736f4', '00000000-0000-4000-8000-000000073601', 'w6');
INSERT INTO jobs (id, user_id, status, workflow_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000736c3', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736e3', '{"stored": {"videos/00000000-0000-4000-8000-0000000736c3-master.mov": 111}}'),
  ('00000000-0000-4000-8000-0000000736c4', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736e4', '{"stored": {"videos/00000000-0000-4000-8000-0000000736c4-master.mov": 222}}'),
  ('00000000-0000-4000-8000-0000000736c5', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736e5', '{"stored": {"videos/00000000-0000-4000-8000-0000000736c5-master.mov": 333}}'),
  ('00000000-0000-4000-8000-0000000736c6', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736e5', '{"stored": {"videos/00000000-0000-4000-8000-0000000736c6-master.mov": 444}}'),
  ('00000000-0000-4000-8000-0000000736c7', '00000000-0000-4000-8000-000000073601', 'completed', NULL, '{"stored": {"videos/00000000-0000-4000-8000-0000000736c7-master.mov": 5}}');
INSERT INTO jobs (id, user_id, status, parent_job_id, server_output) VALUES
  ('00000000-0000-4000-8000-0000000736c8', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736c7', '{"stored": {"videos/00000000-0000-4000-8000-0000000736c8-raw-x.mov": 6}}'),
  ('00000000-0000-4000-8000-0000000736c9', '00000000-0000-4000-8000-000000073601', 'completed', '00000000-0000-4000-8000-0000000736c7', '{"stored": {"videos/00000000-0000-4000-8000-0000000736c9-raw-x.mov": 7}}');
CREATE FUNCTION pg_temp.move_out() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'projects' AND OLD.id = '00000000-0000-4000-8000-0000000736f3' THEN
    UPDATE public.workflows SET project_id = '00000000-0000-4000-8000-0000000736f4' WHERE id = '00000000-0000-4000-8000-0000000736e4';
  ELSIF TG_TABLE_NAME = 'workflows' AND OLD.id = '00000000-0000-4000-8000-0000000736e5' THEN
    UPDATE public.jobs SET workflow_id = '00000000-0000-4000-8000-0000000736e6' WHERE id = '00000000-0000-4000-8000-0000000736c6';
  ELSIF TG_TABLE_NAME = 'jobs' AND OLD.id = '00000000-0000-4000-8000-0000000736c7' THEN
    UPDATE public.jobs SET parent_job_id = NULL WHERE id = '00000000-0000-4000-8000-0000000736c9';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER move_out_for_test BEFORE DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION pg_temp.move_out();
CREATE TRIGGER move_out_for_test BEFORE DELETE ON public.workflows FOR EACH ROW EXECUTE FUNCTION pg_temp.move_out();
CREATE TRIGGER move_out_for_test BEFORE DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION pg_temp.move_out();

CREATE TEMP TABLE moved AS SELECT
  public.delete_project_with_recast_cleanup('00000000-0000-4000-8000-0000000736f3', '00000000-0000-4000-8000-000000073601') AS project,
  NULL::jsonb AS workflow,
  NULL::jsonb AS job;
UPDATE moved SET workflow = public.delete_workflow_with_recast_cleanup('00000000-0000-4000-8000-0000000736e5', '00000000-0000-4000-8000-000000073601');
UPDATE moved SET job = public.delete_job_with_recast_cleanup('00000000-0000-4000-8000-0000000736c7', '00000000-0000-4000-8000-000000073601', false);
DROP TRIGGER move_out_for_test ON public.projects;
DROP TRIGGER move_out_for_test ON public.workflows;
DROP TRIGGER move_out_for_test ON public.jobs;

SELECT pg_temp.assert_eq('project delete, a workflow moved out meanwhile: only the job it took is answered',
  (SELECT string_agg(k, ',' ORDER BY k) FROM moved, jsonb_object_keys(project -> 'recordedFilesByJob') AS k), '00000000-0000-4000-8000-0000000736c3');
SELECT pg_temp.assert_eq('project delete, a workflow moved out meanwhile: only the bytes of the job it took',
  (SELECT (project -> 'storedBytesByOwner')::text FROM moved), '{"00000000-0000-4000-8000-000000073601": 111}');
SELECT pg_temp.assert_eq('project delete: the moved workflow''s job lives on with its record',
  (SELECT server_output->'stored'->>'videos/00000000-0000-4000-8000-0000000736c4-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000736c4'), '222');
SELECT pg_temp.assert_eq('workflow delete, a job moved out meanwhile: only the job it took is answered',
  (SELECT string_agg(k, ',' ORDER BY k) FROM moved, jsonb_object_keys(workflow -> 'recordedFilesByJob') AS k), '00000000-0000-4000-8000-0000000736c5');
SELECT pg_temp.assert_eq('workflow delete, a job moved out meanwhile: only the bytes of the job it took',
  (SELECT (workflow -> 'storedBytesByOwner')::text FROM moved), '{"00000000-0000-4000-8000-000000073601": 333}');
SELECT pg_temp.assert_eq('workflow delete: the moved job lives on with its record',
  (SELECT server_output->'stored'->>'videos/00000000-0000-4000-8000-0000000736c6-master.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000736c6'), '444');
SELECT pg_temp.assert_eq('job delete, a child moved to another parent meanwhile: only the jobs it took are answered',
  (SELECT string_agg(k, ',' ORDER BY k) FROM moved, jsonb_object_keys(job -> 'recordedFilesByJob') AS k), '00000000-0000-4000-8000-0000000736c7,00000000-0000-4000-8000-0000000736c8');
SELECT pg_temp.assert_eq('job delete, a child moved meanwhile: only the bytes of the jobs it took',
  (SELECT (job -> 'storedBytesByOwner')::text FROM moved), '{"00000000-0000-4000-8000-000000073601": 11}');
SELECT pg_temp.assert_eq('job delete: the moved child lives on with its record',
  (SELECT server_output->'stored'->>'videos/00000000-0000-4000-8000-0000000736c9-raw-x.mov' FROM jobs WHERE id = '00000000-0000-4000-8000-0000000736c9'), '7');

-- 8. A deleted job an in-flight job's input names (its id, as a source or in
-- its files' urls) is answered; a finished job's input, and a cancelled one's,
-- are not asked.
INSERT INTO jobs (id, user_id, status, input_data) VALUES
  ('00000000-0000-4000-8000-0000000736a7', '00000000-0000-4000-8000-000000073601', 'processing',
   '{"videoUrl": "https://cdn.test/videos/00000000-0000-4000-8000-0000000736d1-master.mov"}'),
  ('00000000-0000-4000-8000-0000000736a9', '00000000-0000-4000-8000-000000073601', 'pending_review',
   '{"sourceJobId": "00000000-0000-4000-8000-0000000736b1"}'),
  ('00000000-0000-4000-8000-0000000736a8', '00000000-0000-4000-8000-000000073601', 'completed',
   '{"videoUrl": "https://cdn.test/videos/00000000-0000-4000-8000-0000000736c1-master.mov"}'),
  ('00000000-0000-4000-8000-0000000736aa', '00000000-0000-4000-8000-000000073601', 'cancelled',
   '{"sourceJobId": "00000000-0000-4000-8000-0000000736b2"}');
SELECT pg_temp.assert_eq('in-flight inputs: only the jobs one still on its way names',
  (SELECT string_agg(k, ',' ORDER BY k) FROM public.in_flight_job_inputs_naming(
    ARRAY['00000000-0000-4000-8000-0000000736d1', '00000000-0000-4000-8000-0000000736b1', '00000000-0000-4000-8000-0000000736c1',
          '00000000-0000-4000-8000-0000000736b2', '00000000-0000-4000-8000-0000000736ee', '']) AS k),
  '00000000-0000-4000-8000-0000000736b1,00000000-0000-4000-8000-0000000736d1');

-- 9. The helpers are the service role's only.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.deleting_jobs_records(ARRAY['00000000-0000-4000-8000-0000000736d1'::uuid]);
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls deleting_jobs_records]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call deleting_jobs_records';
END $$;
DO $$
BEGIN
  PERFORM public.deleted_jobs_answer('{}'::jsonb);
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls deleted_jobs_answer]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call deleted_jobs_answer';
END $$;
DO $$
BEGIN
  PERFORM public.in_flight_job_inputs_naming(ARRAY['x']);
  RAISE EXCEPTION 'ASSERT FAIL [authenticated calls in_flight_job_inputs_naming]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  authenticated cannot call in_flight_job_inputs_naming';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.deleting_jobs_records(ARRAY['00000000-0000-4000-8000-0000000736d1'::uuid]);
  RAISE EXCEPTION 'ASSERT FAIL [anon calls deleting_jobs_records]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call deleting_jobs_records';
END $$;
DO $$
BEGIN
  PERFORM public.deleted_jobs_answer('{}'::jsonb);
  RAISE EXCEPTION 'ASSERT FAIL [anon calls deleted_jobs_answer]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call deleted_jobs_answer';
END $$;
DO $$
BEGIN
  PERFORM public.in_flight_job_inputs_naming(ARRAY['x']);
  RAISE EXCEPTION 'ASSERT FAIL [anon calls in_flight_job_inputs_naming]';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  anon cannot call in_flight_job_inputs_naming';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_eq('service_role: deleting_jobs_records',
  (public.deleting_jobs_records(ARRAY['00000000-0000-4000-8000-0000000736d1'::uuid]) -> '00000000-0000-4000-8000-0000000736d1' -> 'recorded')::text,
  '["videos/00000000-0000-4000-8000-0000000736d1-master.mov"]');
SELECT pg_temp.assert_eq('service_role: deleted_jobs_answer, for a row that still exists',
  public.deleted_jobs_answer(public.deleting_jobs_records(ARRAY['00000000-0000-4000-8000-0000000736d1'::uuid]))::text,
  '{"recordedFilesByJob": {}, "storedBytesByOwner": {}}');
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
