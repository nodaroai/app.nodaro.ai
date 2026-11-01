/**
 * A workflow's sync-HTTP node takes its route's concurrency slot HERE, in the
 * orchestrator, before the HTTP hop (decided 2026-10-30: a workflow never
 * fails with `lane_busy`). The lane and provider are the route's own rule
 * (`syncRouteLaneDecision`, the same decision the route's laneGuard makes),
 * asked of the body about to be sent. The slot is taken under the run's hold
 * — at the front of the run's line, waiting up to the queue timeout, never the
 * live-wait limit — and held for the hop only: the request names it in
 * LANE_LEASE_HEADER and the route runs under it, taking no slot of its own.
 *
 * While the node waits:
 *   - the wait is added to the run's `ctx.laneWaitMs` on every check (so the
 *     workflow cap already leaves it out while it lasts) and at the grant;
 *   - the node's `queueInfo` says where it stands (`ctx.onNodeQueued`), and is
 *     cleared once the wait is over;
 *   - a cancelled run or a draining worker ends the wait (the node fails as
 *     cancelled, or the run is handed back).
 * The hop's own `AbortSignal.timeout(NODE_TIMEOUT_MS)` is made inside `hop`,
 * so it starts only once the slot is granted.
 *
 * A route with no rule (it takes no slot in the request, or answers with a job
 * id whose worker job waits for its own slot), or a request its rule says
 * does no lane work, runs `hop` at once with no lease. With enforcement off
 * every slot is granted at once: nothing waits, and the node runs as before.
 */
import { LaneWaitAbortedError } from "../../lib/concurrency-lanes/errors.js"
import { currentConcurrencyHold, warnLaneRateLimited } from "../../lib/concurrency-lanes/hold.js"
import { LANE_LEASE_HEADER } from "../../lib/concurrency-lanes/request-scope.js"
import { withConcurrencySlot } from "../../lib/concurrency-lanes/slot.js"
import { syncRouteLaneDecision } from "../../lib/concurrency-lanes/sync-route-lanes.js"
import { addRunLaneWait } from "../../lib/concurrency-lanes/execution-wait.js"
import type { WaitInfo } from "../../lib/concurrency-lanes/types.js"
import { DrainAbortError, isWorkerDraining } from "../../lib/worker-drain.js"
import { executionCancelledNow } from "./execution-cancel-check.js"
import type { NodeQueueInfo, OrchestratorContext, SimpleNode } from "./types.js"

/** A wait's place in line, as a node state shows it. */
export function nodeQueueInfoOf(wait: WaitInfo): NodeQueueInfo {
  return {
    lane: wait.lane,
    position: wait.position,
    limit: wait.limit,
    running: wait.running,
    reason: wait.reason,
    waitedSeconds: Math.max(0, Math.round(wait.waitedMs / 1000)),
  }
}

/**
 * Run `hop` (the node's HTTP call) holding the slot its route takes for this
 * request, if any. `hop` receives the headers to add: the lease header when a
 * slot is held, none otherwise (no hold, the gate unreachable — the call then
 * ran ungated — or no slot needed).
 */
export async function withSyncNodeSlot<T>(
  node: Pick<SimpleNode, "id" | "type">,
  ctx: OrchestratorContext,
  route: string,
  call: { body: unknown; headers: Readonly<Record<string, string>> },
  hop: (laneHeaders: Record<string, string>) => Promise<T>,
): Promise<T> {
  const decision = syncRouteLaneDecision(route, call.body, call.headers)
  if (!decision) return hop({})

  const started = Date.now()
  /** The wait is credited to the run up to here; null while nothing waited. */
  let creditedTo: number | null = null
  let queued = false
  let checks = 0
  const ended = new AbortController()
  let endedBy: "cancel" | "drain" | null = null
  let granted = false
  const credit = () => {
    const now = Date.now()
    addRunLaneWait(ctx, creditedTo ?? started, now)
    creditedTo = now
  }
  /** Tell the run where the node stands. Never throws: a report is never worth the node's call or its slot's release. */
  const report = (queue: NodeQueueInfo | null) => {
    try {
      ctx.onNodeQueued?.(node.id, queue)
    } catch (err) {
      warnLaneRateLimited("a node's queue report threw", err)
    }
  }
  const clearQueue = () => {
    if (!queued) return
    queued = false
    report(null)
  }
  const onWaiting = (wait: WaitInfo) => {
    credit()
    queued = true
    report(nodeQueueInfoOf(wait))
    if (ctx.cancelled) endedBy ??= "cancel"
    else if (isWorkerDraining()) endedBy ??= "drain"
    if (endedBy) {
      ended.abort()
      return
    }
    // The same throttled read every long wait of the engine makes.
    void executionCancelledNow(ctx, ++checks).then((cancelled) => {
      if (cancelled) {
        endedBy ??= "cancel"
        ended.abort()
      }
    }, () => undefined)
  }

  try {
    return await withConcurrencySlot(
      { lane: decision.lane, provider: decision.provider, jobType: node.type, onWaiting, waitSignal: ended.signal },
      async () => {
        granted = true
        if (creditedTo !== null) credit()
        clearQueue()
        const leaseId = currentConcurrencyHold()?.leaseId
        return hop(leaseId ? { [LANE_LEASE_HEADER]: leaseId } : {})
      },
    )
  } catch (err) {
    // Only a wait this ended: an error of the hop itself is the hop's.
    if (err instanceof LaneWaitAbortedError && endedBy === "cancel") throw new Error("Execution cancelled")
    if (err instanceof LaneWaitAbortedError && endedBy === "drain") throw new DrainAbortError()
    throw err
  } finally {
    // A wait that ended without a slot (a cancel, a drain, the queue timeout)
    // counts up to its end, not only to its last check.
    if (!granted && creditedTo !== null) credit()
    clearQueue()
  }
}
