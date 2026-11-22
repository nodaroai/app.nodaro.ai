/**
 * Video Remake's "Download side by side" (pure): which stretch of which clip a
 * finished run was made from, and where its side-by-side file is kept.
 * The route (ee/routes/video-remake-side-by-side.ts) reads the job; the job
 * (ee/lib/video-remake-side-by-side-job.ts) renders the file with
 * `composeSideBySide` (providers/video/side-by-side.ts).
 *
 * THE STRETCH. A run sends one stretch of its clip (`input_data.videoUrl`) and
 * the result is that stretch remade; the engine records it:
 *
 * - a preview: `previewStart` and its length (`__castSwapClipSec`, the 4 s);
 * - a full Pulse run that sent a cut of the clip: the cut (`motionCut`, an
 *   older run's `klingCut`, else the server-only `__castSwapKlingCut`);
 * - any other full run: the clip from its start, `__castSwapClipSec` long
 *   (the clip's own length; `sourceDurationSec` for a run that recorded none).
 *
 * A Full Quality version (`fullQualityOf`) has no inputs of its own: it is
 * its draft made again over the same stretch, so the stretch and the clip are
 * the draft's (input and output). A trend run's clip is the trend's hidden
 * source (`__videoUrl`), which its runner never sees (the tools feed shows a
 * trend run's result alone): only an administrator gets its side by side.
 *
 * THE FILE is one per run and recipe, in the run's own key family
 * (`videos/<jobId>-side-by-side-…`, `isOwnedObjectKey`), so the run's
 * reapers and a content restriction reach it once its address is recorded in
 * the run's `output_data` (`SIDE_BY_SIDE_FIELD`, server-only). Its name ends in
 * a keyed hash of the run's id: a result's address is shared freely (Copy
 * link, Share) and has the run's id in it, while the side by side shows the
 * person's own clip, so its address must not be guessable from the result's.
 */
import { sideBySideVideoKey } from "../../lib/job-output-keys.js"

/**
 * The recipe the file is rendered by. Bump it when the picture changes
 * (layout, labels, encode): a recorded file of another recipe is rendered
 * again, under a new name (the CDN keeps an address's bytes for a year).
 */
export const SIDE_BY_SIDE_RECIPE = 1

/** The run's `output_data` key the file's record is kept under (server-only: `__`, stripped from every job read). */
export const SIDE_BY_SIDE_FIELD = "__sideBySide"

/** A preview's length when the run recorded none: Video Remake's preview. */
export const PREVIEW_SECONDS = 4

/** The job types a Video Remake run carries: a run, and a Full Quality version (its own queue name). */
export const VIDEO_REMAKE_JOB_TYPES: ReadonlySet<string> = new Set(["cast-swap", "cast-swap-full-quality"])

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null)
const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null)
const nonNegative = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)

/** The run as the plan reads it: the job's raw columns (server-only keys included). */
export interface SideBySideRun {
  readonly id: string
  readonly status: string
  readonly job_type?: string | null
  readonly input_data: unknown
  readonly output_data: unknown
}

/** Where the side by side's original comes from: the clip, and the stretch of it the result was made from. */
export interface SideBySideSource {
  readonly originalUrl: string
  readonly startSec: number
  readonly lengthSec: number
}

/** Why a run has no side by side. */
export type SideBySideRefusal =
  /** Not a Video Remake run. */
  | "not_video_remake"
  /** Not finished, or finished with no video. */
  | "not_finished"
  /** A trend run, for its runner: its clip is the trend's. */
  | "trend_run"
  /** No clip is known (a Full Quality whose draft is gone, a run that recorded none). */
  | "no_clip"

export type SideBySidePlan =
  | { readonly ok: true; readonly resultUrl: string; readonly source: SideBySideSource }
  | { readonly ok: false; readonly refusal: SideBySideRefusal }

/** Whether the job is a Video Remake run: its queue name, else (an older insert path) its input's type. */
export function isVideoRemakeRun(run: Pick<SideBySideRun, "job_type" | "input_data">): boolean {
  if (typeof run.job_type === "string" && VIDEO_REMAKE_JOB_TYPES.has(run.job_type)) return true
  return isRec(run.input_data) && run.input_data.type === "cast-swap"
}

/** The draft a Full Quality version was made from, or null for any other run. */
export function fullQualityDraftId(run: Pick<SideBySideRun, "input_data">): string | null {
  return isRec(run.input_data) ? text(run.input_data.fullQualityOf) : null
}

