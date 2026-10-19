-- A creator's app analytics count an app run ONCE, by its final outcome
-- (decided 2026-10-19).
--
-- `update_app_analytics` (045; runner checks 469; own spend 537) added a run
-- to the app's daily `app_analytics` row every time one of the run's
-- executions ended: +1 `total_runs`, +1 `failed_runs` or `successful_runs`.
-- A run that failed and then completed on Retry
-- (POST /v1/app/:slug/runs/:runId/resume, which continues the failed
-- execution in a new one and moves the run's pointer to it) counted as two
-- runs, one failed and one successful. It now counts as one successful run.
--
-- The rule:
--   * A run is counted when its first attempt ends (completed or failed), on
--     that day's row: +1 run, +1 to its outcome. As before.
--   * A Retry is the same run going on. When it ends, `total_runs` stays as
--     it is and the run's outcome MOVES, on the row the run was counted on:
--     -1 from the outcome it was counted with, +1 to the Retry's. A failed
--     Retry of a failed run moves nothing.
--   * Credits are unchanged from 537: each attempt adds its OWN spend to the
--     row of the day it ended, once.
--   * A start-over (the ordinary run of the run's id, `POST /v1/app/:slug/run`
--     with `runId`) is a new run: new inputs, possibly a new app version, and
--     a new credit total (537). It is counted as a run of its own.
--   * The same execution ending a second time (a failed one later completed)
--     moves the outcome and adds only the spend it had not added yet.
--   * A cancelled attempt counts nothing, as before.
--
-- "The same run" is read as 537 reads a Retry (lib/trigger-data-stamps.ts):
-- the ending execution is the run's pointer, its runner's own, and carries a
-- Retry's stamp (`trigger_data.appRun.resumedFrom`) naming THIS run
-- (`appRun.appRunId`) on a lane that writes stamps (trigger_type 'manual',
-- 'mcp' or 'app_run', lib/server-started-runs.ts), and the attempt it names is
-- the runner's own execution of the same workflow.
--
-- What the run was counted as lives on the run row, written only here:
--   analytics_counted_on        the day (the app_analytics row) it was counted on
--   analytics_outcome           the outcome it is counted with now
--   analytics_execution_id      the execution whose end set that outcome
--   analytics_execution_credits the spend that execution added to total_credits
--
-- A run counted before this migration has none of them. Its Retry then reads
-- the attempt it continued instead: that attempt was counted as a run of its
-- own, on the day it ended, and as FAILED (a Retry is refused unless the
-- attempt it continues failed; a status written later, while the run pointed
-- elsewhere, was never counted). Only an attempt that ended before this
-- migration (`app_analytics_one_run_since()`) is read that way: a run whose
-- count was lost after it (the catch below) has nothing to move, and its
-- Retry is counted as a new run rather than taking another run's outcome.
--
-- Order: the counting reads only the ending execution's own row (its status
-- and its spend, which the orchestrator writes in one UPDATE) and the run row
-- it locks, so it is the same whichever of 537's credit triggers fires
-- before it. Both lanes that start an attempt (executeAppRun, the draft lane,
-- the Retry route) set the run's pointer before the attempt is queued, so an
-- attempt never ends before its run points at it.
--
-- Locks: a count locks its run row, then today's app_analytics row (always:
-- an upsert in both branches), then, for a Retry, the row of the day the run
-- was counted on (never newer than today) - one run and one app per count,
-- in that order. 539 locks every run it recounts before it writes any
-- app_analytics row, then writes the rows in (app, newest day first) order,
-- so a count waiting on 539 holds no row 539 still needs.
--
-- Counting can no longer fail the write it rides on (an execution's terminal
-- status): an error is logged as a WARNING naming the run, and that end is
-- not counted.
--
-- The backfill of the runs already counted more than once is 539, a
-- migration of its own, so this one holds its lock on app_runs only for the
-- column changes.
--
-- Additive. RLS on app_runs and app_analytics unchanged; the new columns are
-- server-only (469 grants UPDATE on app_runs by column). Re-runnable: ADD
-- COLUMN IF NOT EXISTS, a guarded constraint, CREATE OR REPLACE, and a
-- cutoff written only the first time.

