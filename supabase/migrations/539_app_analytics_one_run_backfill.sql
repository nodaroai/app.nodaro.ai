-- Backfill for 538 (an app run counts once in its app's analytics): the
-- Retries counted before 538.
--
-- Its own migration, so it runs after 538 has committed and takes no table
-- lock beyond ROW SHARE on app_runs: it row-locks the runs it recounts and
-- the app_analytics rows it changes, until it commits.
--
-- Lock order (so it cannot deadlock with 538's trigger, which locks one run
-- row, then that app's row for today, then an older day's row):
--   1. every run it will recount, in id order, before anything is written;
--   2. the app_analytics rows, once, for all runs together, by app and then
--      newest day first.
-- A count for a run it recounts waits at step 1 holding no app_analytics
-- row; a count for any other run takes today's row before an older one, the
-- order step 2 takes them in.
--
-- Retries that continue a failed run reached production on 2026-10-19, so the
-- runs counted more than once are few: those whose pointer is a Retry. (A
-- "Retry" before then started the run over, which is a new run under 538's
-- rules too, so those counts already stand.) For each such run with nothing
-- recorded yet (no analytics_counted_on):
--   * its attempts are the chain 537 walks (the pointer, the attempt it
--     continued, and so on back to the first: the runner's own, of one
--     workflow, trusted links naming this run, at most 100), plus any Retry of
--     the run that was refused before it started (it ended failed while the
--     run pointed at it, and the next Retry stepped over it);
--   * each attempt counted before 538 (it ended before
--     app_analytics_one_run_since()) was counted as a run on the day it ended,
--     under the run's app version (a Retry never changes it; a start-over
--     would have begun another chain), and with the status it had then: every
--     attempt but the pointer was continued by a Retry, which is refused
--     unless that attempt failed, so it was counted FAILED whatever it reads
--     now; the pointer, still the run's, with the status it reads;
--   * the run is recounted as one: every attempt's count but the first is
--     taken back, and the first's outcome becomes the newest counted
--     attempt's;
--   * the run row records what it is counted as, so this never applies twice.
-- Credits are not touched: each attempt's own spend was already added once.
-- A run counted before 538 whose pointer is not a Retry needs nothing: its
-- next Retry reads the attempt it continued (538).
--
-- Re-runnable: CREATE OR REPLACE, and a pass that takes only runs with
-- nothing recorded.

CREATE OR REPLACE FUNCTION public.app_analytics_recount_retried_runs()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cut      timestamptz := public.app_analytics_one_run_since();
  v_runs_ids uuid[];
  v_run_id   uuid;
  v_run      record;
  v_id       uuid;
  v_row      record;
  v_next     text;
  v_seen     uuid[];
  v_workflow uuid;
  v_root     record;
  v_ids      uuid[];
  v_counted  text[];
  v_days     date[];
  v_credits  integer;
  -- Every run's changes, applied together at the end.
  v_d_app    uuid[] := ARRAY[]::uuid[];
  v_d_day    date[] := ARRAY[]::date[];
  v_d_runs   integer[] := ARRAY[]::integer[];
  v_d_ok     integer[] := ARRAY[]::integer[];
  v_d_failed integer[] := ARRAY[]::integer[];
  v_delta    record;
  v_runs     integer := 0;
