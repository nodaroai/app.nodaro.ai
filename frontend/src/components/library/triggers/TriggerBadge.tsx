import type { FC } from "react"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * TriggerBadge — small colored pill showing how an execution was triggered.
 *
 * Used in the executions list (per-workflow tab + global dashboard page).
 * The "mcp" variant renders "via {mcpClient}" (e.g. "via Claude") when the
 * caller passes through `mcpClient` from the row, and falls back to "via MCP"
 * when the client name is unknown.
 */
export interface TriggerBadgeProps {
  triggerType: "manual" | "webhook" | "schedule" | "app_run" | "mcp" | "single-node" | string
  mcpClient?: string | null
  className?: string
}

const LABELS: Record<string, MessageKey> = {
  manual: "lib.triggerManual",
  webhook: "lib.triggerWebhook",
  schedule: "lib.triggerSchedule",
  app_run: "lib.triggerAppRun",
  mcp: "lib.triggerViaMcp",
  "single-node": "lib.triggerSingleNode",
}

const COLORS: Record<string, string> = {
  manual: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  webhook: "bg-blue-200 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  schedule: "bg-purple-200 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  app_run: "bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200",
  mcp: "bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  "single-node": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
}

const FALLBACK_COLOR = "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"

export const TriggerBadge: FC<TriggerBadgeProps> = ({ triggerType, mcpClient, className = "" }) => {
  const t = useT()
  const labelKey: MessageKey | undefined = LABELS[triggerType]
  const label =
    triggerType === "mcp" && mcpClient
      ? t("lib.triggerViaClient", { client: mcpClient })
      : labelKey ? t(labelKey) : triggerType
  const color = COLORS[triggerType] ?? FALLBACK_COLOR
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${color} ${className}`}
    >
      {label}
    </span>
  )
}
