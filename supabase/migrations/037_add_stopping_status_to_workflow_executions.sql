-- Add 'stopping' status to workflow_executions for "stop after current node" feature.
-- When status='stopping', the orchestrator finishes the current execution level
-- then marks the execution as 'cancelled'.

ALTER TABLE public.workflow_executions
    DROP CONSTRAINT IF EXISTS workflow_executions_status_check;

ALTER TABLE public.workflow_executions
    ADD CONSTRAINT workflow_executions_status_check
        CHECK (status IN ('pending','running','completed','failed','cancelled','timed_out','stopping'));
