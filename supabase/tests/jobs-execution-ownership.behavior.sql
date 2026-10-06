-- ============================================================================
-- Behavioral proof: the browser writes no job and no execution, and a job
-- belongs only to its own user's executions (migration 474, decided
-- 2026-10-06).
--
-- The backend reads a run's jobs with the service role (fan-out resume, render
-- adoption, crash reconcile, wait budgets), so `jobs.workflow_execution_id` is
-- trusted data. Before 474 a signed-in client could insert its own `jobs` row
-- naming any execution. Grants, policies and triggers are not provable from
-- SQL text, so this runs the real privilege system.
--
-- Own uuid range ...-0000000e7101 upward.
-- Run against the migrated disposable database, never the shared cloud project.
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

-- A (victim) owns a workflow and a run of it; B (attacker) owns their own.
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000e7101', 'victim@jobs-owner.test', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e7102', 'attacker@jobs-owner.test', '{}', 'authenticated', 'authenticated');
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-0000000e7101', '00000000-0000-4000-8000-0000000e7101', 'victim project'),
  ('c0000000-0000-4000-8000-0000000e7102', '00000000-0000-4000-8000-0000000e7102', 'attacker project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-0000000e7101', 'c0000000-0000-4000-8000-0000000e7101', '00000000-0000-4000-8000-0000000e7101', 'victim wf'),
  ('d0000000-0000-4000-8000-0000000e7102', 'c0000000-0000-4000-8000-0000000e7102', '00000000-0000-4000-8000-0000000e7102', 'attacker wf');
INSERT INTO workflow_executions (id, workflow_id, user_id, status) VALUES
  ('e0000000-0000-4000-8000-0000000e7101', 'd0000000-0000-4000-8000-0000000e7101', '00000000-0000-4000-8000-0000000e7101', 'running'),
  ('e0000000-0000-4000-8000-0000000e7102', 'd0000000-0000-4000-8000-0000000e7102', '00000000-0000-4000-8000-0000000e7102', 'running'),
  ('e0000000-0000-4000-8000-0000000e7103', 'd0000000-0000-4000-8000-0000000e7101', '00000000-0000-4000-8000-0000000e7101', 'completed');

-- -------------------------------------------------------------- the browser
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e7102","role":"authenticated"}';
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-0000000e7102';

-- 1. THE HOLE: the attacker's own row, naming the victim's run, with an output.
DO $$ BEGIN
  INSERT INTO public.jobs (user_id, job_type, status, workflow_execution_id, input_data, output_data)
  VALUES ('00000000-0000-4000-8000-0000000e7102', 'generate-image', 'completed', 'e0000000-0000-4000-8000-0000000e7101',
          '{"node_id":"n1","iterationIndex":0}', '{"imageUrl":"https://evil.example/x.png"}');
  RAISE EXCEPTION 'ASSERT FAIL: a browser planted a job in another user''s execution';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot insert a job naming another user''s execution';
END $$;

-- 2. Not a column list: no job at all, not even a plain one of its own.
DO $$ BEGIN
  INSERT INTO public.jobs (user_id, job_type, status, credits)
  VALUES ('00000000-0000-4000-8000-0000000e7102', 'generate-image', 'pending', 0);
  RAISE EXCEPTION 'ASSERT FAIL: a browser inserted a job';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot insert any job';
END $$;

