import { SPEAKER_VIEW_PRICED, speakerViewRunRefusal } from "@nodaro/render-rules"
import type { WorkflowNode } from "@/types/nodes"
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
