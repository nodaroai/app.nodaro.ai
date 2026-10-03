import { useEffect, useState } from "react"
import type { ExecutionsTabFocus } from "../executions-tab"

/**
 * The run a notice's View asked the Executions tab to open. It is one-shot:
 * leaving the tab, or the workflow, drops it, so a later visit to the tab
 * (which mounts it afresh) opens nothing it was not asked to open now.
 */
export function useRunFocus(activeTab: string, workflowId: string | null | undefined) {
  const [focus, setFocus] = useState<ExecutionsTabFocus | null>(null)

  useEffect(() => {
    if (activeTab !== "executions") setFocus(null)
  }, [activeTab])

  useEffect(() => {
    setFocus(null)
  }, [workflowId])

  return [focus, setFocus] as const
}
