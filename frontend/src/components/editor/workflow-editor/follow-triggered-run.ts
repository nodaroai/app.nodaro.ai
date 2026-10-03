/**
 * The canvas side of a run a Telegram message started (rules in
 * triggered-run-follow.ts): follow it live the way a Run is followed —
 * spinners on the nodes, then their results — or paint at once one that
 * ended while nobody was looking. Results go through the same mapping a Run
 * uses (`paintRunStates`), so a text answer, a picture or a list lands on the
 * node exactly as if the person had pressed Run.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isStreaming, paintRunStates, streamBackendExecution, type NodeExecutionState } from "./run-handlers"
import type { ExecutionContext } from "./types"
import { paintableStates, type FollowRun } from "./triggered-run-follow"
import { beginTriggeredRunPaint, markPending, stampEnded } from "./triggered-run-paint"

/** A run that ended while the editor was closed, or between two looks: painted at once. */
export function paintEndedTriggeredRun(run: FollowRun): void {
  const states = paintableStates(useWorkflowStore.getState().nodes, (run.nodeStates ?? {}) as Record<string, NodeExecutionState>, {
    id: run.id,
    completedAt: run.completedAt,
    active: false,
  })
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
