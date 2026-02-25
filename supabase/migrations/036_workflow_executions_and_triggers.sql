-- Migration 036: Workflow Executions and Triggers
-- Adds:
--   1. workflow_executions table — tracks a full workflow run (DAG execution session)
--   2. workflow_triggers table  — webhook + schedule triggers that can fire a workflow
--   3. jobs.workflow_execution_id column — links individual node jobs to their execution

-- ============================================================
-- 1. workflow_executions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workflow_executions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workflow_id         UUID        NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status              TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','running','completed','failed','cancelled','timed_out')),
    trigger_type        TEXT        NOT NULL DEFAULT 'manual'
                            CHECK (trigger_type IN ('manual','webhook','schedule')),
    trigger_data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- Per-node state map: { [nodeId]: { status, jobId, usageLogId, output, error, startedAt, completedAt } }
    node_states         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    total_nodes         INT         NOT NULL DEFAULT 0,
    completed_nodes     INT         NOT NULL DEFAULT 0,
    failed_nodes        INT         NOT NULL DEFAULT 0,
    total_credits_used  INT         NOT NULL DEFAULT 0,
    error_message       TEXT,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id
    ON public.workflow_executions(workflow_id);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_id
    ON public.workflow_executions(user_id);

-- Partial index for active executions only (avoids scanning completed rows)
CREATE INDEX IF NOT EXISTS idx_workflow_executions_active_status
    ON public.workflow_executions(status)
    WHERE status IN ('pending', 'running');

-- updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.workflow_executions;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.workflow_executions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.workflow_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own workflow executions" ON public.workflow_executions
    FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own workflow executions" ON public.workflow_executions
    FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own workflow executions" ON public.workflow_executions
    FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own workflow executions" ON public.workflow_executions
    FOR DELETE USING ((select auth.uid()) = user_id);


-- ============================================================
-- 2. workflow_triggers
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workflow_triggers (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workflow_id         UUID        NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type                TEXT        NOT NULL
                            CHECK (type IN ('webhook','schedule')),
    -- schedule: { cron, timezone, maxExecutions, executionCount }
    -- webhook:  {}
    config              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN     NOT NULL DEFAULT true,
    -- Unique opaque token used as the webhook URL path segment
    webhook_token       TEXT        UNIQUE,
    last_triggered_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique index: enforce webhook_token uniqueness only when set
-- (the column-level UNIQUE already covers non-NULL values, but this is explicit)
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_triggers_webhook_token
    ON public.workflow_triggers(webhook_token)
    WHERE webhook_token IS NOT NULL;

-- updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at ON public.workflow_triggers;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.workflow_triggers
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.workflow_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own workflow triggers" ON public.workflow_triggers
    FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own workflow triggers" ON public.workflow_triggers
    FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own workflow triggers" ON public.workflow_triggers
    FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own workflow triggers" ON public.workflow_triggers
    FOR DELETE USING ((select auth.uid()) = user_id);


-- ============================================================
-- 3. Alter jobs: add workflow_execution_id (nullable FK)
-- ============================================================

ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS workflow_execution_id UUID
        REFERENCES public.workflow_executions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_workflow_execution_id
    ON public.jobs(workflow_execution_id)
    WHERE workflow_execution_id IS NOT NULL;
