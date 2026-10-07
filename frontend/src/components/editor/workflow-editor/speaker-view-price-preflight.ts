import { speakerViewRunRefusal } from "@nodaro/render-rules"
import type { WorkflowNode } from "@/types/nodes"
import { nodeRunError } from "./node-run-message"

/**
 * RUN-level refusal for a Speaker View that has no price (until C4). The node's
 * own executor refuses too, but by then Transcribe, Edit Plan and Camera Switch
 * upstream have run and charged for a render that cannot succeed. Asked of the
 * nodes the run will actually execute, in the funnel every run trigger passes
 * through, so nothing starts. The server asks the same question of the same
 * rule (`speakerViewRunRefusal`) before it dispatches an execution.
 *
 * Returns the blocking message naming the first such node, or null when the
 * run may proceed. C4 deletes it with the flag.
 */
export function speakerViewPricePreflight(executing: ReadonlyArray<WorkflowNode>): string | null {
  const refusal = speakerViewRunRefusal(executing.map((n) => ({ id: n.id, type: n.type, data: n.data })))
  if (!refusal) return null
  const first = executing.find((n) => n.id === refusal.nodeIds[0])
  return nodeRunError((first?.data as { label?: string } | undefined)?.label ?? refusal.nodeIds[0], "nodeRun.speakerViewNotPriced")
}
