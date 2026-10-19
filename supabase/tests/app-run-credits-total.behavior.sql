-- ============================================================================
-- Behavioral proof — 537_app_run_credits_total.sql
-- ============================================================================
-- Runs after the full migration chain (CI: migration-behavior job), as
-- `postgres`, inside a transaction it rolls back. Its own uuid range
-- (...-000000001501 upward). The assertions that matter most:
--   * a run with one failed attempt plus one Retry shows the SUM of both, and
--     a Retry of that Retry adds its own;
--   * the total follows the spend live (each level's write), not only at the end;
--   * a run never retried shows its execution's own spend, as before;
--   * the app's daily analytics add each attempt's OWN spend once (no double
--     count of the failed attempt);
--   * a start-over (no `resumedFrom`) begins a chain of its own;
--   * a link is followed only when it is trustworthy: a stamp on a lane that
--     writes stamps, naming THIS run, to the runner's own execution;
--   * a malformed link, a link to another workflow and an over-long chain are
--     all bounded; a root without an app-run stamp is still summed;
--   * neither trigger can fail the write it rides on, even when the total raises;
--   * the creator's markup is still settled once per run;
--   * the helper is no client's to call.
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

CREATE FUNCTION pg_temp.run_credits(p_run uuid) RETURNS text
LANGUAGE sql AS $$ SELECT credits_used::text FROM public.app_runs WHERE id = p_run $$;

-- ---------------------------------------------------------------- fixtures
-- runner (r) runs the app; creator (c) made it; other (o) is someone else.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000001501', 'credits-runner@example.com'),
  ('00000000-0000-4000-8000-000000001502', 'credits-creator@example.com'),
  ('00000000-0000-4000-8000-000000001503', 'credits-other@example.com');

UPDATE profiles SET subscription_credits = 100, topup_credits = 0 WHERE id = '00000000-0000-4000-8000-000000001501';

INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001502', 'Credits Project');
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000001501', 'c0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001502', 'Credits Workflow');
INSERT INTO published_apps (id, workflow_id, creator_id, version, slug, name, snapshot_nodes, snapshot_edges) VALUES
  ('f0000000-0000-4000-8000-000000001501', 'd0000000-0000-4000-8000-000000001501',
   '00000000-0000-4000-8000-000000001502', 1, 'credits-total-app', 'Credits App', '[]'::jsonb, '[]'::jsonb);

-- ------------------------------- S1: a failed attempt, then a Retry (the sum)
-- The run's first attempt, as executeAppRun starts it.
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001501', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'running', 'app_run', '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001501"}}'::jsonb);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001501', 'f0000000-0000-4000-8000-000000001501',
   'e0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501');
SELECT pg_temp.assert_eq('S1: a new run starts at 0', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '0');

-- A level persists its spend mid-run: the run follows it live.
UPDATE workflow_executions SET total_credits_used = 12 WHERE id = 'e0000000-0000-4000-8000-000000001501';
SELECT pg_temp.assert_eq('S1: the total follows the spend mid-run', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '12');

-- The attempt fails, having spent 30.
UPDATE workflow_executions SET status = 'failed', total_credits_used = 30 WHERE id = 'e0000000-0000-4000-8000-000000001501';
SELECT pg_temp.assert_eq('S1: the failed attempt''s spend', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '30');
SELECT pg_temp.assert_eq('S1: analytics add the failed attempt''s spend',
  (SELECT total_credits::text FROM app_analytics WHERE app_id = 'f0000000-0000-4000-8000-000000001501'), '30');

-- The Retry (routes/app-run-resume.ts): a new execution stamped with the run and
-- the execution it continues, then the pointer moves to it.
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001502', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'pending', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001501", "resumedFrom": "e0000000-0000-4000-8000-000000001501"}}'::jsonb);
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001502', status = 'running'
 WHERE id = '90000000-0000-4000-8000-000000001501';
SELECT pg_temp.assert_eq('S1: the pointer move keeps the failed attempt''s spend', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '30');

