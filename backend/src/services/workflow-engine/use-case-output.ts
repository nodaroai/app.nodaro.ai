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
 *    node's field). A list result (Trailer's formats) is the node's own list:
 *    its deliveries' URLs on `listResults` (what an Each wire after the node
 *    runs once per), each row stamped with the take's quality and its
 *    render's bases (the same stamps the canvas's own run puts on each row);
 *    `videoUrl` stays the first. The deliveries themselves ride on `formats`
 *    (each file with its format, what the editor names each row by), and the
 *    formats that could not be rendered on `failedFormats`. A clip set (Clip
 *    Pack) is the node's own list the same way: its clips' URLs on
 *    `listResults`, each row stamped with ITS clip's take — its quality, its
 *    clip key, its render's bases (every clip is its own render) and its
 *    still — and the wrapper job. The clips themselves (with each one's title
 *    and hook) ride on `clips`, how many could not be rendered on
 *    `failedClips`, and how many came uncaptioned (their captions could not
 *    be added) on `failedCaptions`. A run on several recordings or a Master
 *    audio reports its cameras (who was put on which camera, the sync and map
 *    notes) on `useCaseCameras`, the node's saved field of that name.
 *  - `usecaseSavedNodeOutput`: the saved-data reader, read off what the node
 *    holds — the use-case branch of `extractSavedNodeOutput`, ahead of its
 *    unit branch.
 */
import { editPlanSavedOutput } from "@nodaro/shared/edl"
import { usecaseCamerasReportOf, usecaseListsItsResult } from "@nodaro/render-rules"
import type { NodeOutput } from "./types.js"

const url = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

export function usecaseJobOutput(
  outputData: Readonly<Record<string, unknown>>,
  /** The wrapper job the row is: every row of a list result names it as its job (a Render final of a take needs a real run to name). */
  jobId?: string,
): NodeOutput {
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
  // A list result (Trailer's formats): the deliveries are the node's own list.
  const delivered = Array.isArray(outputData.formats)
    ? (outputData.formats as Array<{ url?: unknown; format?: unknown } | null>).flatMap((r) => {
        const u = url(r?.url)
        return u ? [{ format: typeof r?.format === "string" ? r.format : "", url: u }] : []
      })
    : []
  const rows = delivered.map((r) => r.url)
  const clips = Array.isArray(outputData.clips) ? clipRowsOf(outputData.clips as unknown[]) : []
  const failedClips = typeof outputData.failedClips === "number" && Number.isInteger(outputData.failedClips) && outputData.failedClips > 0
    ? outputData.failedClips
    : undefined
  const failedCaptions = typeof outputData.failedCaptions === "number" && Number.isInteger(outputData.failedCaptions) && outputData.failedCaptions > 0
    ? outputData.failedCaptions
    : undefined
  const useCaseCameras = usecaseCamerasReportOf(outputData.cameras)
  const failedFormats = Array.isArray(outputData.failedFormats)
    ? (outputData.failedFormats as unknown[]).filter((f): f is string => typeof f === "string" && f.length > 0)
    : []
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
    // Every row is a take of the run: its quality and its render's bases (the cut every format is made from).
    ...(rows.length > 0
      ? { listResults: rows, listResultStamps: rows.map(() => ({ ...(quality ? { quality } : {}), ...(planBasis ? { planBasis } : {}), ...(renderBasis ? { renderBasis } : {}), ...(jobId ? { jobId } : {}) })), formats: delivered }
      : {}),
    ...(failedFormats.length > 0 ? { failedFormats } : {}),
    ...(useCaseCameras ? { useCaseCameras } : {}),
    // Every row is its own clip's take: its own quality, clip key and render's bases.
    ...(clips.length > 0
      ? {
          listResults: clips.map((c) => c.url),
          listResultStamps: clips.map((c) => ({
            ...(c.quality ? { quality: c.quality } : {}),
            ...(c.clipKey ? { clipKey: c.clipKey } : {}),
            ...(c.planBasis ? { planBasis: c.planBasis } : {}),
            ...(c.renderBasis ? { renderBasis: c.renderBasis } : {}),
            ...(c.thumbnailUrl ? { thumbnailUrl: c.thumbnailUrl } : {}),
            ...(jobId ? { jobId } : {}),
          })),
          clips,
        }
      : {}),
    ...(failedClips !== undefined ? { failedClips } : {}),
    ...(failedCaptions !== undefined ? { failedCaptions } : {}),
  }
}

type ClipRow = NonNullable<NodeOutput["clips"]>[number]

/** The wrapper's clips, each with what it carries (a row with no file is no clip). */
function clipRowsOf(raw: readonly unknown[]): ClipRow[] {
  return raw.flatMap((r): ClipRow[] => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return []
    const row = r as Record<string, unknown>
    const u = url(row.url)
    if (!u) return []
    const quality = row.quality === "proxy" || row.quality === "final" ? row.quality : undefined
    return [{
      url: u,
      ...(quality ? { quality } : {}),
      ...(url(row.clipKey) ? { clipKey: url(row.clipKey) } : {}),
      ...(url(row.planBasis) ? { planBasis: url(row.planBasis) } : {}),
      ...(url(row.renderBasis) ? { renderBasis: url(row.renderBasis) } : {}),
      ...(url(row.title) ? { title: url(row.title) } : {}),
      ...(url(row.hook) ? { hook: url(row.hook) } : {}),
      ...(url(row.thumbnailUrl) ? { thumbnailUrl: url(row.thumbnailUrl) } : {}),
      ...(row.captionsFailed === true ? { captionsFailed: true as const } : {}),
    }]
  })
}

/**
 * A use-case node's saved output, read off what the node holds (the
 * orchestrator's `extractSavedNodeOutput`, for "run from here"): the episode it
 * shows, its plan with the person's review applied — the read an Edit Plan's
 * saved output makes (a clip-set edit of Chapters' list too) — and its text
 * (Chapters' show notes). A null plan is none. Undefined when it
 * holds none of them. The server twin of the editor's `usecaseSavedOutput`
 * (use-case-io.ts).
 */
export function usecaseSavedNodeOutput(data: Record<string, unknown>, type: string): NodeOutput | undefined {
  const videoUrl = typeof data.generatedVideoUrl === "string" && data.generatedVideoUrl ? data.generatedVideoUrl : undefined
  const audioUrl = !videoUrl && typeof data.generatedAudioUrl === "string" && data.generatedAudioUrl ? data.generatedAudioUrl : undefined
  // A plan held as null is no plan: nothing on `json`, never the text "null".
  const json = editPlanSavedOutput(data)?.json ?? undefined
  const text = typeof data.generatedText === "string" && data.generatedText ? data.generatedText : undefined
  // A list result (Trailer's formats): its last run's deliveries, the node's own list (as UGC Finish's).
  const saved = usecaseListsItsResult(type) ? data.__listResults : undefined
  const list = Array.isArray(saved) ? saved.filter((v): v is string => typeof v === "string") : undefined
  const out: NodeOutput = { ...(videoUrl ? { videoUrl } : {}), ...(audioUrl ? { audioUrl } : {}), ...(json !== undefined ? { json } : {}), ...(text ? { text } : {}), ...(list && list.length > 0 ? { listResults: list } : {}) }
  return out.videoUrl || out.audioUrl || out.json !== undefined || out.text || out.listResults ? out : undefined
}
