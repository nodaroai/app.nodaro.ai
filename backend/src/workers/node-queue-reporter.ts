/**
 * What the orchestrator does when a sync-HTTP node reports where it stands
 * while it waits for its route's concurrency slot (`ctx.onNodeQueued`,
 * services/workflow-engine/sync-node-slot.ts):
 *   - the node's `queueInfo` is set on every check and removed once the wait
 *     is over;
 *   - the node states are written to the run's row when a wait starts and
 *     when it ends; a change of place in between is only emitted;
 *   - the run's queued time is persisted when a wait starts and ends, and at
 *     most once every LANE_WAIT_PERSIST_MS while it lasts — such a wait has no
 *     `queued` jobs row, so the sweeps that read a run's queued time see it
 *     only through `workflow_executions.lane_wait_ms`.
 * Never throws: a failed write or emit is never the run's failure.
 */
import { warnLaneRateLimited } from "../lib/concurrency-lanes/hold.js"
import { LANE_WAIT_PERSIST_MS } from "../lib/concurrency-lanes/coordinator-wait.js"
import type { NodeExecutionState, NodeQueueInfo } from "../services/workflow-engine/types.js"

export interface NodeQueueReporterDeps {
  /** The run's node states (mutated in place, as the orchestrator keeps them). */
  nodeStates: Record<string, NodeExecutionState>
  /** Write the node states to the run's row. */
  persistNodeStates: () => Promise<unknown>
  /** Persist the run's queued time (the orchestrator's `noteLaneWait`). */
  noteLaneWait: () => void
  /** Emit `node:updated` for the node. */
  emit: (nodeId: string) => void
  now?: () => number
}

const samePlace = (a: NodeQueueInfo, b: NodeQueueInfo): boolean =>
  a.position === b.position && a.running === b.running && a.limit === b.limit && a.reason === b.reason && a.lane === b.lane

/** The orchestrator's `ctx.onNodeQueued`. */
export function nodeQueueReporter(deps: NodeQueueReporterDeps): (nodeId: string, queue: NodeQueueInfo | null) => void {
  const now = deps.now ?? Date.now
  let laneWaitNotedAt = -Infinity
  const quietly = (what: string, fn: () => void) => {
    try {
      fn()
    } catch (err) {
      warnLaneRateLimited(`a node's queue report could not ${what}`, err)
    }
  }
  return (nodeId, queue) => {
    const state = deps.nodeStates[nodeId]
    if (!state) return
    const prev = state.queueInfo
    if (!queue && !prev) return
    if (queue) state.queueInfo = queue
    else delete state.queueInfo
    const edge = !prev || !queue
    if (edge) {
      quietly("write the node states", () => {
        void deps.persistNodeStates().catch((err: unknown) => { warnLaneRateLimited("a node's queue report could not write the node states", err) })
      })
    }
    if (edge || now() - laneWaitNotedAt >= LANE_WAIT_PERSIST_MS) {
      laneWaitNotedAt = now()
      quietly("persist the run's queued time", deps.noteLaneWait)
    }
    if (edge || !samePlace(prev, queue)) quietly("emit", () => deps.emit(nodeId))
  }
}