-- app_runs is read on every execution's status and spend write (537's and
-- this trigger), so an ALTER queued behind a long transaction would stall the
-- platform: bound the wait. A refused migration is retried whole (every step
-- is guarded). The columns are added bare (a nullable column with no default
-- rewrites nothing) and the outcome's CHECK NOT VALID, so nothing is scanned
-- under the lock: every existing row is NULL, so there is nothing to validate.
SET LOCAL lock_timeout = '2s';

ALTER TABLE public.app_runs ADD COLUMN IF NOT EXISTS analytics_counted_on date;
ALTER TABLE public.app_runs ADD COLUMN IF NOT EXISTS analytics_outcome text;
ALTER TABLE public.app_runs ADD COLUMN IF NOT EXISTS analytics_execution_id uuid;
ALTER TABLE public.app_runs ADD COLUMN IF NOT EXISTS analytics_execution_credits integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.app_runs'::regclass AND conname = 'app_runs_analytics_outcome_check') THEN
    ALTER TABLE public.app_runs ADD CONSTRAINT app_runs_analytics_outcome_check
      CHECK (analytics_outcome IN ('completed', 'failed')) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.app_runs.analytics_counted_on IS
  'The day (app_analytics row) this run is counted on in its app''s analytics: the day its first attempt ended. A Retry moves the outcome on that row. Written only by update_app_analytics (migration 538).';
COMMENT ON COLUMN public.app_runs.analytics_outcome IS
  'The outcome (completed or failed) the run is counted with in its app''s analytics: its latest finished attempt''s. Written only by update_app_analytics (migration 538).';
COMMENT ON COLUMN public.app_runs.analytics_execution_id IS
  'The execution whose end set analytics_outcome. Written only by update_app_analytics (migration 538).';
COMMENT ON COLUMN public.app_runs.analytics_execution_credits IS
  'The spend that analytics_execution_id added to its app''s analytics total_credits. Written only by update_app_analytics (migration 538).';

-- ---------------------------------------------------------------------------
-- When these rules began: the time this migration first ran. An attempt that
-- ended before it was counted by the old rules (one run per attempt). Written
-- once; a re-run keeps the first time.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF to_regprocedure('public.app_analytics_one_run_since()') IS NULL THEN
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.app_analytics_one_run_since() RETURNS timestamptz '
      'LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS %L',
      format('SELECT to_timestamp(%s)', extract(epoch FROM now())));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.app_analytics_one_run_since() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The analytics trigger, restated whole.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_app_analytics()