/** A recorded cut (`{ startSec, durationSec }`), when it is well formed. */
function cutOf(value: unknown): { startSec: number; durationSec: number } | null {
  if (!isRec(value)) return null
  const startSec = nonNegative(value.startSec)
  const durationSec = positive(value.durationSec)
  return startSec !== null && durationSec !== null ? { startSec, durationSec } : null
}

/**
 * The stretch the result was made from, read off the inputs and outputs that
 * hold it (a Full Quality's: its draft's). `fallbackSec`: the length when the
 * run recorded none (the result's own).
 */
export function sideBySideStretch(input: Rec, output: Rec, fallbackSec: number): { startSec: number; lengthSec: number } {
  const clipSec = positive(output.__castSwapClipSec)
  if (input.preview === true) {
    return { startSec: nonNegative(input.previewStart) ?? 0, lengthSec: clipSec ?? PREVIEW_SECONDS }
  }
  const cut = cutOf(output.motionCut) ?? cutOf(output.klingCut) ?? cutOf(output.__castSwapKlingCut)
  if (cut) return { startSec: cut.startSec, lengthSec: cut.durationSec }
  return { startSec: 0, lengthSec: clipSec ?? positive(input.sourceDurationSec) ?? fallbackSec }
}

/**
 * What the run's side by side is made of, or why it has none. `draft` is the
 * draft of a Full Quality version (`fullQualityDraftId`), null when it could
 * not be read; `admin` lets an administrator have a trend run's.
 */
export function sideBySidePlan(run: SideBySideRun, draft: SideBySideRun | null, opts: { readonly admin: boolean }): SideBySidePlan {
  if (!isVideoRemakeRun(run)) return { ok: false, refusal: "not_video_remake" }
  const output = isRec(run.output_data) ? run.output_data : {}
  const resultUrl = text(output.videoUrl)
  if (run.status !== "completed" || resultUrl === null) return { ok: false, refusal: "not_finished" }
  const fullQuality = fullQualityDraftId(run) !== null
  const from = fullQuality ? draft : run
  if (!from) return { ok: false, refusal: "no_clip" }
  const input = isRec(from.input_data) ? from.input_data : {}
  const fromOutput = isRec(from.output_data) ? from.output_data : {}
  const trend = isRec(input.trend)
  if (trend && !opts.admin) return { ok: false, refusal: "trend_run" }
  const originalUrl = text(input.videoUrl) ?? (opts.admin ? text(input.__videoUrl) : null)
  if (originalUrl === null) return { ok: false, refusal: "no_clip" }
  const fallbackSec = positive(output.durationSec) ?? positive(fromOutput.durationSec) ?? PREVIEW_SECONDS
  return { ok: true, resultUrl, source: { originalUrl, ...sideBySideStretch(input, fromOutput, fallbackSec) } }
}

/** The file's record in the run's `output_data` (`SIDE_BY_SIDE_FIELD`). */
export interface SideBySideRecord {
  readonly v: number
  readonly url: string
  readonly width: number
  readonly height: number
  readonly layout: "stack" | "side"
}

/** The run's recorded file, when it is one of the current recipe. */
export function recordedSideBySide(output: unknown): SideBySideRecord | null {
  if (!isRec(output)) return null
  const rec = output[SIDE_BY_SIDE_FIELD]
  if (!isRec(rec) || rec.v !== SIDE_BY_SIDE_RECIPE) return null
  const url = text(rec.url)
  const width = positive(rec.width)
  const height = positive(rec.height)
  const layout = rec.layout === "stack" || rec.layout === "side" ? rec.layout : null
  return url && width && height && layout ? { v: SIDE_BY_SIDE_RECIPE, url, width, height, layout } : null
}

/** The recipe of a recorded file of an older recipe (its key is then rebuilt, never read off the row), else null. */
export function staleSideBySideRecipe(output: unknown): number | null {
  if (!isRec(output)) return null
  const rec = output[SIDE_BY_SIDE_FIELD]
  return isRec(rec) && typeof rec.v === "number" && Number.isInteger(rec.v) && rec.v > 0 && rec.v !== SIDE_BY_SIDE_RECIPE ? rec.v : null
}

/** The file's object key for `recipe` (the current one by default): the run's key family, the recipe and a keyed hash (`sideBySideVideoKey`). */
export function sideBySideObjectKey(jobId: string, secret: string, recipe: number = SIDE_BY_SIDE_RECIPE): string {
  return sideBySideVideoKey(jobId, secret, recipe)
}

/** The file's name for the person's download: `nodaro-remake-side-by-side-<first 8 of the run's id>.mp4`. */
export function sideBySideFileName(jobId: string): string {
  return `nodaro-remake-side-by-side-${jobId.slice(0, 8)}.mp4`
}
