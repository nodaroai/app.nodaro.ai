-- An app run's credits are its TOTAL across its attempts (decided 2026-10-19).
--
-- A failed app run is continued by its Retry (POST /v1/app/:slug/runs/:runId/resume):
-- a new execution that runs only what the failed one did not complete, and the
-- run's pointer (`app_runs.execution_id`) moves to it. `app_runs.credits_used`
-- was written by the analytics trigger as the spend of the execution that just
-- ended, so after a Retry it showed only the Retry's spend: what the failed
-- attempt spent vanished from the run.
--
-- `credits_used` is now the spend of every execution in the run's chain: the
-- execution the run points at, the one it continued (`resumedFrom`), and so on
-- back to the run's first attempt. Each attempt's own spend stays on its
-- execution (`workflow_executions.total_credits_used`).
--
-- The chain is read the way the backend reads it (lib/trigger-data-stamps.ts):
--   * the link is the Retry's stamp, `trigger_data.appRun.resumedFrom`, trusted
--     only on an execution a stamp-writing lane started (trigger_type 'manual',
--     'mcp' or 'app_run', lib/server-started-runs.ts) and only when that stamp
--     names THIS run (`appRun.appRunId`);
--   * every execution summed is the run's runner's, of one workflow;
--   * the walk stops at the first execution that names no earlier one, at a
--     cycle, or after 100 attempts.
-- A Render final (`appRenderFinal`) is a separate execution outside the run and
-- is not in the chain; a start-over (the ordinary run of the run's id) carries
-- no `resumedFrom`, so it begins a chain of its own.
--
-- One function computes the total (`app_run_credits_total`), and it is the only
-- thing that writes the column:
--   * when an execution's spend changes, for the run that points at it and for
--     the run it is stamped for (an earlier attempt the pointer has moved past);
--   * when a run's pointer is set or moves (a Retry, a start-over).
-- The analytics trigger keeps adding each execution's OWN spend to the app's
-- daily `app_analytics.total_credits` as that execution ends; adding the chain
-- total there would count the failed attempt twice.
--
-- The creator's markup is untouched: it is settled by the orchestrator from the
-- completing execution's own spend through `process_app_monetization`, once
-- per run (its run-id mutex), and never reads this column.
--
-- Neither trigger can fail the write it rides on (an execution's terminal
-- status, a run's pointer move): an error is logged as a WARNING and the
-- column is left as it was.
--
-- Additive; RLS and grants on both tables unchanged. Re-runnable: CREATE OR
-- REPLACE, DROP TRIGGER IF EXISTS, and a backfill that writes only rows whose
-- value differs.

-- ---------------------------------------------------------------------------
-- The total: the spend of every execution in the run's chain.
-- NULL when nothing can be known (no pointer, or the pointer is not the
-- runner's own execution): the caller then leaves the column as it is.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_run_credits_total(p_run_id uuid, p_runner_id uuid, p_execution_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total    bigint := 0;
  v_id       uuid := p_execution_id;
  v_workflow uuid;
  v_seen     uuid[] := ARRAY[]::uuid[];
  v_next     text;
  v_row      record;
BEGIN
  IF p_run_id IS NULL OR p_runner_id IS NULL OR p_execution_id IS NULL THEN
    RETURN NULL;
  END IF;

  WHILE v_id IS NOT NULL AND cardinality(v_seen) < 100 LOOP
    SELECT we.id, we.user_id, we.workflow_id, we.total_credits_used, we.trigger_type, we.trigger_data
      INTO v_row
      FROM workflow_executions we
     WHERE we.id = v_id;

    -- Only the run's own executions: its runner's, of one workflow.
    IF NOT FOUND
       OR v_row.user_id IS DISTINCT FROM p_runner_id
       OR (cardinality(v_seen) > 0 AND v_row.workflow_id IS DISTINCT FROM v_workflow) THEN
      IF cardinality(v_seen) = 0 THEN
        RETURN NULL;
      END IF;
      EXIT;
    END IF;

    v_workflow := v_row.workflow_id;
    v_seen := v_seen || v_row.id;
    v_total := v_total + COALESCE(v_row.total_credits_used, 0);

    -- The attempt it continued: a Retry's stamp, naming this run, on a lane
    -- that writes stamps (SERVER_STAMPED_TRIGGER_TYPES).
    v_next := NULL;
    IF v_row.trigger_type IN ('manual', 'mcp', 'app_run')
       AND lower(v_row.trigger_data -> 'appRun' ->> 'appRunId') = p_run_id::text THEN
      v_next := lower(v_row.trigger_data -> 'appRun' ->> 'resumedFrom');
    END IF;
    IF v_next IS NULL
       OR v_next !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      EXIT;
    END IF;
    v_id := v_next::uuid;
    EXIT WHEN v_id = ANY (v_seen);
  END LOOP;

  RETURN LEAST(v_total, 2147483647)::integer;
END;
$$;

-- Reads any user's executions when called by the owner; never a client's to call.
REVOKE ALL ON FUNCTION public.app_run_credits_total(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An execution's spend changed: re-total the run that points at it, and the
-- run it is stamped for (the runner's own, either way).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_run_credits_on_execution_spend()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stamped text;
  v_run     uuid;
BEGIN
  BEGIN
    IF NEW.trigger_type IN ('manual', 'mcp', 'app_run') THEN
      v_stamped := lower(NEW.trigger_data -> 'appRun' ->> 'appRunId');
      IF v_stamped ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_run := v_stamped::uuid;
      END IF;
    END IF;

    WITH totals AS (
      SELECT ar.id, public.app_run_credits_total(ar.id, ar.runner_id, ar.execution_id) AS total
        FROM app_runs ar
       WHERE ar.runner_id = NEW.user_id
         AND ar.execution_id IS NOT NULL
         AND (ar.execution_id = NEW.id OR ar.id = v_run)
    )
    UPDATE app_runs ar
       SET credits_used = t.total
      FROM totals t
     WHERE ar.id = t.id
       AND t.total IS NOT NULL
       AND ar.credits_used IS DISTINCT FROM t.total;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app run credits not re-totalled for execution %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_run_credits_on_execution_spend ON public.workflow_executions;
CREATE TRIGGER trg_app_run_credits_on_execution_spend
  AFTER UPDATE OF total_credits_used ON public.workflow_executions
  FOR EACH ROW
  WHEN (OLD.total_credits_used IS DISTINCT FROM NEW.total_credits_used)
  EXECUTE FUNCTION public.app_run_credits_on_execution_spend();

-- ---------------------------------------------------------------------------
-- A run's pointer is set or moves (a Retry, a start-over): its total is the
-- new chain's. A pointer cleared to NULL (a draft) keeps the value it is given.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_run_credits_on_pointer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total integer;
BEGIN
  IF NEW.execution_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.execution_id IS NOT DISTINCT FROM OLD.execution_id THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_total := public.app_run_credits_total(NEW.id, NEW.runner_id, NEW.execution_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app run credits not re-totalled for run %: %', NEW.id, SQLERRM;
    v_total := NULL;
  END;
  IF v_total IS NOT NULL THEN
    NEW.credits_used := v_total;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_run_credits_on_pointer ON public.app_runs;
CREATE TRIGGER trg_app_run_credits_on_pointer
  BEFORE INSERT OR UPDATE OF execution_id ON public.app_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.app_run_credits_on_pointer();

-- ---------------------------------------------------------------------------
-- The analytics trigger (045; runner checks from 469), restated whole. The
-- only change: it no longer writes `app_runs.credits_used` (the functions above
-- own it). It still adds the ending execution's OWN spend to the app's daily
-- total. CREATE OR REPLACE resets settings, so the search_path pin is restated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_app_analytics()
RETURNS TRIGGER AS $$
DECLARE
  v_app_id UUID;
  v_runner_id UUID;
  v_credits INT;
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Only fire on status change to completed or failed
  IF NEW.status NOT IN ('completed', 'failed') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Find the app_run for this execution: the execution owner's own
  SELECT ar.app_id, ar.runner_id
  INTO v_app_id, v_runner_id
  FROM app_runs ar
  WHERE ar.execution_id = NEW.id AND ar.runner_id = NEW.user_id
  LIMIT 1;

  -- If no app_run found, this is not a published app execution
  IF v_app_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- This execution's own spend (each attempt adds its own, so the app's total
  -- counts a Retried run's attempts once each).
  v_credits := COALESCE(NEW.total_credits_used, 0);

  -- Upsert analytics row
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
    total_credits = app_analytics.total_credits + v_credits,
    successful_runs = app_analytics.successful_runs + CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
    failed_runs = app_analytics.failed_runs + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END;

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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON COLUMN public.app_runs.credits_used IS
  'The run''s total spend across its attempts: the execution it points at plus every execution that one continued (a Retry''s resumedFrom), back to its first attempt. Written only by app_run_credits_total''s triggers (migration 537). Each attempt''s own spend is on its workflow_executions row.';

-- ---------------------------------------------------------------------------
-- Backfill: every run with a pointer gets its chain total. A run never
-- retried gets its execution's own spend (what the run lists already showed);
-- a Retried run gets the sum of its attempts. Writes only rows that differ, so
-- a re-run changes nothing.
-- ---------------------------------------------------------------------------
WITH totals AS (
  SELECT ar.id, public.app_run_credits_total(ar.id, ar.runner_id, ar.execution_id) AS total
    FROM public.app_runs ar
   WHERE ar.execution_id IS NOT NULL
     AND ar.runner_id IS NOT NULL
)
UPDATE public.app_runs ar
   SET credits_used = t.total
  FROM totals t
 WHERE ar.id = t.id
   AND t.total IS NOT NULL
   AND ar.credits_used IS DISTINCT FROM t.total;