UPDATE workflow_executions SET status = 'running', total_credits_used = 8 WHERE id = 'e0000000-0000-4000-8000-000000001502';
SELECT pg_temp.assert_eq('S1: a running Retry adds its live spend', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '38');

UPDATE workflow_executions SET status = 'failed', total_credits_used = 20 WHERE id = 'e0000000-0000-4000-8000-000000001502';
SELECT pg_temp.assert_eq('S1: failed attempt + Retry = the sum', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '50');
SELECT pg_temp.assert_eq('S1: each attempt''s own spend stays on its execution',
  (SELECT string_agg(total_credits_used::text, ',' ORDER BY id) FROM workflow_executions
    WHERE id IN ('e0000000-0000-4000-8000-000000001501', 'e0000000-0000-4000-8000-000000001502')), '30,20');

-- A Retry of the Retry: three attempts.
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001503', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'pending', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001501", "resumedFrom": "e0000000-0000-4000-8000-000000001502"}, "runRoot": {"executionId": "e0000000-0000-4000-8000-000000001501"}}'::jsonb);
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001503' WHERE id = '90000000-0000-4000-8000-000000001501';
UPDATE workflow_executions SET status = 'running' WHERE id = 'e0000000-0000-4000-8000-000000001503';
UPDATE workflow_executions SET status = 'completed', total_credits_used = 5 WHERE id = 'e0000000-0000-4000-8000-000000001503';
SELECT pg_temp.assert_eq('S1: three attempts sum', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '55');
SELECT pg_temp.assert_eq('S1: analytics count each attempt''s spend once (30 + 20 + 5)',
  (SELECT total_credits::text FROM app_analytics WHERE app_id = 'f0000000-0000-4000-8000-000000001501'), '55');

-- The creator's markup is settled once per run, whatever its attempts (the
-- orchestrator settles it from the completing Retry's own spend).
SELECT pg_temp.assert_eq('S1: the markup settles on the run',
  process_app_monetization('00000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001502',
    3, 'f0000000-0000-4000-8000-000000001501', '90000000-0000-4000-8000-000000001501', 5, 1, 2, NULL)::text, '3');
SELECT pg_temp.assert_eq('S1: a second settlement of the same run is a no-op',
  process_app_monetization('00000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001502',
    3, 'f0000000-0000-4000-8000-000000001501', '90000000-0000-4000-8000-000000001501', 55, 1, 2, NULL)::text, '0');
SELECT pg_temp.assert_eq('S1: the run''s total is not moved by the markup', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '55');

-- ---------------------------- S2: a run never retried shows its own spend
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001504', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'running', 'app_run', '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001502"}}'::jsonb);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001502', 'f0000000-0000-4000-8000-000000001501',
   'e0000000-0000-4000-8000-000000001504', '00000000-0000-4000-8000-000000001501');
UPDATE workflow_executions SET status = 'completed', total_credits_used = 40 WHERE id = 'e0000000-0000-4000-8000-000000001504';
SELECT pg_temp.assert_eq('S2: a run without a Retry is its execution''s spend', pg_temp.run_credits('90000000-0000-4000-8000-000000001502'), '40');
SELECT pg_temp.assert_eq('S2: analytics add it once',
  (SELECT total_credits::text FROM app_analytics WHERE app_id = 'f0000000-0000-4000-8000-000000001501'), '95');

-- ---------------------- S3: a start-over begins a chain of its own
-- The ordinary run of the run's id (the draft lane): stamped with the run, no resumedFrom.
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001505', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'pending', 'manual', '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001502"}}'::jsonb);
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001505', status = 'running'
 WHERE id = '90000000-0000-4000-8000-000000001502';
SELECT pg_temp.assert_eq('S3: a start-over starts at its own (zero) spend', pg_temp.run_credits('90000000-0000-4000-8000-000000001502'), '0');
UPDATE workflow_executions SET status = 'completed', total_credits_used = 9 WHERE id = 'e0000000-0000-4000-8000-000000001505';
SELECT pg_temp.assert_eq('S3: a start-over is its own spend only', pg_temp.run_credits('90000000-0000-4000-8000-000000001502'), '9');

