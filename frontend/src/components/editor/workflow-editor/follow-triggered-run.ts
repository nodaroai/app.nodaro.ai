/**
 * The canvas side of a run the editor did not start — a Telegram message, an
 * MCP client, the API, a schedule, a webhook (rules in
 * triggered-run-follow.ts): follow it live the way a Run is followed —
 * spinners on the nodes, then their results — or paint at once one that
 * ended while nobody was looking. Results go through the same mapping a Run
 * uses (`paintRunStates`), so a text answer, a picture or a list lands on the
 * node exactly as if the person had pressed Run.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isStreaming, paintRunStates, streamBackendExecution, type NodeExecutionState } from "./run-handlers"
import type { ExecutionContext } from "./types"
import { laterSingleNodeRunIds, reviewStatesToLoad } from "./newer-run-review"
import { paintableStates, type FollowRun } from "./triggered-run-follow"
import { beginTriggeredRunPaint, markPending, stampEnded } from "./triggered-run-paint"

/**
 * A run that ended while the editor was closed, or between two looks: painted
 * at once. `rows` is the listing the run came from — on a canvas with a
 * render, the newer-run-review holds decide what the run may load (a render a
 * later run finished keeps its result, and the plan it ran waits); a completed
 * single-node run that settled a node after this run keeps that newer result.
 */
export function paintEndedTriggeredRun(run: FollowRun, rows: readonly FollowRun[] = []): void {
  const { nodes, edges } = useWorkflowStore.getState()
  const all = (run.nodeStates ?? {}) as Record<string, NodeExecutionState>
  const { load, region } = reviewStatesToLoad(nodes, edges, { id: run.id, completedAt: run.completedAt, nodeStates: all }, rows)
  const later = laterSingleNodeRunIds(rows, all, run)
  const candidates = Object.fromEntries(
    Object.entries(all).filter(([nodeId]) => !later.has(nodeId) && (!region.has(nodeId) || nodeId in load)),
  )
  const states = paintableStates(nodes, candidates, { id: run.id, completedAt: run.completedAt, active: false })
  if (Object.keys(states).length === 0) return
  // The mark and the result land in the same tick: one save carries both.
  stampEnded(run.id, states)
  markPending(Object.keys(states))
  paintRunStates(states)
}

/**
 * A run that is still going: followed live through the same stream a Run
 * uses. Its trigger card shows that it is working; the nodes it runs spin and
 * then take their results.
 */
export function followTriggeredRun(
  run: FollowRun,
  ctx: ExecutionContext,
  setIsRunning: (running: boolean) => void,
  onEnded: (executionId: string) => void,
): void {
  // Already streamed (the "already running" path got there first): no second set of marks.
  if (isStreaming(run.id, setIsRunning)) return
  streamBackendExecution(run.id, ctx, setIsRunning, onEnded, { isRestore: true, beginTriggered: () => beginTriggeredRunPaint(run) })
}
