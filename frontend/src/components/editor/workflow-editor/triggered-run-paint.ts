/**
 * How a run a Telegram message started paints the canvas while it is followed
 * (rules in triggered-run-follow.ts). Built here, apart from run-handlers.ts,
 * so both entry points can use it: the editor's watch, and the "already
 * running" answer to a Run pressed while such a run goes.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { NodeExecutionState, TriggeredRunPaint } from "./run-handlers"
import { RESULTS_RUN_ID_KEY, paintableStates, triggerNodesOf, type FollowRun } from "./triggered-run-follow"

type States = Record<string, NodeExecutionState>

const ENDED_NODE: ReadonlySet<string> = new Set(["completed", "failed"])

/** Remember on each node that ended in this run that it shows the run (a reload then leaves it be). */
export function stampEnded(runId: string, states: States): void {
  const { updateNodeData } = useWorkflowStore.getState()
  for (const [nodeId, state] of Object.entries(states)) {
    if (ENDED_NODE.has(state.status)) updateNodeData(nodeId, { [RESULTS_RUN_ID_KEY]: runId })
  }
}

/**
 * Nodes about to take this run's state start from "pending": the Run mapping
 * writes a result only on the way INTO "completed", and a node still showing
 * an earlier run's "completed" would otherwise keep that earlier result.
 */
export function markPending(nodeIds: Iterable<string>): void {
  const { updateNodeData } = useWorkflowStore.getState()
  for (const nodeId of nodeIds) updateNodeData(nodeId, { executionStatus: "pending" })
}

/**
 * Start painting a run that is still going: its nodes start from "pending",
 * its trigger card says it is working. The returned paint lets only the
 * paintable states through (marking each node that ends as showing this run,
 * in the same tick as its result, so one save carries both), and `settle`
 * puts back to idle everything it marked that the run never finished — a node
 * a Router skipped, a run that ended before the editor connected, a stream
 * that gave up — and the trigger card.
 */
export function beginTriggeredRunPaint(run: Pick<FollowRun, "id" | "nodeStates">): TriggeredRunPaint {
  const { nodes, updateNodeData } = useWorkflowStore.getState()
  const first = (run.nodeStates ?? {}) as States
  const marked = new Set(Object.keys(paintableStates(nodes, first, { id: run.id, active: true })))
  markPending(marked)
  const triggers = triggerNodesOf(nodes, first)
  // The trigger card's "working" mark, not a run of the trigger: its saved
  // fields (an earlier error included) are not this run's to reset, and a
  // reset would mark the workflow changed on every message.
  for (const nodeId of triggers) {
    updateNodeData(nodeId, { executionStatus: "running", currentJobProgress: 0 }) // run-start-reset-ok: trigger card working mark
  }

  return {
    paintable: (states) => {
      const painted = paintableStates(useWorkflowStore.getState().nodes, states, { id: run.id, active: true })
      for (const nodeId of Object.keys(painted)) marked.add(nodeId)
      stampEnded(run.id, painted)
      return painted
    },
    settle: () => {
      const { nodes: now, updateNodeData: update } = useWorkflowStore.getState()
      for (const node of now) {
        const status = (node.data as Record<string, unknown>).executionStatus
        const leftOver = (marked.has(node.id) || triggers.includes(node.id)) && (status === "pending" || status === "running")
        if (leftOver) update(node.id, { executionStatus: "idle", currentJobProgress: undefined })
      }
    },
  }
}
