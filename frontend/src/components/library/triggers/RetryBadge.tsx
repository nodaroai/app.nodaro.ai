import type { FC } from "react"
import { useT } from "@/lib/i18n"
import type { WorkflowExecution } from "@/lib/api"

/**
 * RetryBadge — "Retry 2 of 3" beside a run's trigger badge: the run is a
 * Schedule Trigger's retry of a failed scheduled run (Retry on failure).
 * Renders nothing for any other run.
 */
export const RetryBadge: FC<{ retry: WorkflowExecution["retry"]; className?: string }> = ({ retry, className = "" }) => {
  const t = useT()
  if (!retry) return null
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 ${className}`}
      data-testid="execution-retry-badge"
    >
      {t("exec.retryBadge", { n: retry.attempt, max: retry.maxAttempts })}
    </span>
  )
}
