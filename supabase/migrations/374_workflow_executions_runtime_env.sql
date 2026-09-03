-- 374_workflow_executions_runtime_env.sql
-- Which environment's orchestrator claimed this execution.
--
-- WHY. Staging (next.nodaro.ai) and production (app.nodaro.ai) share ONE
-- Supabase database but have SEPARATE Redis instances, so each runs its own
-- BullMQ `workflow-orchestration` queue. Both environments' reconcile sweeps
-- (the 90-second cron in backend/src/lib/reconcile/workflow-executions-cron.ts
-- and the boot sweep in backend/src/workers/orchestrator-worker.ts) scan the
-- SAME `workflow_executions` rows for status in ('running','stopping') and
-- look the orchestrator job up in THEIR OWN Redis. Every execution belonging
-- to the OTHER environment therefore looks orphaned, and gets marked failed
-- with "Execution orphaned — no orchestrator job in queue (reconciled by
-- cron)" while it is still healthy and progressing. Internal validation
-- caught production's cron killing a live staging execution 2m38s after it
-- started; the generation already in flight completed and was charged, for a
-- run the closed execution could no longer deliver.
--
-- WHAT LANDS HERE. The claiming process's runtime environment name —
-- `RUNTIME_ENV` if set, else Railway's `RAILWAY_ENVIRONMENT_NAME`, else
-- 'local' (backend/src/lib/runtime-env.ts). Written by the orchestrator when
-- it claims the row (and by the cancel route when a never-claimed `pending`
-- row is moved to `stopping`, which no claim write will ever reach).
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. NULL means "claimed before this
-- migration". A database default would be wrong: the value belongs to the
-- process that claims the row, not to the process that inserts it. Legacy
-- NULL rows are reconciled by the environment named 'production' only —
-- production is where an abandoned row costs a user money, and staging's
-- stale legacy rows are harmless. Both environments taking them would
-- reintroduce exactly the cross-environment kill this column prevents.

ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS runtime_env text;

COMMENT ON COLUMN public.workflow_executions.runtime_env IS
  'Runtime environment whose orchestrator claimed this row (RUNTIME_ENV / RAILWAY_ENVIRONMENT_NAME / local). Reconcile sweeps only touch rows of their own environment; NULL = pre-374, reconciled by production only.';

-- Serves both reconcile scans: status IN ('running','stopping') AND
-- runtime_env = <env>, ordered by started_at. Partial so it stays tiny —
-- only in-flight rows qualify, which is a few at a time.
CREATE INDEX IF NOT EXISTS workflow_executions_reconcile_idx
  ON public.workflow_executions (runtime_env, started_at)
  WHERE status IN ('running', 'stopping');
