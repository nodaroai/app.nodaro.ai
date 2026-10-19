/**
 * The one ending a Stop gives a run the orchestrator is executing: the
 * execution is marked `cancelled` with its node states, and the canvas is told
 * with `execution:cancelled`. Every place the worker meets a Stop (before a
 * re-fetched run starts, at a level boundary, and mid-stage, where a Stop
 * held back part of a stage whose nodes try every one of their kind) ends the
 * run through here, so the write and the event cannot drift apart. The caller
 * sets `ctx.cancelled` and returns.
 */
import { executionEvents } from "../lib/execution-events.js"
import { updateExecutionWithRetry } from "../lib/execution-writes.js"
import type { NodeExecutionState } from "../services/workflow-engine/types.js"

/** Mark the execution cancelled with its node states, then tell the canvas. A write that throws after its retries propagates. */
export async function markExecutionCancelled(
  executionId: string,
  nodeStates: Record<string, NodeExecutionState>,
  counts: { readonly completedNodes: number; readonly failedNodes: number; readonly totalCreditsUsed: number },
): Promise<void> {
  const result = await updateExecutionWithRetry(executionId, {
    status: "cancelled",
    node_states: nodeStates,
    completed_at: new Date().toISOString(),
  })
  // A row someone else already cancelled is the outcome asked for; anything else is logged, as the worker's own writes are.
  if (!result.ok && !result.cancelledRace) {
    console.error(`[orchestrator] cancelled write failed for ${executionId} after ${result.attempts} attempts`)
  }
  try {
    executionEvents.emit(executionId, {
      type: "execution:cancelled",
      executionId,
      nodeStates: { ...nodeStates },
      completedNodes: counts.completedNodes,
      failedNodes: counts.failedNodes,
      totalCreditsUsed: counts.totalCreditsUsed,
    })
  } catch {
    // Never let event emission break the orchestrator.
  }
}
