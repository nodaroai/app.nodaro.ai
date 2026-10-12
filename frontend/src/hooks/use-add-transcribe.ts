/**
 * The canvas face of `lib/add-transcribe.ts` (D3, decided 2026-10-11):
 * Transcribe with speaker detection inserted and wired into a Speaker View fed a
 * bare video as ONE undo step, and what happened said in a toast. Refused on a
 * read-only canvas, while a run is in progress (it would paint into a graph the
 * run is reading), and whenever the plan refuses (a transcript already wired,
 * no video to transcribe, video mode not open yet: R15).
 */
import { toast } from "sonner"
import { flushPendingUndoSnapshot } from "@/hooks/use-undo-redo"
import { mintNodeId, newNodeDefaultData, useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { isRunInProgress } from "@/components/editor/workflow-editor/clear-run-results"
import { planAddTranscribe, type AddTranscribeResult } from "@/lib/add-transcribe"
import { SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE } from "@nodaro/render-rules"

export type AddTranscribeOutcome = "added" | "refused" | "busy" | "read-only"

export function addTranscribeOnCanvas(nodeId: string): AddTranscribeOutcome {
  const store = useWorkflowStore.getState()
  if (store.isReadOnly) return "read-only"
  if (isRunInProgress(store.nodes)) {
    toast.info(tx("speakerView.tracks.busy"))
    return "busy"
  }
  const defaults = newNodeDefaultData("transcribe")
  if (!defaults) return "refused"
  // Its own undo step: close whatever step is still open.
  flushPendingUndoSnapshot()
  const out: { result?: AddTranscribeResult } = {}
  store.editGraph((graph) => {
    out.result = planAddTranscribe(graph, nodeId, { id: mintNodeId(graph.nodes.map((n) => n.id)), data: defaults })
    return out.result.ok ? { nodes: out.result.nodes, edges: out.result.edges } : null
  })
  const result = out.result
  if (result && !result.ok && result.reason === "video-mode-not-live") {
    toast.error(SPEAKER_VIEW_VIDEO_NOT_LIVE_MESSAGE)
    return "refused"
  }
  if (!result || !result.ok) {
    toast.error(tx(result?.reason === "already-wired" ? "speakerView.video.transcriptAlreadyWired" : "speakerView.video.noVideo"))
    return "refused"
  }
  toast.success(tx("speakerView.video.transcribeAdded"))
  return "added"
}
