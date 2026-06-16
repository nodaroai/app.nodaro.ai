-- jobs.node_id: the canvas node a SINGLE-NODE job belongs to, so its in-flight
-- progress can be restored after a page reload (Gap 3 — single-node restore).
-- Injected by the frontend (withWorkflowId → backend extractNodeId), NULL for
-- orchestrator/execution jobs (those carry input_data.node_id) and for all
-- pre-migration rows. Additive + nullable → backward compatible.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS node_id TEXT;

-- Partial index: only the small fraction of rows that are editor single-node
-- runs (node_id set) are indexed — orchestrator/MCP/app jobs stay NULL and out
-- of the index, so write overhead on this hot table is negligible. The current
-- restore query filters by workflow_id (idx_jobs_workflow_id); this reserves an
-- efficient per-node lookup ("active job for node X") for future use.
CREATE INDEX IF NOT EXISTS idx_jobs_node_id
  ON public.jobs (workflow_id, node_id)
  WHERE node_id IS NOT NULL;
