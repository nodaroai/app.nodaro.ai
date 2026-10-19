-- ============================================================================
-- Behavioral proof — 538_app_analytics_one_run.sql + 539_app_analytics_one_run_backfill.sql
-- ============================================================================
-- Runs after the full migration chain (CI: migration-behavior job), as
-- `postgres`, inside a transaction it rolls back. Its own uuid range
-- (...-000000001601 upward). Each scenario runs on an app of its own, so its
-- counts are its alone. The assertions that matter most:
--   * a run that fails and then completes on Retry is ONE successful run, and
--     its credits are each attempt's own spend, once;
--   * a Retry of a Retry, and a Retry refused before it started, add no run;
--   * a Retry that ends on a later day moves the outcome on the day the run
--     was counted, and puts its spend on its own day;
--   * a start-over is a new run;
--   * the same execution ending twice is counted once, its spend once;
--   * the count is the same whichever write lands first (spend, status);
--   * only a trusted Retry stamp naming THIS run makes the same run;
--   * a run counted before 538 is not counted again by its next Retry;
--   * the backfill recounts the runs already counted more than once, once,
--     and a second pass changes nothing;
--   * the backfill counts each pre-538 attempt with the status it was counted
--     with (a Retry's source as failed), day by day, and leaves a run whose
--     first attempt ended after 538;
--   * counting can never fail the status write it rides on, and a Retry
--     after such a lost count is a new run that takes no other run's outcome;
--   * the functions are no client's to call; the new columns are server-only.
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

-- An app's counts over all its days.
CREATE FUNCTION pg_temp.counts(p_app uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(sum(total_runs), 0) || ' runs, ' || COALESCE(sum(successful_runs), 0) || ' ok, '
      || COALESCE(sum(failed_runs), 0) || ' failed, ' || COALESCE(sum(total_credits), 0) || ' credits'
    FROM public.app_analytics WHERE app_id = p_app
$$;

-- An app's counts on one day.
CREATE FUNCTION pg_temp.day_counts(p_app uuid, p_day date) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE((
    SELECT total_runs || ' runs, ' || successful_runs || ' ok, ' || failed_runs || ' failed, ' || total_credits || ' credits'
      FROM public.app_analytics WHERE app_id = p_app AND date = p_day), 'no row')
$$;

-- What a run is counted as.
CREATE FUNCTION pg_temp.run_state(p_run uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE((CURRENT_DATE - analytics_counted_on)::text, '-') || ' days ago, '
      || COALESCE(analytics_outcome, '-') || ', '
      || COALESCE(right(analytics_execution_id::text, 4), '-') || ', '
      || COALESCE(analytics_execution_credits::text, '-')
    FROM public.app_runs WHERE id = p_run
$$;

-- An attempt, as the lanes start one (pending). The runner is ...1601.
CREATE FUNCTION pg_temp.attempt(p_id uuid, p_wf int, p_type text, p_data jsonb) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.workflow_executions (id, workflow_id, user_id, status, trigger_type, trigger_data)
  VALUES (p_id, ('d0000000-0000-4000-8000-0000000016' || lpad(p_wf::text, 2, '0'))::uuid,
          '00000000-0000-4000-8000-000000001601', 'pending', p_type, p_data)
$$;

-- An attempt ends: the orchestrator writes its status and its spend in one UPDATE.
CREATE FUNCTION pg_temp.finish(p_id uuid, p_status text, p_credits int) RETURNS void
LANGUAGE sql AS $$
  UPDATE public.workflow_executions
     SET status = p_status, total_credits_used = p_credits, completed_at = now()
   WHERE id = p_id
$$;

CREATE FUNCTION pg_temp.app(p_n int) RETURNS uuid
LANGUAGE sql AS $$ SELECT ('f0000000-0000-4000-8000-0000000016' || lpad(p_n::text, 2, '0'))::uuid $$;

-- ---------------------------------------------------------------- fixtures
-- runner (r) runs the apps; creator (c) made them.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000001601', 'one-run-runner@example.com'),
  ('00000000-0000-4000-8000-000000001602', 'one-run-creator@example.com');
INSERT INTO projects (id, user_id, name) VALUES
  ('c0000000-0000-4000-8000-000000001601', '00000000-0000-4000-8000-000000001602', 'One Run Project');

-- One workflow and one app per scenario (01 .. 23).
DO $$
BEGIN
  FOR i IN 1..23 LOOP
    INSERT INTO workflows (id, project_id, user_id, name) VALUES
      (('d0000000-0000-4000-8000-0000000016' || lpad(i::text, 2, '0'))::uuid,
       'c0000000-0000-4000-8000-000000001601', '00000000-0000-4000-8000-000000001602', 'One Run Workflow ' || i);
    INSERT INTO published_apps (id, workflow_id, creator_id, version, slug, name, snapshot_nodes, snapshot_edges) VALUES
      (pg_temp.app(i), ('d0000000-0000-4000-8000-0000000016' || lpad(i::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-000000001602', 1, 'one-run-app-' || i, 'One Run App ' || i, '[]'::jsonb, '[]'::jsonb);
  END LOOP;
END $$;

-- ------------------------------ A: fails, then completes on Retry (app 01)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001601', 1, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001601"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001601', pg_temp.app(1), 'e0000000-0000-4000-8000-000000001601', '00000000-0000-4000-8000-000000001601');
UPDATE workflow_executions SET status = 'running' WHERE id = 'e0000000-0000-4000-8000-000000001601';
SELECT pg_temp.assert_eq('A: a running attempt counts nothing yet', pg_temp.counts(pg_temp.app(1)), '0 runs, 0 ok, 0 failed, 0 credits');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001601', 'failed', 30);
SELECT pg_temp.assert_eq('A: the failed attempt is one failed run', pg_temp.counts(pg_temp.app(1)), '1 runs, 0 ok, 1 failed, 30 credits');
SELECT pg_temp.assert_eq('A: the run records what it is counted as', pg_temp.run_state('90000000-0000-4000-8000-000000001601'), '0 days ago, failed, 1601, 30');

-- The Retry (routes/app-run-resume.ts): stamped with the run and the attempt it continues; the pointer moves to it.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001602', 1, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001601", "resumedFrom": "e0000000-0000-4000-8000-000000001601"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001602', status = 'running' WHERE id = '90000000-0000-4000-8000-000000001601';
UPDATE workflow_executions SET status = 'running' WHERE id = 'e0000000-0000-4000-8000-000000001602';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001602', 'completed', 20);
SELECT pg_temp.assert_eq('A: a run that fails then completes on Retry is one successful run',
  pg_temp.counts(pg_temp.app(1)), '1 runs, 1 ok, 0 failed, 50 credits');
SELECT pg_temp.assert_eq('A: the run is counted as its Retry''s outcome', pg_temp.run_state('90000000-0000-4000-8000-000000001601'), '0 days ago, completed, 1602, 20');
SELECT pg_temp.assert_eq('A: the run''s credit total (537) is untouched',
  (SELECT credits_used::text FROM app_runs WHERE id = '90000000-0000-4000-8000-000000001601'), '50');

-- ----------------------- B: a Retry of a Retry: three attempts, one run (app 02)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001611', 2, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001611"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001611', pg_temp.app(2), 'e0000000-0000-4000-8000-000000001611', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001611', 'failed', 30);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001612', 2, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001611", "resumedFrom": "e0000000-0000-4000-8000-000000001611"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001612' WHERE id = '90000000-0000-4000-8000-000000001611';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001612', 'failed', 20);
SELECT pg_temp.assert_eq('B: a failed Retry of a failed run is still one failed run',
  pg_temp.counts(pg_temp.app(2)), '1 runs, 0 ok, 1 failed, 50 credits');
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001613', 2, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001611", "resumedFrom": "e0000000-0000-4000-8000-000000001612"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001613' WHERE id = '90000000-0000-4000-8000-000000001611';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001613', 'completed', 5);
SELECT pg_temp.assert_eq('B: three attempts are one successful run, each attempt''s spend once (30 + 20 + 5)',
  pg_temp.counts(pg_temp.app(2)), '1 runs, 1 ok, 0 failed, 55 credits');

-- ------------- C: a Retry refused before it started, then a Retry (app 03)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001621', 3, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001621"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001621', pg_temp.app(3), 'e0000000-0000-4000-8000-000000001621', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001621', 'failed', 10);
-- Refused at pickup: it fails without starting, having spent nothing.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001622', 3, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001621", "resumedFrom": "e0000000-0000-4000-8000-000000001621"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001622' WHERE id = '90000000-0000-4000-8000-000000001621';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001622', 'failed', 0);
SELECT pg_temp.assert_eq('C: a Retry refused before it started adds no run',
  pg_temp.counts(pg_temp.app(3)), '1 runs, 0 ok, 1 failed, 10 credits');
-- The next Retry steps over it (lib/app-run-resume.ts resumeSource): it continues the first attempt.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001623', 3, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001621", "resumedFrom": "e0000000-0000-4000-8000-000000001621"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001623' WHERE id = '90000000-0000-4000-8000-000000001621';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001623', 'completed', 5);
SELECT pg_temp.assert_eq('C: a Retry that stepped over a refused one completes the same run',
  pg_temp.counts(pg_temp.app(3)), '1 runs, 1 ok, 0 failed, 15 credits');

-- --------------------- D: a Retry that ends on a later day (app 04)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001631', 4, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001631"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001631', pg_temp.app(4), 'e0000000-0000-4000-8000-000000001631', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001631', 'failed', 10);
-- As if that was yesterday: its row and the run's counted day go back one day.
UPDATE app_analytics SET date = CURRENT_DATE - 1 WHERE app_id = pg_temp.app(4);
UPDATE app_runs SET analytics_counted_on = CURRENT_DATE - 1 WHERE id = '90000000-0000-4000-8000-000000001631';
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001632', 4, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001631", "resumedFrom": "e0000000-0000-4000-8000-000000001631"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001632' WHERE id = '90000000-0000-4000-8000-000000001631';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001632', 'completed', 7);
SELECT pg_temp.assert_eq('D: the outcome moves on the day the run was counted',
  pg_temp.day_counts(pg_temp.app(4), CURRENT_DATE - 1), '1 runs, 1 ok, 0 failed, 10 credits');
SELECT pg_temp.assert_eq('D: the Retry''s spend is on the day it ended, with no run',
  pg_temp.day_counts(pg_temp.app(4), CURRENT_DATE), '0 runs, 0 ok, 0 failed, 7 credits');
SELECT pg_temp.assert_eq('D: the run keeps its counted day', pg_temp.run_state('90000000-0000-4000-8000-000000001631'), '1 days ago, completed, 1632, 7');

-- ----------------------------------- E: a start-over is a new run (app 05)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001641', 5, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001641"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001641', pg_temp.app(5), 'e0000000-0000-4000-8000-000000001641', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001641', 'failed', 10);
-- The ordinary run of the run's id (the draft lane): stamped with the run, no resumedFrom.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001642', 5, 'manual',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001641"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001642' WHERE id = '90000000-0000-4000-8000-000000001641';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001642', 'completed', 4);
SELECT pg_temp.assert_eq('E: a start-over is a new run',
  pg_temp.counts(pg_temp.app(5)), '2 runs, 1 ok, 1 failed, 14 credits');

-- -------------------- F: the same execution ends twice (app 06)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001651', 6, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001651"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001651', pg_temp.app(6), 'e0000000-0000-4000-8000-000000001651', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001651', 'failed', 10);
UPDATE workflow_executions SET status = 'running' WHERE id = 'e0000000-0000-4000-8000-000000001651';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001651', 'completed', 12);
SELECT pg_temp.assert_eq('F: an execution that ends twice is one run, by its last end, its spend once',
  pg_temp.counts(pg_temp.app(6)), '1 runs, 1 ok, 0 failed, 12 credits');

-- -------------------- G: whichever write lands first (apps 07, 08)
-- The spend first (a level's write), then the status.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001661', 7, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001661"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001661', pg_temp.app(7), 'e0000000-0000-4000-8000-000000001661', '00000000-0000-4000-8000-000000001601');
UPDATE workflow_executions SET status = 'running', total_credits_used = 9 WHERE id = 'e0000000-0000-4000-8000-000000001661';
UPDATE workflow_executions SET status = 'completed', completed_at = now() WHERE id = 'e0000000-0000-4000-8000-000000001661';
SELECT pg_temp.assert_eq('G: spend then status: one run, its spend once',
  pg_temp.counts(pg_temp.app(7)), '1 runs, 1 ok, 0 failed, 9 credits');
-- The status first, then a later write of the spend.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001662', 8, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001662"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001662', pg_temp.app(8), 'e0000000-0000-4000-8000-000000001662', '00000000-0000-4000-8000-000000001601');
UPDATE workflow_executions SET status = 'failed', completed_at = now() WHERE id = 'e0000000-0000-4000-8000-000000001662';
UPDATE workflow_executions SET total_credits_used = 3 WHERE id = 'e0000000-0000-4000-8000-000000001662';
SELECT pg_temp.assert_eq('G: status then spend: one run, counted once (credits as at its end, as before)',
  pg_temp.counts(pg_temp.app(8)), '1 runs, 0 ok, 1 failed, 0 credits');
SELECT pg_temp.assert_eq('G: the run''s own credit total still follows the late spend (537)',
  (SELECT credits_used::text FROM app_runs WHERE id = '90000000-0000-4000-8000-000000001662'), '3');

-- ---------- H: only a trusted Retry stamp naming THIS run is the same run (apps 09, 10)
-- A webhook row stores the body its caller posted: its stamp is not the platform's.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001671', 9, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001671"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001671', pg_temp.app(9), 'e0000000-0000-4000-8000-000000001671', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001671', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001672', 9, 'webhook',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001671", "resumedFrom": "e0000000-0000-4000-8000-000000001671"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001672' WHERE id = '90000000-0000-4000-8000-000000001671';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001672', 'completed', 4);
SELECT pg_temp.assert_eq('H: a webhook row''s posted Retry stamp is a new run',
  pg_temp.counts(pg_temp.app(9)), '2 runs, 1 ok, 1 failed, 14 credits');
-- A Retry stamp naming another run.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001673', 10, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001673"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001673', pg_temp.app(10), 'e0000000-0000-4000-8000-000000001673', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001673', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001674', 10, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001679", "resumedFrom": "e0000000-0000-4000-8000-000000001673"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001674' WHERE id = '90000000-0000-4000-8000-000000001673';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001674', 'completed', 4);
SELECT pg_temp.assert_eq('H: a Retry stamp naming another run is a new run',
  pg_temp.counts(pg_temp.app(10)), '2 runs, 1 ok, 1 failed, 14 credits');

-- ------------- I: a run counted before 538, retried after it (app 11)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001681', 11, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001681"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001681', pg_temp.app(11), 'e0000000-0000-4000-8000-000000001681', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001681', 'failed', 10);
-- As 045/469/537 left it, yesterday: the run records nothing, the attempt ended yesterday.
UPDATE app_runs SET analytics_counted_on = NULL, analytics_outcome = NULL, analytics_execution_id = NULL, analytics_execution_credits = NULL
 WHERE id = '90000000-0000-4000-8000-000000001681';
UPDATE workflow_executions SET completed_at = now() - interval '1 day' WHERE id = 'e0000000-0000-4000-8000-000000001681';
UPDATE app_analytics SET date = CURRENT_DATE - 1 WHERE app_id = pg_temp.app(11);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001682', 11, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001681", "resumedFrom": "e0000000-0000-4000-8000-000000001681"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001682' WHERE id = '90000000-0000-4000-8000-000000001681';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001682', 'completed', 5);
SELECT pg_temp.assert_eq('I: a Retry of a run counted before 538 moves that count''s outcome, on its day',
  pg_temp.day_counts(pg_temp.app(11), CURRENT_DATE - 1), '1 runs, 1 ok, 0 failed, 10 credits');
SELECT pg_temp.assert_eq('I: and adds its spend on its own day, with no run',
  pg_temp.day_counts(pg_temp.app(11), CURRENT_DATE), '0 runs, 0 ok, 0 failed, 5 credits');
SELECT pg_temp.assert_eq('I: the run now records what it is counted as', pg_temp.run_state('90000000-0000-4000-8000-000000001681'), '1 days ago, completed, 1682, 5');

-- -------- J: the backfill recounts runs counted more than once (apps 12, 13, 22, 23)
-- A day N days ago, at an hour (always inside that day).
CREATE FUNCTION pg_temp.at(p_days int, p_hour int) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT (CURRENT_DATE - p_days)::timestamptz + make_interval(hours => p_hour) $$;

-- J1: a finished Retry chain over three days, as 045/469/537 counted it (four
-- runs): the first attempt failed (10, three days ago), its Retry failed (5,
-- two days ago), a Retry refused before it started (0, two days ago), then a
-- Retry of the first Retry completed (7, yesterday). The first attempt was
-- later rewritten `completed` while the run pointed elsewhere (a reconcile
-- race): that write was never counted, so it still counts as failed.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001691', 12, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001691"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001691', pg_temp.app(12), 'e0000000-0000-4000-8000-000000001691', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001691', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001692', 12, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001691", "resumedFrom": "e0000000-0000-4000-8000-000000001691"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001692' WHERE id = '90000000-0000-4000-8000-000000001691';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001692', 'failed', 5);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001693', 12, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001691", "resumedFrom": "e0000000-0000-4000-8000-000000001692"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001693' WHERE id = '90000000-0000-4000-8000-000000001691';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001693', 'failed', 0);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001694', 12, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001691", "resumedFrom": "e0000000-0000-4000-8000-000000001692"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001694' WHERE id = '90000000-0000-4000-8000-000000001691';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001694', 'completed', 7);
UPDATE workflow_executions SET status = 'completed' WHERE id = 'e0000000-0000-4000-8000-000000001691';
UPDATE workflow_executions SET created_at = pg_temp.at(3, 9), completed_at = pg_temp.at(3, 10) WHERE id = 'e0000000-0000-4000-8000-000000001691';
UPDATE workflow_executions SET created_at = pg_temp.at(2, 9), completed_at = pg_temp.at(2, 10) WHERE id = 'e0000000-0000-4000-8000-000000001692';
UPDATE workflow_executions SET created_at = pg_temp.at(2, 11), completed_at = pg_temp.at(2, 11) WHERE id = 'e0000000-0000-4000-8000-000000001693';
UPDATE workflow_executions SET created_at = pg_temp.at(1, 9), completed_at = pg_temp.at(1, 10) WHERE id = 'e0000000-0000-4000-8000-000000001694';
DELETE FROM app_analytics WHERE app_id = pg_temp.app(12);
INSERT INTO app_analytics (app_id, date, total_runs, unique_runners, total_credits, successful_runs, failed_runs) VALUES
  (pg_temp.app(12), CURRENT_DATE - 3, 1, 1, 10, 0, 1),
  (pg_temp.app(12), CURRENT_DATE - 2, 2, 1, 5, 0, 2),
  (pg_temp.app(12), CURRENT_DATE - 1, 1, 1, 7, 1, 0);
UPDATE app_runs SET analytics_counted_on = NULL, analytics_outcome = NULL, analytics_execution_id = NULL, analytics_execution_credits = NULL
 WHERE id = '90000000-0000-4000-8000-000000001691';
SELECT pg_temp.assert_eq('J1: before the backfill, the old count (four runs)',
  pg_temp.counts(pg_temp.app(12)), '4 runs, 1 ok, 3 failed, 22 credits');

-- J2: a Retry still running at the migration, after a failed first attempt
-- (10, two days ago) and a failed Retry (5, yesterday): two runs, as counted before.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001701', 13, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001701"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001701', pg_temp.app(13), 'e0000000-0000-4000-8000-000000001701', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001701', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001702', 13, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001701", "resumedFrom": "e0000000-0000-4000-8000-000000001701"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001702' WHERE id = '90000000-0000-4000-8000-000000001701';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001702', 'failed', 5);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001703', 13, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001701", "resumedFrom": "e0000000-0000-4000-8000-000000001702"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001703' WHERE id = '90000000-0000-4000-8000-000000001701';
UPDATE workflow_executions SET status = 'running' WHERE id = 'e0000000-0000-4000-8000-000000001703';
UPDATE workflow_executions SET created_at = pg_temp.at(2, 9), completed_at = pg_temp.at(2, 10) WHERE id = 'e0000000-0000-4000-8000-000000001701';
UPDATE workflow_executions SET created_at = pg_temp.at(1, 9), completed_at = pg_temp.at(1, 10) WHERE id = 'e0000000-0000-4000-8000-000000001702';
DELETE FROM app_analytics WHERE app_id = pg_temp.app(13);
INSERT INTO app_analytics (app_id, date, total_runs, unique_runners, total_credits, successful_runs, failed_runs) VALUES
  (pg_temp.app(13), CURRENT_DATE - 2, 1, 1, 10, 0, 1),
  (pg_temp.app(13), CURRENT_DATE - 1, 1, 1, 5, 0, 1);
UPDATE app_runs SET analytics_counted_on = NULL, analytics_outcome = NULL, analytics_execution_id = NULL, analytics_execution_credits = NULL
 WHERE id = '90000000-0000-4000-8000-000000001701';

-- J4: a run whose first attempt ended AFTER 538 but recorded nothing (its
-- count was lost), with a Retry pending: never counted by the old rules, so
-- the backfill leaves it alone.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001741', 23, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001741"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001741', pg_temp.app(23), 'e0000000-0000-4000-8000-000000001741', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001741', 'failed', 10);
DELETE FROM app_analytics WHERE app_id = pg_temp.app(23);
UPDATE app_runs SET analytics_counted_on = NULL, analytics_outcome = NULL, analytics_execution_id = NULL, analytics_execution_credits = NULL
 WHERE id = '90000000-0000-4000-8000-000000001741';
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001742', 23, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001741", "resumedFrom": "e0000000-0000-4000-8000-000000001741"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001742' WHERE id = '90000000-0000-4000-8000-000000001741';

-- J3: two runs of ONE app, each failed two days ago and completed on Retry
-- yesterday: their changes land on the same day rows, applied once per row.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001731', 22, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001731"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001731', pg_temp.app(22), 'e0000000-0000-4000-8000-000000001731', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001731', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001732', 22, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001731", "resumedFrom": "e0000000-0000-4000-8000-000000001731"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001732' WHERE id = '90000000-0000-4000-8000-000000001731';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001732', 'completed', 2);
UPDATE workflow_executions SET created_at = pg_temp.at(2, 9), completed_at = pg_temp.at(2, 10) WHERE id = 'e0000000-0000-4000-8000-000000001731';
UPDATE workflow_executions SET created_at = pg_temp.at(1, 9), completed_at = pg_temp.at(1, 10) WHERE id = 'e0000000-0000-4000-8000-000000001732';
UPDATE app_runs SET analytics_counted_on = NULL, analytics_outcome = NULL, analytics_execution_id = NULL, analytics_execution_credits = NULL
 WHERE id = '90000000-0000-4000-8000-000000001731';
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001733', 22, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001733"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001733', pg_temp.app(22), 'e0000000-0000-4000-8000-000000001733', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001733', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001734', 22, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001733", "resumedFrom": "e0000000-0000-4000-8000-000000001733"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001734' WHERE id = '90000000-0000-4000-8000-000000001733';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001734', 'completed', 2);
UPDATE workflow_executions SET created_at = pg_temp.at(2, 9), completed_at = pg_temp.at(2, 10) WHERE id = 'e0000000-0000-4000-8000-000000001733';
UPDATE workflow_executions SET created_at = pg_temp.at(1, 9), completed_at = pg_temp.at(1, 10) WHERE id = 'e0000000-0000-4000-8000-000000001734';
UPDATE app_runs SET analytics_counted_on = NULL, analytics_outcome = NULL, analytics_execution_id = NULL, analytics_execution_credits = NULL
 WHERE id = '90000000-0000-4000-8000-000000001733';
DELETE FROM app_analytics WHERE app_id = pg_temp.app(22);
INSERT INTO app_analytics (app_id, date, total_runs, unique_runners, total_credits, successful_runs, failed_runs) VALUES
  (pg_temp.app(22), CURRENT_DATE - 2, 2, 1, 20, 0, 2),
  (pg_temp.app(22), CURRENT_DATE - 1, 2, 1, 4, 2, 0);

SELECT pg_temp.assert_eq('J: the backfill recounts the four runs counted more than once',
  public.app_analytics_recount_retried_runs()::text, '4');
SELECT pg_temp.assert_eq('J3: two runs of one app: their first day holds both, as successes',
  pg_temp.day_counts(pg_temp.app(22), CURRENT_DATE - 2), '2 runs, 2 ok, 0 failed, 20 credits');
SELECT pg_temp.assert_eq('J3: their Retries'' day holds no run',
  pg_temp.day_counts(pg_temp.app(22), CURRENT_DATE - 1), '0 runs, 0 ok, 0 failed, 4 credits');
SELECT pg_temp.assert_eq('J1: three days ago: the run, by its last attempt',
  pg_temp.day_counts(pg_temp.app(12), CURRENT_DATE - 3), '1 runs, 1 ok, 0 failed, 10 credits');
SELECT pg_temp.assert_eq('J1: two days ago: no run, the spend kept',
  pg_temp.day_counts(pg_temp.app(12), CURRENT_DATE - 2), '0 runs, 0 ok, 0 failed, 5 credits');
SELECT pg_temp.assert_eq('J1: yesterday: no run, the spend kept',
  pg_temp.day_counts(pg_temp.app(12), CURRENT_DATE - 1), '0 runs, 0 ok, 0 failed, 7 credits');
SELECT pg_temp.assert_eq('J1: a finished Retry chain is one run, by its last attempt, its credits untouched',
  pg_temp.counts(pg_temp.app(12)), '1 runs, 1 ok, 0 failed, 22 credits');
SELECT pg_temp.assert_eq('J1: the run records what it is counted as', pg_temp.run_state('90000000-0000-4000-8000-000000001691'), '3 days ago, completed, 1694, 7');
SELECT pg_temp.assert_eq('J2: a chain with a Retry still running is one failed run',
  pg_temp.counts(pg_temp.app(13)), '1 runs, 0 ok, 1 failed, 15 credits');
SELECT pg_temp.assert_eq('J2: counted on its first attempt''s day',
  pg_temp.run_state('90000000-0000-4000-8000-000000001701'), '2 days ago, failed, 1702, 5');
SELECT pg_temp.assert_eq('J4: a run whose first attempt ended after 538 is not recounted',
  pg_temp.run_state('90000000-0000-4000-8000-000000001741'), '- days ago, -, -, -');
SELECT pg_temp.assert_eq('J: a second backfill pass changes nothing',
  public.app_analytics_recount_retried_runs()::text, '0');
SELECT pg_temp.assert_eq('J1: a second pass leaves the count', pg_temp.counts(pg_temp.app(12)), '1 runs, 1 ok, 0 failed, 22 credits');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001703', 'completed', 3);
SELECT pg_temp.assert_eq('J2: the running Retry completes the recounted run, on its counted day',
  pg_temp.day_counts(pg_temp.app(13), CURRENT_DATE - 2), '1 runs, 1 ok, 0 failed, 10 credits');
SELECT pg_temp.assert_eq('J2: and its spend lands today',
  pg_temp.day_counts(pg_temp.app(13), CURRENT_DATE), '0 runs, 0 ok, 0 failed, 3 credits');

-- ---------------------------- K: what counts nothing (app 14)
-- A cancelled attempt.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001711', 14, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001711"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001711', pg_temp.app(14), 'e0000000-0000-4000-8000-000000001711', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001711', 'cancelled', 6);
-- An execution no run points at (a Render final, an editor run).
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001712', 14, 'manual', '{}');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001712', 'completed', 6);
SELECT pg_temp.assert_eq('K: a cancelled attempt and an execution outside any run count nothing',
  pg_temp.counts(pg_temp.app(14)), '0 runs, 0 ok, 0 failed, 0 credits');

-- ------------------- M: a Retry that spent nothing still moves the outcome (app 16)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001751', 16, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001751"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001751', pg_temp.app(16), 'e0000000-0000-4000-8000-000000001751', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001751', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001752', 16, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001751", "resumedFrom": "e0000000-0000-4000-8000-000000001751"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001752' WHERE id = '90000000-0000-4000-8000-000000001751';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001752', 'completed', 0);
SELECT pg_temp.assert_eq('M: a Retry that spent nothing completes the run',
  pg_temp.counts(pg_temp.app(16)), '1 runs, 1 ok, 0 failed, 10 credits');

-- ------------------------------ N: a Retry that ends twice (app 17)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001761', 17, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001761"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001761', pg_temp.app(17), 'e0000000-0000-4000-8000-000000001761', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001761', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001762', 17, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001761", "resumedFrom": "e0000000-0000-4000-8000-000000001761"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001762' WHERE id = '90000000-0000-4000-8000-000000001761';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001762', 'failed', 4);
UPDATE workflow_executions SET status = 'running' WHERE id = 'e0000000-0000-4000-8000-000000001762';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001762', 'completed', 6);
SELECT pg_temp.assert_eq('N: a Retry that ends twice is still one run, its spend once',
  pg_temp.counts(pg_temp.app(17)), '1 runs, 1 ok, 0 failed, 16 credits');

-- ------------------- O: a start-over after a Retry, and a Retry of it (app 18)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001771', 18, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001771"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001771', pg_temp.app(18), 'e0000000-0000-4000-8000-000000001771', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001771', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001772', 18, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001771", "resumedFrom": "e0000000-0000-4000-8000-000000001771"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001772' WHERE id = '90000000-0000-4000-8000-000000001771';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001772', 'failed', 2);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001773', 18, 'manual',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001771"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001773' WHERE id = '90000000-0000-4000-8000-000000001771';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001773', 'failed', 3);
SELECT pg_temp.assert_eq('O: a start-over after a Retry is a new run',
  pg_temp.counts(pg_temp.app(18)), '2 runs, 0 ok, 2 failed, 15 credits');
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001774', 18, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001771", "resumedFrom": "e0000000-0000-4000-8000-000000001773"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001774' WHERE id = '90000000-0000-4000-8000-000000001771';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001774', 'completed', 1);
SELECT pg_temp.assert_eq('O: a Retry of the start-over completes the start-over''s run',
  pg_temp.counts(pg_temp.app(18)), '2 runs, 1 ok, 1 failed, 16 credits');

-- ------------------- P: a cancelled Retry after a failure (app 19)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001781', 19, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001781"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001781', pg_temp.app(19), 'e0000000-0000-4000-8000-000000001781', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001781', 'failed', 10);
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001782', 19, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001781", "resumedFrom": "e0000000-0000-4000-8000-000000001781"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001782' WHERE id = '90000000-0000-4000-8000-000000001781';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001782', 'cancelled', 2);
SELECT pg_temp.assert_eq('P: a cancelled Retry leaves the run failed',
  pg_temp.counts(pg_temp.app(19)), '1 runs, 0 ok, 1 failed, 10 credits');
SELECT pg_temp.assert_eq('P: the run stays counted as its failure', pg_temp.run_state('90000000-0000-4000-8000-000000001781'), '0 days ago, failed, 1781, 10');

-- ------ Q: a Retry naming an attempt of another workflow is a new run (apps 20, 21)
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001791', 20, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001791"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001791', pg_temp.app(20), 'e0000000-0000-4000-8000-000000001791', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001791', 'failed', 10);
-- As before 538, yesterday.
UPDATE app_runs SET analytics_counted_on = NULL, analytics_outcome = NULL, analytics_execution_id = NULL, analytics_execution_credits = NULL
 WHERE id = '90000000-0000-4000-8000-000000001791';
UPDATE workflow_executions SET completed_at = now() - interval '1 day' WHERE id = 'e0000000-0000-4000-8000-000000001791';
UPDATE app_analytics SET date = CURRENT_DATE - 1 WHERE app_id = pg_temp.app(20);
-- The runner's failed execution of ANOTHER workflow, from before 538.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001793', 21, 'manual', '{}');
UPDATE workflow_executions SET status = 'failed', completed_at = now() - interval '1 day' WHERE id = 'e0000000-0000-4000-8000-000000001793';
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001792', 20, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001791", "resumedFrom": "e0000000-0000-4000-8000-000000001793"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001792' WHERE id = '90000000-0000-4000-8000-000000001791';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001792', 'completed', 4);
SELECT pg_temp.assert_eq('Q: a Retry naming another workflow''s attempt moves nothing',
  pg_temp.day_counts(pg_temp.app(20), CURRENT_DATE - 1), '1 runs, 0 ok, 1 failed, 10 credits');
