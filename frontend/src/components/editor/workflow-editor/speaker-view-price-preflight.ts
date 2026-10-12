import { SPEAKER_VIEW_PRICED, speakerViewRunRefusal, speakerViewVideoRunRefusal } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { nodeRunError } from "./node-run-message"

/**
 * RUN-level refusal for a Speaker View that has no price (`SPEAKER_VIEW_PRICED`,
 * on since C4 — the gate stays, so a withdrawn price is one flag). The node's
 * own executor refuses too, but by then Transcribe, Edit Plan and Camera Switch
 * upstream have run and charged for a render that cannot succeed. Asked of the
 * nodes the run will actually execute, in the funnel every run trigger passes
 * through, so nothing starts. The server asks the same question of the same
 * rule (`speakerViewRunRefusal`) before it dispatches an execution.
 *
 * Returns the blocking message naming the first such node, or null when the
 * run may proceed. The flag is passed in, as the server's check passes it, so
 * a test that stands in for it stands in for this check too.
 */
export function speakerViewPricePreflight(executing: ReadonlyArray<WorkflowNode>): string | null {
  const refusal = speakerViewRunRefusal(executing.map((n) => ({ id: n.id, type: n.type, data: n.data })), SPEAKER_VIEW_PRICED)
  if (!refusal) return null
  const first = executing.find((n) => n.id === refusal.nodeIds[0])
  return nodeRunError((first?.data as { label?: string } | undefined)?.label ?? refusal.nodeIds[0], "nodeRun.speakerViewNotPriced")
}

/**
 * RUN-level refusal for a Speaker View fed a bare video that cannot succeed
 * whatever runs before it (decided 2026-10-11): an edit and a video together,
 * no transcript wired, a video straight from an Upload already as narrow as the
 * target (D18). Asked in the same funnel as the price gate, so Transcribe
 * upstream never charges for a run that is refused anyway; the server asks the
 * same rule (`speakerViewVideoRunRefusal`) before it dispatches an execution.
 * A video that has not run has no size yet: the node's own executor judges it
 * from the measurement.
 */
export function speakerViewVideoPreflight(
  executing: ReadonlyArray<WorkflowNode>,
  allNodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): string | null {
  const plain = (n: WorkflowNode) => ({ id: n.id, type: n.type, data: n.data })
  const refusal = speakerViewVideoRunRefusal(executing.map(plain), allNodes.map(plain), edges)
  return refusal ? refusal.message : null
}
