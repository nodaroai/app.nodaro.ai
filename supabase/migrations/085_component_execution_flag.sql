-- Mark workflow executions triggered by component nodes so their inner jobs
-- can be filtered out of the user's recent-activity feed.

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS is_component_execution boolean DEFAULT false;

-- Partial index — only rows where flag is true need fast lookup
CREATE INDEX IF NOT EXISTS idx_we_is_component_execution
  ON public.workflow_executions (is_component_execution)
  WHERE is_component_execution = true;