SELECT pg_temp.assert_eq('Q: and is counted as a new run',
  pg_temp.day_counts(pg_temp.app(20), CURRENT_DATE), '1 runs, 1 ok, 0 failed, 4 credits');

-- ------------------------------------------------------------------- grants
SELECT pg_temp.assert_eq('anon cannot execute the analytics trigger function',
  has_function_privilege('anon', 'public.update_app_analytics()', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot execute the analytics trigger function',
  has_function_privilege('authenticated', 'public.update_app_analytics()', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('anon cannot execute the backfill',
  has_function_privilege('anon', 'public.app_analytics_recount_retried_runs()', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('authenticated cannot execute the backfill',
  has_function_privilege('authenticated', 'public.app_analytics_recount_retried_runs()', 'EXECUTE')::text, 'false');
SELECT pg_temp.assert_eq('no client can read the cutoff',
  (has_function_privilege('anon', 'public.app_analytics_one_run_since()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.app_analytics_one_run_since()', 'EXECUTE'))::text, 'false');
SELECT pg_temp.assert_eq('the cutoff is when 538 ran, before this proof',
  (public.app_analytics_one_run_since() <= now())::text, 'true');
SELECT pg_temp.assert_eq('every function pins its search_path',
  (SELECT count(*)::text FROM pg_proc
    WHERE proname IN ('update_app_analytics', 'app_analytics_recount_retried_runs', 'app_analytics_one_run_since')
      AND array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%'), '3');
SELECT pg_temp.assert_eq('the analytics trigger function stays SECURITY DEFINER',
  (SELECT prosecdef::text FROM pg_proc WHERE proname = 'update_app_analytics'), 'true');
SELECT pg_temp.assert_eq('no client can write what a run is counted as',
  (SELECT count(*)::text FROM unnest(ARRAY['analytics_counted_on', 'analytics_outcome', 'analytics_execution_id', 'analytics_execution_credits']) AS c
    WHERE has_column_privilege('authenticated', 'public.app_runs', c, 'UPDATE')
       OR has_column_privilege('anon', 'public.app_runs', c, 'UPDATE')), '0');
SELECT pg_temp.assert_eq('the outcome check was added without a scan (NOT VALID)',
  (SELECT convalidated::text FROM pg_constraint WHERE conname = 'app_runs_analytics_outcome_check'), 'false');
DO $$
BEGIN
  UPDATE public.app_runs SET analytics_outcome = 'cancelled' WHERE id = '90000000-0000-4000-8000-000000001601';
  RAISE EXCEPTION 'ASSERT FAIL [the outcome check refuses another value]: the write landed';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'ok  the outcome check refuses another value';
END $$;
SELECT pg_temp.assert_eq('app_runs keeps RLS',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.app_runs'::regclass), 'true');
SELECT pg_temp.assert_eq('app_analytics keeps RLS',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.app_analytics'::regclass), 'true');

-- ------------------- L: counting can never fail the status write (app 15)
-- Another run of the app fails and is counted.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001725', 15, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001725"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001725', pg_temp.app(15), 'e0000000-0000-4000-8000-000000001725', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001725', 'failed', 4);
-- For a moment, no app_analytics row can be written.
ALTER TABLE app_analytics ADD CONSTRAINT one_run_proof_block CHECK (total_runs < 0) NOT VALID;
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001721', 15, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001721"}}');
INSERT INTO app_runs (id, app_id, execution_id, runner_id) VALUES
  ('90000000-0000-4000-8000-000000001721', pg_temp.app(15), 'e0000000-0000-4000-8000-000000001721', '00000000-0000-4000-8000-000000001601');
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001721', 'failed', 6);
SELECT pg_temp.assert_eq('L: the status write landed although counting could not',
  (SELECT status FROM workflow_executions WHERE id = 'e0000000-0000-4000-8000-000000001721'), 'failed');
SELECT pg_temp.assert_eq('L: nothing was half-counted', pg_temp.counts(pg_temp.app(15)), '1 runs, 0 ok, 1 failed, 4 credits');
SELECT pg_temp.assert_eq('L: the run records nothing', pg_temp.run_state('90000000-0000-4000-8000-000000001721'), '- days ago, -, -, -');
ALTER TABLE app_analytics DROP CONSTRAINT one_run_proof_block;
-- Its Retry completes: the lost first count has nothing to move, so the
-- Retry is a new run, and the other run's failure stands.
SELECT pg_temp.attempt('e0000000-0000-4000-8000-000000001722', 15, 'app_run',
  '{"appRun": {"appRunId": "90000000-0000-4000-8000-000000001721", "resumedFrom": "e0000000-0000-4000-8000-000000001721"}}');
UPDATE app_runs SET execution_id = 'e0000000-0000-4000-8000-000000001722' WHERE id = '90000000-0000-4000-8000-000000001721';
SELECT pg_temp.finish('e0000000-0000-4000-8000-000000001722', 'completed', 5);
SELECT pg_temp.assert_eq('L: a Retry after a lost count is a new run and leaves the other run''s failure',
  pg_temp.counts(pg_temp.app(15)), '2 runs, 1 ok, 1 failed, 9 credits');

DO $$ BEGIN RAISE NOTICE 'ALL BEHAVIOR ASSERTIONS PASSED'; END $$;
ROLLBACK;
