import { findWordlessTranscriptFeeds } from "@nodaro/shared"
import type { AddCaptionsData, WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { nodeRunError, nodeRunText } from "./node-run-message"

/**
 * Single-node Run pre-flight for Add Captions — the mirror of the route's
 * own superRefine (backend/src/routes/add-captions.ts): a job has a caption
 * source when it carries text, carries captions, or may auto-transcribe.
 *
 * auto-transcribe is opt-OUT, exactly like the worker
 * (`data.auto_transcribe !== false` in workers/handlers/ffmpeg.ts): an
 * undefined flag means "transcribe the input video". The old guard read it
 * opt-IN (`!d.autoTranscribe` blocked on undefined) against a flag nothing
 * in the UI ever writes, which made every style unrunnable from a bare
 * video (#759).
 *
 * Returns the blocking error message, or null when the run may proceed.
 */
export function addCaptionsPreflight(
  d: Pick<AddCaptionsData, "label" | "autoTranscribe">,
  // The sources THIS RUN will send: `text` is the caption text after resolution
  // (wired text, else the node's own `text`, refs settled) — not `inputs.prompt`,
  // which refuses a node carrying its own text and passes one whose `{Label}`
  // resolved to nothing. `transcript` is the json wired into the `transcript`
  // handle, a caption source in the route's own superRefine (hasTopLevelSource).
  sources: { text?: string; transcript?: string },
): string | null {
  const text = sources.text ?? ""
  const hasTranscript = !!sources.transcript
  const mayTranscribe = d.autoTranscribe !== false
  if (!text && !hasTranscript && !mayTranscribe) {
    return nodeRunError(d.label, "nodeRun.noCaptionSource")
  }
  return null
}

/**
 * RUN-level pre-flight for the transcribe → captions chain: a Transcribe node on
 * a lane that returns no per-word timings (`whisper`) whose transcript reaches an
 * Add Captions node. That lane still runs and BILLS, handing back phrase segments
 * with `words: []`, so the run can only end as a paid transcription plus a failed
 * captions node — refuse it before anything starts.
 *
 * `executing` is the set of nodes this run will actually execute: a consumer
 * outside it is invisible to the shared walk (it resolves to "skipped"), so
 * running just the Transcribe node on its own is never blocked.
 *
 * Returns the blocking message, or null when the run may proceed.
 */
export function wordTimingsPreflight(
  executing: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): string | null {
  const hit = findWordlessTranscriptFeeds(executing, edges)[0]
  if (!hit) return null
  const label =
    (executing.find((n) => n.id === hit.transcribeNodeId)?.data as { label?: string } | undefined)?.label ??
    hit.transcribeNodeId
  return nodeRunText(label, hit.message)
}
