-- 469_app_runs_server_owned_fields.sql
--
-- app_runs: the server owns every field but the four a runner may edit
-- (decided 2026-10-06).
--
-- A run row points at the execution it shows (`execution_id`). Migration 051
-- let a runner INSERT, UPDATE and DELETE their own rows with no column limit,
-- so a client could write that pointer — and `app_id`, `status`,
-- `credits_used`, `deleted_at` — straight through the database. The backend
-- reads a run's execution with the service role, so the pointer is trusted
-- data and must be server-written only.
--
-- After this migration the browser roles can:
--   - SELECT as before ("Select app runs": the runner, or the app's creator);
--   - UPDATE only the run PATCH's columns (input_values, name, hidden_nodes,
--     node_states) on their own rows ("Runner can update own runs");
--   - nothing else. Runs are created, archived and removed by the backend
--     (service role), which no product surface bypasses.
--
-- The column list is the backend's APP_RUN_CLIENT_WRITABLE_FIELDS
-- (backend/src/lib/app-run-ownership.ts); a test keeps the two equal. A column
-- added later is server-only by default, because the grant names columns.
--
-- The second half (below the grants) deals with what the grants cannot: rows
-- planted before this migration, the analytics trigger that trusted them, and
-- an invariant every writer — the service role too — must keep.

DROP POLICY IF EXISTS "Runner can insert own runs" ON public.app_runs;
DROP POLICY IF EXISTS "Runner can delete own runs" ON public.app_runs;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_runs FROM anon, authenticated;

GRANT UPDATE (input_values, name, hidden_nodes, node_states) ON public.app_runs TO authenticated;

-- ---------------------------------------------------------------------------
-- Rows written before this migration.
--
-- The grants above stop new client writes; they do not undo old ones. A run
-- row a client pointed at another user's execution would keep that pointer,
-- and the analytics trigger below used to copy that execution's spend into
-- it. Count both kinds first (the notices land in the migration log, so we
-- learn whether the hole was used), then clear the cross-user pointers: such
-- a row goes back to being a draft with no execution and no credits.
--
-- A row whose execution is the runner's own but belongs to another app's
-- workflow (the draft lane once allowed it) is counted, not cleared: the
-- backend already hides that execution, and clearing it is a separate call.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_cross_user INT;
  v_cross_app INT;
BEGIN
  SELECT COUNT(*) INTO v_cross_user
  FROM public.app_runs ar
  JOIN public.workflow_executions we ON we.id = ar.execution_id
  WHERE ar.runner_id IS DISTINCT FROM we.user_id;

  SELECT COUNT(*) INTO v_cross_app
  FROM public.app_runs ar
  JOIN public.workflow_executions we ON we.id = ar.execution_id
  JOIN public.published_apps pa ON pa.id = ar.app_id
  WHERE ar.runner_id = we.user_id
    AND pa.workflow_id IS DISTINCT FROM we.workflow_id;

  RAISE NOTICE 'app_runs pointing at another user''s execution: % (cleared below)', v_cross_user;
  RAISE NOTICE 'app_runs pointing at the runner''s execution of another app''s workflow: % (left as is)', v_cross_app;
END $$;

UPDATE public.app_runs ar
SET execution_id = NULL, status = 'draft', credits_used = 0
FROM public.workflow_executions we
WHERE we.id = ar.execution_id AND ar.runner_id IS DISTINCT FROM we.user_id;

-- ---------------------------------------------------------------------------
-- The analytics trigger (045; search_path pinned by 050) finds an execution's
-- run. It is SECURITY DEFINER, so it reads every row: it must ask for the
-- execution owner's run, or a planted row draws another user's spend and
-- completion into it and into its app's counts. Restated whole; the only
-- changes are the three runner checks. CREATE OR REPLACE resets settings, so
-- the search_path pin is restated with it.
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

  v_credits := COALESCE(NEW.total_credits_used, 0);

  -- Update the app_run credits_used
  UPDATE app_runs SET credits_used = v_credits WHERE execution_id = NEW.id AND runner_id = NEW.user_id;

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

-- ---------------------------------------------------------------------------
-- The invariant itself, for every writer — the service role included, which
-- the grants above do not bound: a run may point only at an execution its
-- runner owns. A backend bug that would plant a cross-user pointer now fails
-- the write instead of leaking a run.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_runs_execution_owner_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.execution_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workflow_executions we
    WHERE we.id = NEW.execution_id AND we.user_id = NEW.runner_id
  ) THEN
    RAISE EXCEPTION 'app_runs.execution_id must name an execution its runner owns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- On INSERT and on a change of execution_id only. Not on runner_id: deleting a
-- user sets their runs' runner_id to NULL (050) while their executions are
-- still being removed, and that must not fail the account deletion.
DROP TRIGGER IF EXISTS trg_app_runs_execution_owner ON public.app_runs;
CREATE TRIGGER trg_app_runs_execution_owner
  BEFORE INSERT OR UPDATE OF execution_id ON public.app_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.app_runs_execution_owner_check();
