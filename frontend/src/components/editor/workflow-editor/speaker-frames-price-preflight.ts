import { speakerFramesRunRefusal } from "@nodaro/render-rules"
import type { WorkflowNode } from "@/types/nodes"
import { nodeRunError } from "./node-run-message"

/**
 * RUN-level refusal for a Speaker Frames that has no price (until P3.7). The
 * node's own executor refuses too, but by then Transcribe, Edit Plan and Camera
 * Switch upstream have run and charged. Asked of the nodes the run will
 * actually execute, in the funnel every run trigger passes through, so nothing
 * starts; the server asks the same rule (`speakerFramesRunRefusal`) before it
 * dispatches an execution. P3.7 deletes it with the flag.
 */
export function speakerFramesPricePreflight(executing: ReadonlyArray<WorkflowNode>): string | null {
  const refusal = speakerFramesRunRefusal(executing.map((n) => ({ id: n.id, type: n.type, data: n.data })))
  if (!refusal) return null
  const first = executing.find((n) => n.id === refusal.nodeIds[0])
  return nodeRunError((first?.data as { label?: string } | undefined)?.label ?? refusal.nodeIds[0], "nodeRun.speakerFramesNotPriced")
}
