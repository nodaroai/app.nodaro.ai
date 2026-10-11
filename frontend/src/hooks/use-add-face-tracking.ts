/**
 * The canvas face of `lib/add-face-tracking.ts` (P3-17 (c)): Speaker Frames
 * inserted and wired into Speaker View as ONE undo step, and what happened
 * said in a toast. Refused on a read-only canvas, while a run is in progress
 * (it would paint into a graph the run is reading), and whenever the plan
 * refuses (tracks already wired, no edit to sample).
 */
import { toast } from "sonner"
import { flushPendingUndoSnapshot } from "@/hooks/use-undo-redo"
import { mintNodeId, newNodeDefaultData, useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { isRunInProgress } from "@/components/editor/workflow-editor/clear-run-results"
import { planAddFaceTracking, type AddFaceTrackingResult } from "@/lib/add-face-tracking"

export type AddFaceTrackingOutcome = "added" | "refused" | "busy" | "read-only"

export function addFaceTrackingOnCanvas(nodeId: string): AddFaceTrackingOutcome {
  const store = useWorkflowStore.getState()
  if (store.isReadOnly) return "read-only"
  if (isRunInProgress(store.nodes)) {
    toast.info(tx("speakerView.tracks.busy"))
    return "busy"
  }
  const defaults = newNodeDefaultData("speaker-frames")
  if (!defaults) return "refused"
  // Its own undo step: close whatever step is still open.
  flushPendingUndoSnapshot()
  const out: { result?: AddFaceTrackingResult } = {}
  store.editGraph((graph) => {
    out.result = planAddFaceTracking(graph, nodeId, { id: mintNodeId(graph.nodes.map((n) => n.id)), data: defaults })
    return out.result.ok ? { nodes: out.result.nodes, edges: out.result.edges } : null
  })
  const result = out.result
  if (!result || !result.ok) {
    toast.error(tx(result?.reason === "already-wired" ? "speakerView.tracks.alreadyWired" : "speakerView.tracks.noEdit"))
    return "refused"
  }
  toast.success(tx("speakerView.tracks.added"))
  return "added"
}
