-- workflow_executions: composite (filter, created_at DESC) indexes.
--
-- The two paginated executions-list endpoints in routes/workflow-execution.ts
-- filter by user_id (GET /v1/executions) or workflow_id + user_id
-- (GET /v1/workflows/:id/executions) and ORDER BY created_at DESC. The table
-- only had single-column indexes on workflow_id / user_id plus a partial status
-- index, so every page request filtered by the single-column index then did a
-- full sort of the matching set. workflow_executions grows on every run, app
-- run, component execution, and webhook/schedule/telegram trigger — it was the
-- lone per-user-growing table missing the (user_id, created_at DESC) composite
-- that jobs / usage_logs / credit_transactions already have. Both list paths
-- are polled by the UI, so the sort cost compounds.
--
-- Convergence migration (new number, no renumber): additive, idempotent.

CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_created
  ON public.workflow_executions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_created
  ON public.workflow_executions (workflow_id, created_at DESC);
