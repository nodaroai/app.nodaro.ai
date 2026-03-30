-- Allow "app_run" as a trigger_type for workflow executions created by
-- app-runner and component execution (prevents corruption of original workflows).

ALTER TABLE public.workflow_executions
  DROP CONSTRAINT IF EXISTS workflow_executions_trigger_type_check;

ALTER TABLE public.workflow_executions
  ADD CONSTRAINT workflow_executions_trigger_type_check
  CHECK (trigger_type IN ('manual', 'webhook', 'schedule', 'app_run'));