BEGIN
  -- 1. Lock every run to recount, in id order, before any app_analytics row.
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::uuid[])
    INTO v_runs_ids
    FROM (
      SELECT ar.id
        FROM app_runs ar
        JOIN workflow_executions we ON we.id = ar.execution_id AND we.user_id = ar.runner_id
       WHERE ar.analytics_counted_on IS NULL
         AND we.trigger_type IN ('manual', 'mcp', 'app_run')
         AND lower(we.trigger_data -> 'appRun' ->> 'appRunId') = ar.id::text
         AND lower(we.trigger_data -> 'appRun' ->> 'resumedFrom') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ORDER BY ar.id
         FOR UPDATE OF ar
    ) c;

  FOREACH v_run_id IN ARRAY v_runs_ids LOOP
    SELECT ar.id, ar.app_id, ar.runner_id, ar.execution_id INTO v_run FROM app_runs ar WHERE ar.id = v_run_id;

    -- The chain, newest first (537's walk).
    v_seen := ARRAY[]::uuid[];
    v_id := v_run.execution_id;
    v_workflow := NULL;
    WHILE v_id IS NOT NULL AND cardinality(v_seen) < 100 LOOP
      SELECT we.id, we.user_id, we.workflow_id, we.trigger_type, we.trigger_data
        INTO v_row
        FROM workflow_executions we
       WHERE we.id = v_id;
      EXIT WHEN NOT FOUND
        OR v_row.user_id IS DISTINCT FROM v_run.runner_id
        OR (cardinality(v_seen) > 0 AND v_row.workflow_id IS DISTINCT FROM v_workflow);
      v_workflow := v_row.workflow_id;
      v_seen := v_seen || v_row.id;
      v_next := NULL;
      IF v_row.trigger_type IN ('manual', 'mcp', 'app_run')
         AND lower(v_row.trigger_data -> 'appRun' ->> 'appRunId') = v_run.id::text THEN
        v_next := lower(v_row.trigger_data -> 'appRun' ->> 'resumedFrom');
      END IF;
      IF v_next IS NULL
         OR v_next !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        EXIT;
      END IF;
      v_id := v_next::uuid;
      EXIT WHEN v_id = ANY (v_seen);
    END LOOP;
    CONTINUE WHEN cardinality(v_seen) = 0;

    -- The first attempt. A run whose first attempt did not end before 538 was
    -- never counted by the old rules: it is left to the trigger.
    SELECT we.id, we.status, we.created_at, COALESCE(we.completed_at, we.created_at) AS ended
      INTO v_root
      FROM workflow_executions we
     WHERE we.id = v_seen[cardinality(v_seen)];
    CONTINUE WHEN v_root.ended >= v_cut;
    CONTINUE WHEN cardinality(v_seen) = 1 AND v_root.status NOT IN ('completed', 'failed');

    -- Every attempt counted before 538, newest first, with the status it was
    -- counted with and the day it ended.
    SELECT array_agg(m.id ORDER BY m.ord), array_agg(m.counted ORDER BY m.ord), array_agg(m.ended::date ORDER BY m.ord)
      INTO v_ids, v_counted, v_days
      FROM (
        SELECT c.ord, we.id,
               CASE WHEN c.ord = 1 THEN we.status ELSE 'failed' END AS counted,
               COALESCE(we.completed_at, we.created_at) AS ended
          FROM unnest(v_seen) WITH ORDINALITY AS c(id, ord)
          JOIN workflow_executions we ON we.id = c.id
         WHERE c.ord > 1 OR we.status IN ('completed', 'failed')
        UNION ALL
        -- The run's Retries refused before they started.
        SELECT 1000000 AS ord, we.id, 'failed' AS counted, COALESCE(we.completed_at, we.created_at) AS ended
          FROM workflow_executions we
         WHERE we.user_id = v_run.runner_id
           AND we.created_at >= v_root.created_at
           AND we.workflow_id = v_workflow
           AND we.trigger_type IN ('manual', 'mcp', 'app_run')
           AND lower(we.trigger_data -> 'appRun' ->> 'appRunId') = v_run.id::text
           AND lower(we.trigger_data -> 'appRun' ->> 'resumedFrom') = ANY (SELECT s::text FROM unnest(v_seen) AS s)
           AND we.status = 'failed'
           AND we.id <> ALL (v_seen)
      ) m
     WHERE m.ended < v_cut;
    CONTINUE WHEN v_ids IS NULL;

    SELECT COALESCE(we.total_credits_used, 0) INTO v_credits FROM workflow_executions we WHERE we.id = v_ids[1];

    -- Its changes: every count but the first's is taken back; the first
    -- takes the run's outcome (the newest counted attempt's).
    FOR v_delta IN
      SELECT d.day,
             sum(CASE WHEN d.id = v_root.id THEN 0 ELSE -1 END)::integer AS runs,
             sum(CASE WHEN d.id = v_root.id
                      THEN (CASE WHEN v_counted[1] = 'completed' THEN 1 ELSE 0 END) - (CASE WHEN d.counted = 'completed' THEN 1 ELSE 0 END)
                      ELSE -(CASE WHEN d.counted = 'completed' THEN 1 ELSE 0 END) END)::integer AS ok,
             sum(CASE WHEN d.id = v_root.id
                      THEN (CASE WHEN v_counted[1] = 'failed' THEN 1 ELSE 0 END) - (CASE WHEN d.counted = 'failed' THEN 1 ELSE 0 END)
                      ELSE -(CASE WHEN d.counted = 'failed' THEN 1 ELSE 0 END) END)::integer AS failed
        FROM unnest(v_ids, v_counted, v_days) AS d(id, counted, day)
       GROUP BY d.day
    LOOP
      v_d_app := v_d_app || v_run.app_id;
      v_d_day := v_d_day || v_delta.day;
      v_d_runs := v_d_runs || v_delta.runs;
      v_d_ok := v_d_ok || v_delta.ok;
      v_d_failed := v_d_failed || v_delta.failed;
    END LOOP;

    UPDATE app_runs SET
      analytics_counted_on = v_root.ended::date,
      analytics_outcome = v_counted[1],
      analytics_execution_id = v_ids[1],
      analytics_execution_credits = v_credits
    WHERE id = v_run.id;
    v_runs := v_runs + 1;
  END LOOP;

  -- 2. Every run's changes, once per row: by app, newest day first.
  FOR v_delta IN
    SELECT d.app_id, d.day, sum(d.runs)::integer AS runs, sum(d.ok)::integer AS ok, sum(d.failed)::integer AS failed
      FROM unnest(v_d_app, v_d_day, v_d_runs, v_d_ok, v_d_failed) AS d(app_id, day, runs, ok, failed)
     GROUP BY d.app_id, d.day
     ORDER BY d.app_id, d.day DESC
  LOOP
    CONTINUE WHEN v_delta.runs = 0 AND v_delta.ok = 0 AND v_delta.failed = 0;
    UPDATE app_analytics SET
      total_runs = GREATEST(total_runs + v_delta.runs, 0),
      successful_runs = GREATEST(successful_runs + v_delta.ok, 0),
      failed_runs = GREATEST(failed_runs + v_delta.failed, 0)
    WHERE app_id = v_delta.app_id AND date = v_delta.day;
  END LOOP;

  RETURN v_runs;
END;
$$;

-- Rewrites any app's counts when the owner calls it; never a client's to call.
REVOKE ALL ON FUNCTION public.app_analytics_recount_retried_runs() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_runs integer;
BEGIN
  v_runs := public.app_analytics_recount_retried_runs();
  RAISE NOTICE 'app runs recounted once in their app''s analytics: %', v_runs;
END $$;
