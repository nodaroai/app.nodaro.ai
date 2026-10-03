-- 441_telegram_account_trigger_lane.sql
-- A new trigger lane: `telegram_account`.
--
-- A workflow can start from a message that reaches a Telegram account its
-- owner connected (Integrations -> Telegram account) — the lane sits beside
-- the bot lane (`telegram`), which only sees what is said to a bot. Rows of
-- this lane are projected from the workflow graph at save time
-- (lib/workflow-trigger-sync.ts) and each fire inserts a workflow_executions
-- row with trigger_type = 'telegram_account'.
--
-- BOTH checks widen together — the lesson of 249/438, where only one sibling
-- was widened and every insert on the other failed with check_violation
-- (23514). The values are snake_case on purpose: the guard tests
-- (trigger-type-constraint-sync / workflow-triggers-type-constraint-sync)
-- read literals with a regex that ignores hyphens.
--
-- DROP ... IF EXISTS first so a database edited by hand converges on the same
-- definitions.

ALTER TABLE public.workflow_triggers
  DROP CONSTRAINT IF EXISTS workflow_triggers_type_check;

ALTER TABLE public.workflow_triggers
  ADD CONSTRAINT workflow_triggers_type_check
  CHECK (type IN ('webhook', 'schedule', 'telegram', 'telegram_account'));

ALTER TABLE public.workflow_executions
  DROP CONSTRAINT IF EXISTS workflow_executions_trigger_type_check;

ALTER TABLE public.workflow_executions
  ADD CONSTRAINT workflow_executions_trigger_type_check
  CHECK (trigger_type IN
    ('manual', 'webhook', 'schedule', 'app_run', 'mcp', 'api', 'telegram', 'telegram_account'));
