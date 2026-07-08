-- Widen workflow_executions.trigger_type to cover the API + Telegram triggers.
--
-- Background:
--   The CHECK constraint has trailed the code twice before (086 added
--   'app_run', 095 added 'mcp'). Two trigger types have been emitted by route
--   handlers WITHOUT ever being added to the constraint:
--     * 'api'      — POST /v1/api/run (routes/api-tokens.ts), shipped in #201.
--     * 'telegram' — routes/telegram-webhook.ts.
--   Both INSERTs are rejected by Postgres with a check_violation (23514) at
--   runtime, surfacing as a generic 500 ("Failed to create execution"). Unit
--   tests mock Supabase, so CI never exercised the constraint. The public
--   Workflow API (/v1/api/run) has therefore been dead-on-arrival since #201.
--
-- Fix: extend the enum to the full set the backend actually emits. Guarded
-- going forward by backend/src/__tests__/trigger-type-constraint-sync.test.ts,
-- which derives the allowed set from THIS migration and fails at PR time if a
-- new trigger_type literal appears in code without a widening migration.

alter table public.workflow_executions
  drop constraint if exists workflow_executions_trigger_type_check;

alter table public.workflow_executions
  add constraint workflow_executions_trigger_type_check
  check (trigger_type in
    ('manual', 'webhook', 'schedule', 'app_run', 'mcp', 'api', 'telegram'));
