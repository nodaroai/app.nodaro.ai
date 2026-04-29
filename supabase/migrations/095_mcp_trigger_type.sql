-- Phase 6 v1.1: track which MCP client originated a job/execution.
--
-- Background:
--   trigger_type lives on workflow_executions only (036_workflow_executions...).
--   Single-node generation jobs don't go through workflow_executions, so
--   we need the column on `jobs` too. Both columns are nullable.

-- 1. Extend the workflow_executions enum.
alter table public.workflow_executions
  drop constraint if exists workflow_executions_trigger_type_check;

alter table public.workflow_executions
  add constraint workflow_executions_trigger_type_check
  check (trigger_type in ('manual', 'webhook', 'schedule', 'app_run', 'mcp'));

-- 2. Add mcp_client text column to BOTH workflow_executions and jobs.
alter table public.workflow_executions add column mcp_client text null;
alter table public.jobs add column mcp_client text null;

-- 3. Indexes for "show me MCP-originated runs" library filters.
create index workflow_executions_mcp_client_idx
  on public.workflow_executions (mcp_client)
  where mcp_client is not null;

create index jobs_mcp_client_idx
  on public.jobs (mcp_client)
  where mcp_client is not null;