-- 2b. Nor its own execution: a runner marking a running run failed (to get
--     past the permanent delete's in-progress check), deleting it outright
--     (044 cascades the app run away, so its creator fee is never settled),
--     or writing node_states (job ids the server reads back) is refused.
DO $$ BEGIN
  UPDATE public.workflow_executions SET status = 'failed'
   WHERE id = 'e0000000-0000-4000-8000-0000000e7102';
  RAISE EXCEPTION 'ASSERT FAIL: a browser re-statused its own running execution';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot change its own execution''s status';
END $$;
DO $$ BEGIN
  UPDATE public.workflow_executions SET node_states = '{"n1":{"status":"failed","jobId":"f0000000-0000-4000-8000-0000000e7101"}}'
   WHERE id = 'e0000000-0000-4000-8000-0000000e7102';
  RAISE EXCEPTION 'ASSERT FAIL: a browser wrote its own execution''s node_states';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot write its own execution''s node_states';
END $$;
DO $$ BEGIN
  DELETE FROM public.workflow_executions WHERE id = 'e0000000-0000-4000-8000-0000000e7102';
  RAISE EXCEPTION 'ASSERT FAIL: a browser deleted its own running execution';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot delete its own execution';
END $$;
DO $$ BEGIN
  INSERT INTO public.workflow_executions (workflow_id, user_id, status)
  VALUES ('d0000000-0000-4000-8000-0000000e7102', '00000000-0000-4000-8000-0000000e7102', 'completed');
  RAISE EXCEPTION 'ASSERT FAIL: a browser inserted an execution';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a browser cannot insert an execution';
END $$;
-- It still reads its own run (the editor and Realtime need SELECT only).
SELECT pg_temp.assert_eq('a browser still reads its own execution',
  (SELECT status FROM public.workflow_executions WHERE id = 'e0000000-0000-4000-8000-0000000e7102'), 'running');
RESET ROLE;

DO $$ BEGIN
  PERFORM pg_temp.assert_eq('authenticated holds no INSERT on jobs', has_table_privilege('authenticated', 'public.jobs', 'INSERT')::text, 'false');
  PERFORM pg_temp.assert_eq('authenticated holds no UPDATE on jobs', has_table_privilege('authenticated', 'public.jobs', 'UPDATE')::text, 'false');
  PERFORM pg_temp.assert_eq('authenticated holds no DELETE on jobs', has_table_privilege('authenticated', 'public.jobs', 'DELETE')::text, 'false');
  PERFORM pg_temp.assert_eq('anon holds no INSERT on jobs', has_table_privilege('anon', 'public.jobs', 'INSERT')::text, 'false');
  PERFORM pg_temp.assert_eq('anon holds no UPDATE on jobs', has_table_privilege('anon', 'public.jobs', 'UPDATE')::text, 'false');
  -- The editor's Realtime feed still reads its four columns (347).
  PERFORM pg_temp.assert_eq('authenticated still reads jobs.output_data', has_column_privilege('authenticated', 'public.jobs', 'output_data', 'SELECT')::text, 'true');
  PERFORM pg_temp.assert_eq('authenticated holds no INSERT on workflow_executions', has_table_privilege('authenticated', 'public.workflow_executions', 'INSERT')::text, 'false');
  PERFORM pg_temp.assert_eq('authenticated holds no UPDATE on workflow_executions', has_table_privilege('authenticated', 'public.workflow_executions', 'UPDATE')::text, 'false');
  PERFORM pg_temp.assert_eq('authenticated holds no DELETE on workflow_executions', has_table_privilege('authenticated', 'public.workflow_executions', 'DELETE')::text, 'false');
  PERFORM pg_temp.assert_eq('anon holds no DELETE on workflow_executions', has_table_privilege('anon', 'public.workflow_executions', 'DELETE')::text, 'false');
  PERFORM pg_temp.assert_eq('no write policy on workflow_executions is left',
    (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workflow_executions' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')), '0');
  PERFORM pg_temp.assert_eq('no permissive INSERT policy on jobs is left',
    (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'jobs' AND cmd IN ('INSERT', 'ALL') AND permissive = 'PERMISSIVE'), '0');
END $$;

-- ---------------------------------------------------------- the service role
SET LOCAL ROLE service_role;

-- 3. The normal case still works: a job of the execution's own user.
INSERT INTO public.jobs (id, user_id, job_type, status, workflow_execution_id, input_data)
VALUES ('f0000000-0000-4000-8000-0000000e7101', '00000000-0000-4000-8000-0000000e7101', 'generate-image', 'pending',
        'e0000000-0000-4000-8000-0000000e7101', '{"node_id":"n1"}');
UPDATE public.jobs SET status = 'completed', output_data = '{"imageUrl":"https://ok.example/a.png"}'
 WHERE id = 'f0000000-0000-4000-8000-0000000e7101';
-- Re-pointing it at another run of the SAME user is allowed.
UPDATE public.jobs SET workflow_execution_id = 'e0000000-0000-4000-8000-0000000e7103'
 WHERE id = 'f0000000-0000-4000-8000-0000000e7101';
