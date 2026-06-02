-- Add 'discarded' to workflow_executions.status. Discard = stop the flow,
-- in-flight jobs finish into My Library, results detached from the canvas.
-- (Distinct from 'cancelled', which kills jobs and forfeits results.)

ALTER TABLE public.workflow_executions
    DROP CONSTRAINT IF EXISTS workflow_executions_status_check;

ALTER TABLE public.workflow_executions
    ADD CONSTRAINT workflow_executions_status_check
        CHECK (status IN ('pending','running','completed','failed','cancelled','timed_out','stopping','discarded'));
