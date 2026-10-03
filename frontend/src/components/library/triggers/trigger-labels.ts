import type { MessageKey, TFunction } from "@/lib/i18n"
import type { WorkflowExecution } from "@/lib/api"

/**
 * The name of each run lane (`workflow_executions.trigger_type`), wherever a
 * run's source is shown: the executions lists' badge and the editor's notice
 * when a run starts without it. Typed on the lane union, so a lane added
 * there without a name here fails the type check. An id the server sends
 * that the union does not know yet shows as is.
 */
export const TRIGGER_LABEL_KEYS: Readonly<Record<WorkflowExecution["triggerType"], MessageKey>> = {
  manual: "lib.triggerManual",
  webhook: "lib.triggerWebhook",
  schedule: "lib.triggerSchedule",
  telegram: "lib.triggerTelegram",
  telegram_account: "lib.triggerTelegramAccount",
  api: "lib.triggerApi",
  app_run: "lib.triggerAppRun",
  mcp: "lib.triggerViaMcp",
  "single-node": "lib.triggerSingleNode",
}

/** "via Claude" for an MCP run whose client is known; else the lane's name. */
export function triggerSourceLabel(t: TFunction, triggerType: string, mcpClient?: string | null): string {
  if (triggerType === "mcp" && mcpClient) return t("lib.triggerViaClient", { client: mcpClient })
  const key = (TRIGGER_LABEL_KEYS as Readonly<Record<string, MessageKey | undefined>>)[triggerType]
  return key ? t(key) : triggerType
}