-- An earlier attempt whose spend changes after the pointer moved past it:
-- its run is re-totalled from its pointer, which no longer includes it.
UPDATE workflow_executions SET total_credits_used = 41 WHERE id = 'e0000000-0000-4000-8000-000000001504';
SELECT pg_temp.assert_eq('S3: an attempt outside the current chain is not summed', pg_temp.run_credits('90000000-0000-4000-8000-000000001502'), '9');

-- ------------- S4: a link on a lane that does not write stamps is not followed
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, total_credits_used) VALUES
  ('e0000000-0000-4000-8000-000000001506', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'failed', 'app_run', 100);
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001507', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'running', 'webhook',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001503", "resumedFrom": "e0000000-0000-4000-8000-000000001506"}}'::jsonb);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001503', 'f0000000-0000-4000-8000-000000001501',
   'e0000000-0000-4000-8000-000000001507', '00000000-0000-4000-8000-000000001501');
UPDATE workflow_executions SET status = 'completed', total_credits_used = 7 WHERE id = 'e0000000-0000-4000-8000-000000001507';
SELECT pg_temp.assert_eq('S4: a webhook row''s posted stamp links nothing', pg_temp.run_credits('90000000-0000-4000-8000-000000001503'), '7');

-- ------------------- S5: another user's execution is never summed
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, total_credits_used) VALUES
  ('e0000000-0000-4000-8000-000000001508', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001503',
   'failed', 'app_run', 70);
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001509', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'running', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001504", "resumedFrom": "e0000000-0000-4000-8000-000000001508"}}'::jsonb);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001504', 'f0000000-0000-4000-8000-000000001501',
   'e0000000-0000-4000-8000-000000001509', '00000000-0000-4000-8000-000000001501');
UPDATE workflow_executions SET status = 'completed', total_credits_used = 6 WHERE id = 'e0000000-0000-4000-8000-000000001509';
SELECT pg_temp.assert_eq('S5: another user''s execution is not summed', pg_temp.run_credits('90000000-0000-4000-8000-000000001504'), '6');

-- ------------------- S6: a stamp naming ANOTHER run links nothing
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001510', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'running', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001502", "resumedFrom": "e0000000-0000-4000-8000-000000001504"}}'::jsonb);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001505', 'f0000000-0000-4000-8000-000000001501',
   'e0000000-0000-4000-8000-000000001510', '00000000-0000-4000-8000-000000001501');
UPDATE workflow_executions SET status = 'completed', total_credits_used = 4 WHERE id = 'e0000000-0000-4000-8000-000000001510';
SELECT pg_temp.assert_eq('S6: a link stamped for another run is not followed', pg_temp.run_credits('90000000-0000-4000-8000-000000001505'), '4');
SELECT pg_temp.assert_eq('S6: the run the stamp names is re-totalled from its own pointer', pg_temp.run_credits('90000000-0000-4000-8000-000000001502'), '9');

-- ------------------- S7: a malformed link never fails the write
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data) VALUES
  ('e0000000-0000-4000-8000-000000001511', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'running', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001506", "resumedFrom": "not-a-uuid"}}'::jsonb);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001506', 'f0000000-0000-4000-8000-000000001501',
   'e0000000-0000-4000-8000-000000001511', '00000000-0000-4000-8000-000000001501');
UPDATE workflow_executions SET status = 'failed', total_credits_used = 3 WHERE id = 'e0000000-0000-4000-8000-000000001511';
SELECT pg_temp.assert_eq('S7: the execution''s terminal write landed',
  (SELECT status FROM workflow_executions WHERE id = 'e0000000-0000-4000-8000-000000001511'), 'failed');
SELECT pg_temp.assert_eq('S7: a malformed link is its own spend', pg_temp.run_credits('90000000-0000-4000-8000-000000001506'), '3');

