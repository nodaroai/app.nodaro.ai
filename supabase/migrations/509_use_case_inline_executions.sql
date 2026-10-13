-- 509: inline (use-case) executions.
--
-- A use-case node (Tighten Episode first) builds its primitive chain on the
-- server and runs it as an ordinary execution with no saved workflow. The row
-- carries the graph it runs (an immutable snapshot, so a crash re-pick and a
-- continuation read exactly what the first run ran) and the job that wraps it.
--
-- Ships to main BEFORE any code that writes these columns: staging runs dev
-- code against this database, and every reader/writer goes through the
-- missing-column guard (backend/src/lib/execution-inline-graph.ts).

ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS inline_graph jsonb;
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS wrapper_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;
ALTER TABLE public.workflow_executions ALTER COLUMN workflow_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.workflow_executions'::regclass AND conname = 'workflow_executions_graph_source') THEN
    ALTER TABLE public.workflow_executions ADD CONSTRAINT workflow_executions_graph_source
      CHECK (workflow_id IS NOT NULL OR inline_graph IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.workflow_executions'::regclass AND conname = 'workflow_executions_inline_graph_object') THEN
    ALTER TABLE public.workflow_executions ADD CONSTRAINT workflow_executions_inline_graph_object
      CHECK (inline_graph IS NULL OR jsonb_typeof(inline_graph) = 'object') NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workflow_executions_wrapper_job
  ON public.workflow_executions (wrapper_job_id) WHERE wrapper_job_id IS NOT NULL;

-- Every lane 441 declared, plus 'use_case' (the hidden run under a use-case node).
ALTER TABLE public.workflow_executions DROP CONSTRAINT IF EXISTS workflow_executions_trigger_type_check;
ALTER TABLE public.workflow_executions ADD CONSTRAINT workflow_executions_trigger_type_check
  CHECK (trigger_type IN
    ('manual', 'webhook', 'schedule', 'app_run', 'mcp', 'api', 'telegram', 'telegram_account', 'use_case'));

-- The use-case convenience fee: 10 credits per Tighten Episode run.
INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category) VALUES
  ('use-case-fee:tighten-episode', 10, true, 'other')
ON CONFLICT (model_identifier) DO NOTHING;
