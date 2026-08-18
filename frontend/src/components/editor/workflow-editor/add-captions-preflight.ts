import type { AddCaptionsData } from "@/types/nodes"

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
  inputs: { prompt?: string; captions?: ReadonlyArray<unknown> },
): string | null {
  const text = inputs.prompt ?? ""
  const hasCaptions = Array.isArray(inputs.captions) && inputs.captions.length > 0
  const mayTranscribe = d.autoTranscribe !== false
  if (!text && !hasCaptions && !mayTranscribe) {
    return `Node "${d.label}": no caption source — provide text or re-enable auto-transcribe`
  }
  return null
}