-- A cycle (two Retries naming each other) ends the walk.
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data, total_credits_used) VALUES
  ('e0000000-0000-4000-8000-000000001512', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'failed', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001507", "resumedFrom": "e0000000-0000-4000-8000-000000001513"}}'::jsonb, 2),
  ('e0000000-0000-4000-8000-000000001513', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'failed', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001507", "resumedFrom": "e0000000-0000-4000-8000-000000001512"}}'::jsonb, 1);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001507', 'f0000000-0000-4000-8000-000000001501',
   'e0000000-0000-4000-8000-000000001512', '00000000-0000-4000-8000-000000001501');
SELECT pg_temp.assert_eq('S7: a cycle is summed once', pg_temp.run_credits('90000000-0000-4000-8000-000000001507'), '3');

-- ------------------- S8: a link to another workflow's execution is not followed
INSERT INTO workflows (id, project_id, user_id, name) VALUES
  ('d0000000-0000-4000-8000-000000001502', 'c0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001502', 'Other Workflow');
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, total_credits_used) VALUES
  ('e0000000-0000-4000-8000-000000001514', 'd0000000-0000-4000-8000-000000001502', '00000000-0000-4000-8000-000000001501',
   'failed', 'app_run', 60);
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data, total_credits_used) VALUES
  ('e0000000-0000-4000-8000-000000001515', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'completed', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001508", "resumedFrom": "e0000000-0000-4000-8000-000000001514"}}'::jsonb, 2);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001508', 'f0000000-0000-4000-8000-000000001501', 'e0000000-0000-4000-8000-000000001515', '00000000-0000-4000-8000-000000001501');
SELECT pg_temp.assert_eq('S8: another workflow''s execution is not summed', pg_temp.run_credits('90000000-0000-4000-8000-000000001508'), '2');

-- ------- S9: a root with no app-run stamp (a run from before the stamp) is summed through the link
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, total_credits_used) VALUES
  ('e0000000-0000-4000-8000-000000001516', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501', 'failed', 'manual', 25);
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data, total_credits_used) VALUES
  ('e0000000-0000-4000-8000-000000001517', 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501',
   'completed', 'app_run',
   '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001509", "resumedFrom": "e0000000-0000-4000-8000-000000001516"}}'::jsonb, 4);
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001509', 'f0000000-0000-4000-8000-000000001501', 'e0000000-0000-4000-8000-000000001517', '00000000-0000-4000-8000-000000001501');
SELECT pg_temp.assert_eq('S9: an unstamped root is summed through the Retry''s link', pg_temp.run_credits('90000000-0000-4000-8000-000000001509'), '29');

-- ------------------- S10: a value sent on INSERT is replaced by the chain total
INSERT INTO app_runs (id, app_id, execution_id, runner_id, credits_used) VALUES
  ('90000000-0000-4000-8000-000000001510', 'f0000000-0000-4000-8000-000000001501', 'e0000000-0000-4000-8000-000000001516', '00000000-0000-4000-8000-000000001501', 999);
SELECT pg_temp.assert_eq('S10: an INSERT''s own credits_used is replaced by the total', pg_temp.run_credits('90000000-0000-4000-8000-000000001510'), '25');

