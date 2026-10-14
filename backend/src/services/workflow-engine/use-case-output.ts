/**
 * A use-case node's output (Tighten Episode, decided 2026-10-13), read off
 * its wrapper job's `output_data` (lib/use-case/wrapper-output.ts): the
 * episode as video or audio, the plan on `json`, the transcript, the take's
 * quality ("proxy" is a review-on run's preview) and its render's bases, and
 * the settings the run was built from. Pure — the one
 * mapping the node's executor (completed and failed) and every rebuild of a
 * node output from a job row (`buildNodeOutputFromJobData`) share. The
 * wrapper's `plan` is the same value as its `json` and is not copied
 * (`NodeOutput.plan` is another node's field).
 */
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
  return {
    ...(videoUrl ? { videoUrl } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    ...(outputData.json !== undefined && outputData.json !== null ? { json: outputData.json } : {}),
    ...(outputData.transcript !== undefined && outputData.transcript !== null ? { transcript: outputData.transcript } : {}),
    ...(quality ? { quality } : {}),
    ...(planBasis ? { planBasis } : {}),
    ...(renderBasis ? { renderBasis } : {}),
    ...(useCaseSettings ? { useCaseSettings } : {}),
  }
}
