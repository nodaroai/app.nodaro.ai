-- The input overrides a run APPLIED, pinned on its execution (decided
-- 2026-10-06). The orchestrator writes them once, when the run starts and
-- before any node runs — every lane's overrides (an app run, a `/run`, a
-- presentation, a trigger) pass that one point, and for a continued run they
-- are the earlier run's pin with its own over it. A later continuation of the
-- execution (`continueFromExecutionId`) re-applies exactly these, so inputs a
-- person edits after the run (an app run's `app_runs.input_values`, which every
-- input edit rewrites) never leak into it.
--
-- Shape: `{ nodeId: { field: value } }`, the shape the orchestrator applies.
-- `{}` = the run applied none. NULL = no pin: an execution made before this
-- migration (or one whose pin write failed). NULLABLE, NO DEFAULT, NO
-- BACKFILL: the value belongs to the process that runs the execution, and
-- nothing can recover what an old run applied — a continuation of such an
-- execution keeps the reading it had before (an app run's
-- `app_runs.input_values`; a run of the live workflow: none).
--
-- Additive; RLS unchanged. The row is already the runner's own (migration
-- 036's select/update policies): a pin only shapes that person's own
-- continuation, and they may send any override with it anyway.
--
-- Staging runs dev against this shared database before the promotion applies
-- this migration: the backend reads and writes the column only through a
-- missing-column guard (backend/src/lib/execution-input-overrides.ts).
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS input_overrides jsonb;

-- The orchestrator reads it as a node-keyed map; anything else is not a pin.
-- NOT VALID: every existing row is NULL, so nothing to scan for.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.workflow_executions'::regclass
       AND conname = 'workflow_executions_input_overrides_object'
  ) THEN
    ALTER TABLE public.workflow_executions
      ADD CONSTRAINT workflow_executions_input_overrides_object
      CHECK (input_overrides IS NULL OR jsonb_typeof(input_overrides) = 'object') NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.workflow_executions.input_overrides IS
  'Input overrides the run applied ({ nodeId: { field: value } }), pinned by the orchestrator when it started; a continuation re-applies them. {} = none applied; NULL = no pin (pre-464).';
