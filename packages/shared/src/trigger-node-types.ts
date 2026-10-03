/**
 * The node types the server projects onto `workflow_triggers` rows when a
 * workflow is saved (backend `lib/workflow-trigger-sync.ts`), and that the
 * editor therefore asks the server to re-project after its own saves. One
 * vocabulary for both sides: a projected type added here reaches the
 * editor's "does this save need a sync?" question by construction.
 */
export const SCHEDULE_TRIGGER_NODE_TYPE = "schedule-trigger"
export const WEBHOOK_TRIGGER_NODE_TYPE = "webhook-trigger"
export const TELEGRAM_TRIGGER_NODE_TYPE = "telegram-trigger"
/** Fires on a message that reaches a Telegram account the owner connected (Cloud). */
export const TELEGRAM_ACCOUNT_TRIGGER_NODE_TYPE = "telegram-account-trigger"

export const PROJECTED_TRIGGER_NODE_TYPES: ReadonlySet<string> = new Set([
  SCHEDULE_TRIGGER_NODE_TYPE,
  WEBHOOK_TRIGGER_NODE_TYPE,
  TELEGRAM_TRIGGER_NODE_TYPE,
  TELEGRAM_ACCOUNT_TRIGGER_NODE_TYPE,
])

export function isProjectedTriggerNodeType(type: unknown): type is string {
  return typeof type === "string" && PROJECTED_TRIGGER_NODE_TYPES.has(type)
}