-- ------------------- S11: the walk stops after 100 attempts
INSERT INTO workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data, total_credits_used)
SELECT ('e1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'd0000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501', 'failed', 'app_run',
       CASE WHEN i = 1
         THEN jsonb_build_object('appRun', jsonb_build_object('appRunId', '90000000-0000-4000-8000-000000001511'))
         ELSE jsonb_build_object('appRun', jsonb_build_object('appRunId', '90000000-0000-4000-8000-000000001511',
                'resumedFrom', 'e1000000-0000-4000-8000-' || lpad((i - 1)::text, 12, '0')))
       END,
       1
  FROM generate_series(1, 150) AS i;
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001511', 'f0000000-0000-4000-8000-000000001501', 'e1000000-0000-4000-8000-000000000150', '00000000-0000-4000-8000-000000001501');
SELECT pg_temp.assert_eq('S11: a chain of 150 attempts is summed to its 100 newest', pg_temp.run_credits('90000000-0000-4000-8000-000000001511'), '100');

-- ------------------- S12: a pointer cleared to NULL keeps the value it is given
UPDATE app_runs SET execution_id = NULL, status = 'draft' WHERE id = '90000000-0000-4000-8000-000000001506';
SELECT pg_temp.assert_eq('S12: a cleared pointer keeps the run''s value', pg_temp.run_credits('90000000-0000-4000-8000-000000001506'), '3');
UPDATE app_runs SET execution_id = NULL, status = 'draft', credits_used = 0 WHERE id = '90000000-0000-4000-8000-000000001507';
SELECT pg_temp.assert_eq('S12: a cleared pointer takes an explicit value', pg_temp.run_credits('90000000-0000-4000-8000-000000001507'), '0');

-- ------------------------------------------------- the backfill's formula
-- The migration's backfill runs this same helper; a run whose stored value
-- predates it is brought to its chain total.
UPDATE app_runs SET credits_used = 0 WHERE id = '90000000-0000-4000-8000-000000001501';
UPDATE public.app_runs ar SET credits_used = public.app_run_credits_total(ar.id, ar.runner_id, ar.execution_id)
 WHERE ar.id = '90000000-0000-4000-8000-000000001501';
SELECT pg_temp.assert_eq('backfill: the helper gives the chain total', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '55');
SELECT pg_temp.assert_eq('helper: no pointer is unknown (NULL), never 0',
  coalesce(public.app_run_credits_total('90000000-0000-4000-8000-000000001501', '00000000-0000-4000-8000-000000001501', NULL)::text, '<null>'), '<null>');
SELECT pg_temp.assert_eq('helper: a pointer that is not the runner''s is unknown (NULL)',
  coalesce(public.app_run_credits_total('90000000-0000-4000-8000-000000001504', '00000000-0000-4000-8000-000000001501',
    'e0000000-0000-4000-8000-000000001508')::text, '<null>'), '<null>');

-- ------------------------------------------------------------------- grants
SELECT pg_temp.assert_eq('anon cannot execute the helper',
  has_function_privilege('anon', 'public.app_run_credits_total(uuid,uuid,uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot execute the helper',
  has_function_privilege('authenticated', 'public.app_run_credits_total(uuid,uuid,uuid)', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('every new function pins its search_path',
  (SELECT count(*)::text FROM pg_proc
    WHERE proname IN ('app_run_credits_total', 'app_run_credits_on_execution_spend', 'app_run_credits_on_pointer')
      AND array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%'), '3');
SELECT pg_temp.assert_eq('the analytics trigger keeps its search_path pin',
  (SELECT count(*)::text FROM pg_proc
    WHERE proname = 'update_app_analytics' AND array_to_string(proconfig, ',') LIKE '%search_path=public%'), '1');
SELECT pg_temp.assert_eq('app_runs keeps RLS',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.app_runs'::regclass), 'true');

-- --------------------------- S13: neither trigger can fail the write it rides on
-- The helper is replaced, for the rest of this rolled-back transaction, by one
-- that always raises: both triggers must catch it, warn, and leave the column.
CREATE OR REPLACE FUNCTION public.app_run_credits_total(p_run_id uuid, p_runner_id uuid, p_execution_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'forced failure (behavior proof)'; END $$;

UPDATE workflow_executions SET total_credits_used = 6 WHERE id = 'e0000000-0000-4000-8000-000000001503';
SELECT pg_temp.assert_eq('S13: the execution''s spend write landed despite the failing total',
  (SELECT total_credits_used::text FROM workflow_executions WHERE id = 'e0000000-0000-4000-8000-000000001503'), '6');
SELECT pg_temp.assert_eq('S13: the run keeps its last total', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '55');

UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001502' WHERE id = '90000000-0000-4000-8000-000000001501';
SELECT pg_temp.assert_eq('S13: the pointer move landed despite the failing total',
  (SELECT execution_id::text FROM app_runs WHERE id = '90000000-0000-4000-8000-000000001501'), 'e0000000-0000-4000-8000-000000001502');
SELECT pg_temp.assert_eq('S13: the moved run keeps its value', pg_temp.run_credits('90000000-0000-4000-8000-000000001501'), '55');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