RETURNS TRIGGER AS $$
DECLARE
  v_run_id UUID;
  v_app_id UUID;
  v_runner_id UUID;
  v_counted_on DATE;
  v_outcome TEXT;
  v_counted_exec UUID;
  v_counted_credits INT;
  v_credits INT;
  v_add BIGINT;
  v_from TEXT;
  v_source RECORD;
  v_same_run BOOLEAN := false;
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Only fire on status change to completed or failed
  IF NEW.status NOT IN ('completed', 'failed') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Find the app_run for this execution: the execution owner's own
    SELECT ar.id, ar.app_id, ar.runner_id, ar.analytics_counted_on, ar.analytics_outcome,
           ar.analytics_execution_id, ar.analytics_execution_credits
    INTO v_run_id, v_app_id, v_runner_id, v_counted_on, v_outcome, v_counted_exec, v_counted_credits
    FROM app_runs ar WHERE ar.execution_id = NEW.id AND ar.runner_id = NEW.user_id
    LIMIT 1
    FOR UPDATE;

    -- If no app_run found, this is not a published app execution
    IF v_run_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- This execution's own spend.
    v_credits := COALESCE(NEW.total_credits_used, 0);

    -- A Retry of this run: its stamp names the run and the attempt it continued.
    IF NEW.trigger_type IN ('manual', 'mcp', 'app_run')
       AND lower(NEW.trigger_data -> 'appRun' ->> 'appRunId') = v_run_id::text THEN
      v_from := lower(NEW.trigger_data -> 'appRun' ->> 'resumedFrom');
      IF v_from !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_from := NULL;
      END IF;
    END IF;
    -- The attempt it continued: the runner's own, of the same workflow.
    IF v_from IS NOT NULL THEN
      SELECT we.status, we.completed_at, we.created_at
        INTO v_source
        FROM workflow_executions we
       WHERE we.id = v_from::uuid AND we.user_id = NEW.user_id AND we.workflow_id = NEW.workflow_id;
      IF NOT FOUND THEN
        v_from := NULL;
      END IF;
    END IF;

    IF v_counted_on IS NOT NULL AND v_counted_exec IS NOT DISTINCT FROM NEW.id THEN
      -- The attempt that set the run's outcome ended again.
      v_same_run := true;
    ELSIF v_counted_on IS NOT NULL AND v_from IS NOT NULL THEN
      -- A Retry of a run counted under these rules.
      v_same_run := true;
      v_counted_exec := NULL;
    ELSIF v_from IS NOT NULL THEN
      -- A Retry of a run counted before these rules: the attempt it continued
      -- was counted as a failed run of its own, on the day it ended. Only an
      -- attempt that ended before them: after, a run with nothing recorded
      -- lost its count, and its Retry is a new run.
      IF COALESCE(v_source.completed_at, v_source.created_at) < public.app_analytics_one_run_since() THEN
        v_same_run := true;
        v_counted_on := COALESCE(v_source.completed_at, v_source.created_at)::date;
        v_outcome := 'failed';
        v_counted_exec := NULL;
      END IF;
    END IF;

    IF v_same_run THEN
      -- No new run. Today's row first (the lock order), with the spend not
      -- counted yet (an upsert even when that is 0, so the row is locked).
      v_add := v_credits::bigint - CASE WHEN v_counted_exec = NEW.id THEN COALESCE(v_counted_credits, 0) ELSE 0 END;
      INSERT INTO app_analytics (app_id, date, total_runs, unique_runners, total_credits, successful_runs, failed_runs)
      VALUES (v_app_id, v_today, 0, 0, GREATEST(LEAST(v_add, 2147483647), 0), 0, 0)
      ON CONFLICT (app_id, date) DO UPDATE SET
        total_credits = GREATEST(LEAST(app_analytics.total_credits + v_add, 2147483647), 0);

      -- The run's outcome moves, on the row it was counted on.
      IF v_outcome IS DISTINCT FROM NEW.status THEN
        UPDATE app_analytics SET
          successful_runs = GREATEST(successful_runs
            + CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END
            - CASE WHEN v_outcome = 'completed' THEN 1 ELSE 0 END, 0),
          failed_runs = GREATEST(failed_runs
            + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END
            - CASE WHEN v_outcome = 'failed' THEN 1 ELSE 0 END, 0)
        WHERE app_id = v_app_id AND date = v_counted_on;
      END IF;
    ELSE
      -- A new run: its first attempt, or a start-over.
      v_counted_on := v_today;
      INSERT INTO app_analytics (app_id, date, total_runs, unique_runners, total_credits, successful_runs, failed_runs)
      VALUES (
        v_app_id,
        v_today,
        1,
        1,
        v_credits,
        CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
        CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END
      )
      ON CONFLICT (app_id, date) DO UPDATE SET
        total_runs = app_analytics.total_runs + 1,
        total_credits = LEAST(app_analytics.total_credits::bigint + v_credits, 2147483647),
        successful_runs = app_analytics.successful_runs + CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
        failed_runs = app_analytics.failed_runs + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END;
    END IF;

    -- What the run is counted as now.
    UPDATE app_runs SET
      analytics_counted_on = v_counted_on,
      analytics_outcome = NEW.status,
      analytics_execution_id = NEW.id,
      analytics_execution_credits = v_credits
    WHERE id = v_run_id;

    -- Update unique_runners separately (need to count distinct)
    UPDATE app_analytics SET unique_runners = (
      SELECT COUNT(DISTINCT ar.runner_id)
      FROM app_runs ar
      JOIN workflow_executions we ON we.id = ar.execution_id AND we.user_id = ar.runner_id
      WHERE ar.app_id = v_app_id
      AND ar.created_at >= v_today
      AND ar.created_at < v_today + INTERVAL '1 day'
    )
    WHERE app_id = v_app_id AND date = v_today;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app analytics not counted for run % (execution %): % (SQLSTATE %)', v_run_id, NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- A trigger function only: no client calls it (a trigger fires without it).
REVOKE ALL ON FUNCTION public.update_app_analytics() FROM PUBLIC, anon, authenticated;
