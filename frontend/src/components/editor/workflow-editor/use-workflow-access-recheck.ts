/**
 * Re-asks, while a canvas is open, what its reader may do with the workflow
 * (T97), so a change of access reaches the canvas without a reload.
 *
 * The load asks once (`applyWorkflowAccess`, `GET /v1/workflows/:id/access`)
 * and records the answer in the workflow store as `loadedAccess`, keyed by
 * workflow id. Access can change while the canvas stays open — an `edit`
 * collaborator lowered to `view`, or removed — and the record would otherwise
 * keep the load's answer until the next load. Every re-check asks the same
 * question of the same route and hands the answer to the same function, which
 * writes it into the same record, so `useWorkflowRealtimeSync` re-decides
 * through `mayHoldStoredRow` as it does after a load: `view` or `none` closes
 * the subscription and polls, `own` or `edit` subscribes. On `view` or `none`
 * the canvas also stops saving at once, and turns read-only as a `view` load
 * does once no node shows a run in flight (`showsARunInFlight`), so a paid run
 * already out still lands its result on its node. A run outside the
 * executors, such as Generate All Assets on a character's or object's page,
 * marks its node through `withRunInFlight`.
 *
 * When it asks:
 *   - every {@link ACCESS_RECHECK_INTERVAL_MS} while the tab is visible — the
 *     timer stops while the tab is hidden;
 *   - at once when the tab is shown again (and the timer restarts);
 *   - at once when a save misses in a way that can mean the access changed —
 *     turned away, or a row the tab can no longer read
 *     (`requestAccessRecheck`, from the save path) — hidden tab or not: a
 *     hidden tab's subscription keeps receiving broadcasts until something
 *     re-asks.
 * Never on mount — the load has just asked — and never before the load has
 * answered for this workflow: there is nothing to re-check, and a load in
 * flight records its own answer.
 *
 * Re-checks are coalesced to one in flight plus one trailing, so a save miss
 * that lands while a timed re-check is out still gets an answer asked after
 * it. Each ask has a deadline, so one that never settles cannot hold the rest
 * behind it. A failed re-check, a timed-out one included, changes nothing
 * (`applyWorkflowAccess` says why); the next trigger asks again.
 */
import { useEffect } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyWorkflowAccess, onAccessRecheckRequest } from "@/hooks/workflow-access-mode"
import { coalesced } from "./coalesced"

/** How often a visible canvas re-asks its access (T97). */
export const ACCESS_RECHECK_INTERVAL_MS = 60_000

export function useWorkflowAccessRecheck(workflowId: string | null | undefined): void {
  // Armed once a load has answered for THIS workflow, and disarmed when a
  // reload or a switch clears that answer.
  const answered = useWorkflowStore((s) => !!workflowId && s.loadedAccess?.workflowId === workflowId)

  useEffect(() => {
    if (!workflowId || !answered) return

    let active = true
    let timer: ReturnType<typeof setInterval> | null = null
    const recheck = coalesced(() => applyWorkflowAccess(workflowId), () => active)

    const resume = (): void => {
      if (timer === null) timer = setInterval(recheck, ACCESS_RECHECK_INTERVAL_MS)
    }
    const pause = (): void => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        pause()
        return
      }
      recheck()
      resume()
    }
    const stopHearingSaves = onAccessRecheckRequest((asked) => {
      if (asked === workflowId) recheck()
    })

    if (document.visibilityState !== "hidden") resume()
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      active = false
      pause()
      document.removeEventListener("visibilitychange", onVisibility)
      stopHearingSaves()
    }
  }, [workflowId, answered])
}
