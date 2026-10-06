-- Render final in the app runner (decided 2026-10-04: the final and the
-- nodes after it run as a CONTINUATION outside the app run, with no creator
-- markup). An app run that stopped at a Preview render gets its final as a
-- second execution: `continueFromExecutionId` = `app_runs.execution_id`, the
-- render overridden to Final for that run only, the nodes after it run once.
--
-- The app run stays ONE row: the second execution is not a run (it does not
-- count toward the daily cap, the app's run count or the runner's history),
-- and markup settles only on the execution `app_runs.execution_id` names, so
-- the final earns the creator nothing. This column is how the run finds its
-- final again: the runner's view shows the final's results over the preview's,
-- and follows a final still rendering after a reload.
--
-- NULL = no final was asked for. A newer Render final replaces the id. If the
-- execution row is deleted the link goes with it (ON DELETE SET NULL): the run
-- then reads as the preview it was.
--
-- Additive; RLS unchanged. The column is server-written: migration 469 grants
-- the browser roles UPDATE on the run PATCH's columns only, so a column added
-- later is not theirs to write. The backend reads it with the service role,
-- which bypasses RLS, so every reader still loads the execution it names only
-- when that execution is the runner's own run of the app's workflow.
--
-- Staging runs dev against this shared database before the promotion applies
-- this migration: the backend reads and writes the column only through a
-- missing-column guard (backend/src/lib/app-run-final-column.ts).
ALTER TABLE public.app_runs
  ADD COLUMN IF NOT EXISTS final_execution_id uuid
  REFERENCES public.workflow_executions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_app_runs_final_execution
  ON public.app_runs(final_execution_id)
  WHERE final_execution_id IS NOT NULL;

COMMENT ON COLUMN public.app_runs.final_execution_id IS
  'The Render final of this app run: a continuation of execution_id, outside the run (no markup, not a run of its own). NULL = none asked for.';