SELECT pg_temp.assert_eq('the owner''s job moved to the owner''s other run',
  (SELECT workflow_execution_id::text FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7101'),
  'e0000000-0000-4000-8000-0000000e7103');

-- 4. The invariant binds the service role too.
DO $$ BEGIN
  INSERT INTO public.jobs (user_id, job_type, status, workflow_execution_id)
  VALUES ('00000000-0000-4000-8000-0000000e7102', 'generate-image', 'completed', 'e0000000-0000-4000-8000-0000000e7101');
  RAISE EXCEPTION 'ASSERT FAIL: the service role inserted a job naming another user''s execution';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  a cross-user insert is refused for the service role too';
END $$;
DO $$ BEGIN
  UPDATE public.jobs SET workflow_execution_id = 'e0000000-0000-4000-8000-0000000e7102'
   WHERE id = 'f0000000-0000-4000-8000-0000000e7101';
  RAISE EXCEPTION 'ASSERT FAIL: a job was re-pointed at another user''s execution';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  re-pointing a job at another user''s execution is refused';
END $$;
DO $$ BEGIN
  UPDATE public.jobs SET user_id = '00000000-0000-4000-8000-0000000e7102'
   WHERE id = 'f0000000-0000-4000-8000-0000000e7101';
  RAISE EXCEPTION 'ASSERT FAIL: a job was handed to a user who does not own its execution';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  handing a job to another user while it names the run is refused';
END $$;

-- 5. Deleting the run detaches its jobs (036's ON DELETE SET NULL) — the
--    trigger lets a NULL pointer through.
DELETE FROM public.workflow_executions WHERE id = 'e0000000-0000-4000-8000-0000000e7103';
SELECT pg_temp.assert_eq('deleting the run detaches its job',
  (SELECT coalesce(workflow_execution_id::text, 'null') FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7101'), 'null');
RESET ROLE;

-- ------------------------------------------------- rows planted before 474
-- Plant one the way a pre-474 client could (trigger off: this is the old
-- world), plus a legitimate row, then re-apply 474: the planted pointer is
-- detached, the legitimate one kept, and the migration runs twice cleanly.
ALTER TABLE public.jobs DISABLE TRIGGER trg_jobs_execution_owner;
INSERT INTO public.jobs (id, user_id, job_type, status, workflow_execution_id, input_data, output_data) VALUES
  ('f0000000-0000-4000-8000-0000000e7110', '00000000-0000-4000-8000-0000000e7102', 'generate-image', 'completed',
   'e0000000-0000-4000-8000-0000000e7101', '{"node_id":"n1","iterationIndex":0}', '{"imageUrl":"https://evil.example/x.png"}'),
  ('f0000000-0000-4000-8000-0000000e7111', '00000000-0000-4000-8000-0000000e7101', 'generate-image', 'completed',
   'e0000000-0000-4000-8000-0000000e7101', '{"node_id":"n1","iterationIndex":1}', '{"imageUrl":"https://ok.example/b.png"}');
ALTER TABLE public.jobs ENABLE TRIGGER trg_jobs_execution_owner;

\ir ../migrations/474_jobs_execution_ownership.sql

DO $$ BEGIN
  PERFORM pg_temp.assert_eq('the planted pointer is detached',
    (SELECT coalesce(workflow_execution_id::text, 'null') FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7110'), 'null');
  PERFORM pg_temp.assert_eq('the planted row itself stays (its user''s own standalone job)',
    (SELECT count(*)::text FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7110'), '1');
  PERFORM pg_temp.assert_eq('the owner''s job keeps its run',
    (SELECT workflow_execution_id::text FROM public.jobs WHERE id = 'f0000000-0000-4000-8000-0000000e7111'),
    'e0000000-0000-4000-8000-0000000e7101');
  PERFORM pg_temp.assert_eq('the victim''s run now has only its owner''s jobs',
    (SELECT count(*)::text FROM public.jobs j JOIN public.workflow_executions we ON we.id = j.workflow_execution_id
      WHERE we.id = 'e0000000-0000-4000-8000-0000000e7101' AND j.user_id <> we.user_id), '0');
  RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED';
END $$;

ROLLBACK;
