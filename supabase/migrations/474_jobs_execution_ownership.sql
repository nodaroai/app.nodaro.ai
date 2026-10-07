-- 474_jobs_execution_ownership.sql
--
-- jobs and workflow_executions: the server writes every job and every
-- execution, and a job belongs only to its own user's executions (decided
-- 2026-10-06).
--
-- A job row says which workflow run it belongs to (`workflow_execution_id`).
-- The backend reads a run's jobs with the service role — to resume a fan-out,
-- adopt an in-flight render, reconcile a crashed run, size its wait budget —
-- so that pointer is trusted data. Until now the browser roles kept the
-- table-level INSERT grant, and the one INSERT policy ("Users can insert own
-- jobs", 032/377) checked only `user_id`: a signed-in client could insert its
-- own row naming any execution, with any status, output or input.
--
-- 347 and 377 both left the write grants alone as "a separate change with its
-- own blast radius". This is that change. Every write path was checked first:
-- the editor never writes `jobs` (it reads one Realtime UPDATE feed, which
-- needs SELECT only — 347's column grant, untouched here); studio.nodaro.ai has
-- no table access; the cloud plugins write jobs only through the host's
-- service-role client. So the browser roles lose every write, not a list of
-- columns:
--   - INSERT, UPDATE, DELETE and TRUNCATE are revoked from anon and
--     authenticated (no UPDATE or DELETE policy existed since 025, so only
--     INSERT changes in practice);
--   - the owner INSERT policy is dropped. 394's and 451's RESTRICTIVE insert
--     policies stay: harmless, and still right if a grant ever came back.
--
-- The second half deals with what a grant cannot: rows planted before this
-- migration, and an invariant every writer — the service role too — must keep.

-- ---------------------------------------------------------------------------
-- A pre-474 client could also insert its OWN job as 'completed' with any
-- `output_data` — a URL of another user's file, say. Nothing here rewrites
-- such rows (they are the user's own), but the two harvesters that delete a
-- job's output files (the free-tier storage reaper and an app's expunge) now
-- delete only keys in the job's own key family (`<prefix>/<jobId>...`,
-- isOwnedObjectKey in backend/src/lib/job-policy-outputs.ts). Count the
-- completed jobs whose output holds an http URL with no key of their own
-- family, so the migration log says how many rows the fence now holds back.
-- Approximate on purpose: a text match on the row, not a key-by-key parse (a
-- legitimate output that also carries a foreign URL counts as fine; an upload
-- or scraped key, legitimately foreign-stemmed, counts as held back).
DO $$
DECLARE
  v_foreign_output INT;
BEGIN
  SELECT COUNT(*) INTO v_foreign_output
  FROM public.jobs j
  WHERE j.status = 'completed'
    AND j.output_data IS NOT NULL
    AND j.output_data::text LIKE '%http%'
    AND j.output_data::text NOT LIKE '%' || j.id::text || '%';

  RAISE NOTICE 'completed jobs whose output names no file of their own (approximate; their foreign keys are no longer reaped): %', v_foreign_output;
END $$;

DROP POLICY IF EXISTS "Users can insert own jobs" ON public.jobs;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.jobs FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- workflow_executions: the same, for the same reason.
--
-- An execution row is just as trusted. Its `status` decides whether a run is
-- still in progress (the app run's permanent delete refuses a running one, so
-- a monetized app's creator fee is settled when the run completes), and its
-- `node_states` names the job ids that diagnose_run and get_app_run read with
-- the service role. 036 still let the owner INSERT, UPDATE and DELETE their
-- own rows from the browser, so a runner could mark a running execution
-- failed and delete the run, or delete the execution outright — 044's
-- `app_runs.execution_id ... ON DELETE CASCADE` then removes the run, and the
-- completing orchestrator finds no run to settle the fee against. A client
-- could also write any job id into `node_states`.
--
-- No client writes this table: the editor and the published-app runtime only
-- SELECT it (and Realtime needs SELECT only); studio.nodaro.ai has no table
-- access; every write is the backend's service role. So the browser roles
-- lose every write, as 469 did for app_runs. The SELECT policies (036's owner
-- read, 044's app-creator read, 325's admin read) stay.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert own workflow executions" ON public.workflow_executions;
DROP POLICY IF EXISTS "Users can update own workflow executions" ON public.workflow_executions;
DROP POLICY IF EXISTS "Users can delete own workflow executions" ON public.workflow_executions;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.workflow_executions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rows written before this migration.
--
-- The revoke stops new client writes; it does not undo old ones. Count the job
-- rows that point at an execution another user owns (the notice lands in the
-- migration log, so we learn whether the hole was used), then detach them:
-- the pointer goes, the row stays as its own user's standalone job. Every
-- legitimate writer stamps the execution's own user (the orchestrator and the
-- routes it calls insert as the run's user), so a mismatch is never ours.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_cross_user INT;
BEGIN
  SELECT COUNT(*) INTO v_cross_user
  FROM public.jobs j
  JOIN public.workflow_executions we ON we.id = j.workflow_execution_id
  WHERE j.user_id IS DISTINCT FROM we.user_id;

  RAISE NOTICE 'jobs pointing at another user''s execution: % (detached below)', v_cross_user;
END $$;

UPDATE public.jobs j
SET workflow_execution_id = NULL
FROM public.workflow_executions we
WHERE we.id = j.workflow_execution_id AND j.user_id IS DISTINCT FROM we.user_id;

-- ---------------------------------------------------------------------------
-- The invariant itself, for every writer — the service role included, which
-- the revoke above does not bound: a job may point only at an execution its
-- user owns. A backend bug that would cross users now fails the write instead
-- of feeding one user's job into another user's run.
--
-- Fires on INSERT and on a change of either column. Deleting an execution
-- sets its jobs' pointer to NULL (036), which passes; deleting a user deletes
-- their jobs (001), which is not an UPDATE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.jobs_execution_owner_check()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_execution_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_executions we
    WHERE we.id = NEW.workflow_execution_id AND we.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'jobs.workflow_execution_id must name an execution its user owns'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE ALL ON FUNCTION public.jobs_execution_owner_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_execution_owner ON public.jobs;
CREATE TRIGGER trg_jobs_execution_owner
  BEFORE INSERT OR UPDATE OF workflow_execution_id, user_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_execution_owner_check();
