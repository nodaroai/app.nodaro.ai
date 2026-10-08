/**
 * The open-time newer-run check of a review (TA3 c), asked once per open of a
 * render and shared by the cut review and the Clip Pack inspector:
 * `newerRun` is `undefined` while the answer is out, `null` when the canvas
 * shows the newest run, else the patches loading it would apply. After 15 s
 * with no answer `newerRunCheckTimedOut` turns true (decided 2026-10-07), and
 * the gate stops holding the runs on it; an answer that comes later still
 * lands. `loadNewerRun` lands the newer run's results (never while locked).
 */
import { useCallback, useEffect, useState } from "react"
import {
  applyNewerRun,
  NEWER_RUN_CHECK_TIMEOUT_MS,
  newerRunOnServer,
  type NewerRunPatches,
} from "@/components/editor/workflow-editor/newer-run-check"
import { useWorkflowStore } from "./use-workflow-store"

export interface NewerRunCheck {
  /** A newer run's changes; `undefined` while the check is out, `null` when there is none. */
  readonly newerRun: NewerRunPatches | null | undefined
  /** The check has had no answer for `NEWER_RUN_CHECK_TIMEOUT_MS`. */
  readonly newerRunCheckTimedOut: boolean
  readonly loadNewerRun: () => void
}

export function useNewerRunCheck(renderId: string, locked: boolean): NewerRunCheck {
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const checkKey = workflowId ? `${workflowId}\u0000${renderId}` : null
  const [newer, setNewer] = useState<{ readonly key: string; readonly patches: NewerRunPatches | null } | null>(null)
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null)
  useEffect(() => {
    if (!checkKey || !workflowId) return
    let live = true
    // Each check gets its own 15 s: a timeout left from an earlier visit to
    // this render must not let its runs go before this check has had its time.
    setTimedOutKey(null)
    const timer = setTimeout(() => {
      if (live) setTimedOutKey(checkKey)
    }, NEWER_RUN_CHECK_TIMEOUT_MS)
    const now = useWorkflowStore.getState()
    void newerRunOnServer(workflowId, now.nodes, now.edges).then((patches) => {
      clearTimeout(timer)
      if (live) setNewer({ key: checkKey, patches })
    })
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [checkKey, workflowId])
  const newerRun = !checkKey ? null : newer?.key === checkKey ? newer.patches : undefined
  const newerRunCheckTimedOut = newerRun === undefined && timedOutKey === checkKey
  const loadNewerRun = useCallback(() => {
    if (locked || !checkKey || newer?.key !== checkKey || !newer.patches) return
    // Cleared only once the results are written: the banner stays otherwise.
    if (!applyNewerRun(newer.patches)) return
    setNewer({ key: checkKey, patches: null })
  }, [locked, checkKey, newer])
  return { newerRun, newerRunCheckTimedOut, loadNewerRun }
}
