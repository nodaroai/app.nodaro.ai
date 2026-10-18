/**
 * A use-case node's output (Tighten Episode, decided 2026-10-13). Two pure
 * mappings live here:
 *
 *  - `usecaseJobOutput`: read off its wrapper job's `output_data`
 *    (lib/use-case/wrapper-output.ts): the episode as video or audio, the plan
 *    on `json` (Chapters: the chapter list, its show notes on `text`), the
 *    transcript, the take's quality ("proxy" is a review-on run's preview) and
 *    its render's bases, and the settings the run was built from, and the
 *    episode's length (`durationSec`, with the take only: what a Trim, Loop or
 *    Combine Videos after the node is charged by). The one mapping the node's
 *    executor (completed and failed) and every rebuild of a node output from a
 *    job row (`buildNodeOutputFromJobData`) share. The wrapper's `plan` is the
 *    same value as its `json` and is not copied (`NodeOutput.plan` is another
 *    node's field).
 *  - `usecaseSavedNodeOutput`: the saved-data reader, read off what the node
 *    holds — the use-case branch of `extractSavedNodeOutput`, ahead of its
 *    unit branch.
 */
import { editPlanSavedOutput } from "@nodaro/shared/edl"
import type { NodeOutput } from "./types.js"

const url = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

export function usecaseJobOutput(outputData: Readonly<Record<string, unknown>>): NodeOutput {
  const videoUrl = url(outputData.videoUrl)
  const audioUrl = videoUrl ? undefined : url(outputData.audioUrl)
  // The quality is the take's: no take, no quality.
  const quality = (videoUrl || audioUrl) && (outputData.quality === "proxy" || outputData.quality === "final") ? outputData.quality : undefined
  // The take's stamps (its render's bases), with the take only; the run's settings always.
  const basis = (v: unknown) => (videoUrl || audioUrl) && typeof v === "string" && v.length > 0 ? v : undefined
  const planBasis = basis(outputData.planBasis)
  const renderBasis = basis(outputData.renderBasis)
  const settings = outputData.useCaseSettings
  const useCaseSettings = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Readonly<Record<string, unknown>>) : undefined
  const durationSec = (videoUrl || audioUrl) && typeof outputData.durationSec === "number" && Number.isFinite(outputData.durationSec) && outputData.durationSec > 0
    ? outputData.durationSec
    : undefined
  // Chapters: the show notes on `text`, the chapter list on `json`.
  const text = typeof outputData.text === "string" && outputData.text.length > 0 ? outputData.text : undefined
  return {
    ...(videoUrl ? { videoUrl } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    ...(outputData.json !== undefined && outputData.json !== null ? { json: outputData.json } : {}),
    ...(outputData.transcript !== undefined && outputData.transcript !== null ? { transcript: outputData.transcript } : {}),
    ...(quality ? { quality } : {}),
    ...(planBasis ? { planBasis } : {}),
    ...(renderBasis ? { renderBasis } : {}),
    ...(useCaseSettings ? { useCaseSettings } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(text ? { text } : {}),
  }
}

/**
 * A use-case node's saved output, read off what the node holds (the
 * orchestrator's `extractSavedNodeOutput`, for "run from here"): the episode it
 * shows, its plan with the person's review applied — the read an Edit Plan's
 * saved output makes — and its text (Chapters' show notes). Undefined when it
 * holds none of them. The server twin of the editor's `usecaseSavedOutput`
 * (use-case-io.ts).
 */
export function usecaseSavedNodeOutput(data: Record<string, unknown>): NodeOutput | undefined {
  const videoUrl = typeof data.generatedVideoUrl === "string" && data.generatedVideoUrl ? data.generatedVideoUrl : undefined
  const audioUrl = !videoUrl && typeof data.generatedAudioUrl === "string" && data.generatedAudioUrl ? data.generatedAudioUrl : undefined
  const json = editPlanSavedOutput(data)?.json
  const text = typeof data.generatedText === "string" && data.generatedText ? data.generatedText : undefined
  const out: NodeOutput = { ...(videoUrl ? { videoUrl } : {}), ...(audioUrl ? { audioUrl } : {}), ...(json !== undefined ? { json } : {}), ...(text ? { text } : {}) }
  return out.videoUrl || out.audioUrl || out.json !== undefined || out.text ? out : undefined
}
