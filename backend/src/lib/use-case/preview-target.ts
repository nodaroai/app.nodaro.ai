/**
 * The run a use-case node's Render final continues, found in an execution
 * (decided 2026-10-13): the wrapper job of the node's Preview take there
 * (`usecasePreviewTarget`, @nodaro/render-rules). An execution that did not
 * run the node hands its take on as a SEED, which names the execution it came
 * from but not the take's own wrapper: seeds are followed back (the caller's
 * own executions only) to the state that ran it. Shared by an app run's
 * Render final and the run that finishes a continue-from-failed lineage's
 * held Preview (lib/continuation-held-final.ts). Reads only.
 */
import { usecasePreviewTarget, type UseCaseRenderFinalTarget } from "@nodaro/render-rules"
import { loadContinuationSource } from "../../services/workflow-engine/run-continuation.js"

type ContinuationSourceRow = NonNullable<Awaited<ReturnType<typeof loadContinuationSource>>>

/** How many seeds a use-case take is followed back through to the run that made it. */
export const MAX_SEED_HOPS = 8

/**
 * A use-case node's Preview in `source`, or null (no Preview take, a run not
 * named, someone else's execution on the way). `nodeType` is the node's type
 * on the graph the run executes (a list-result type's list is its result).
 * Throws on a read error.
 */
export async function usecasePreviewTargetIn(
  source: ContinuationSourceRow,
  nodeId: string,
  nodeType: string | undefined,
  userId: string,
  isRenderNode: (id: string) => boolean,
): Promise<UseCaseRenderFinalTarget | null> {
  let state = source.nodeStates?.[nodeId] as { seededFromExecution?: unknown; jobId?: unknown } | undefined
  for (let hop = 0; hop < MAX_SEED_HOPS && state && state.jobId === undefined && typeof state.seededFromExecution === "string"; hop++) {
    const earlier = await loadContinuationSource(state.seededFromExecution, { withStates: true, isRenderNode })
    if (!earlier || earlier.userId !== userId) return null
    state = earlier.nodeStates?.[nodeId] as typeof state
  }
  return usecasePreviewTarget(state, nodeType)
}
