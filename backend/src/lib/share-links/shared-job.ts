/**
 * One job as a share link shows it, and whether it may be shown at all (pure).
 *
 * A job may be shared when it is the owner's own finished result that the
 * platform would let anyone see: completed, with an image, video or sound to
 * show, not restricted by an administrator (a restriction is also the job's
 * legal hold, migration 582), not kept private (`jobs.force_private`: made from
 * private inputs, a preview render, work of a workspace) and not one whose
 * prompt or name trips the content filter that keeps work out of the public
 * gallery (the worker keeps such an output private, video-worker.ts). A job in
 * the Trash and a child job of a larger run read as jobs that do not exist,
 * as on every read by id: the reads that load a job leave them out.
 *
 * The same rule, minus the address checks, is written once more in SQL for the
 * counts (`share_link_session_summaries`, migration 680);
 * `__tests__/share-links-sql-parity.test.ts` holds the two together.
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { CAST_SWAP_ENGINE_WHEN_OMITTED, NODARO_MOTION_ENGINE_NAMES, VIDEO_REMAKE_FLASH_ENGINE_NAMES, nodaroMotionEngineFrom, videoRemakeFlashEngineFrom } from "@nodaro/shared/models"
import { isPromptBlocked } from "../../config/content-filter.js"
import { redactPrivateJobOutput } from "../public-job-data.js"
import { isShareableAddress, publicSettingsOf, referencesOf } from "./settings.js"
import { displayPromptOf } from "./display-prompt.js"
import { effectiveJobCover } from "../job-cover/effective-cover.js"
import { cleanAssetName, songTakeTitle } from "../asset-names.js"
import { shareToolOf } from "./tool-names.js"
import type { SharedJob, SharedMediaKind, SharedReference, ShareRefusal } from "./types.js"

/** The job columns a share read selects (and `title` / `cover_url` once each column exists, lib/jobs-optional-column.ts). */
export const SHARE_JOB_COLUMNS =
  "id, user_id, status, job_type, input_data, output_data, created_at, parent_job_id, restricted_at, force_private, deleted_at"

export interface ShareJobRow {
  readonly id: string
  readonly user_id?: string | null
  readonly status: string | null
  readonly job_type?: string | null
  readonly input_data: unknown
  readonly output_data: unknown
  readonly created_at: string
  readonly parent_job_id?: string | null
  readonly restricted_at?: string | null
  readonly force_private?: boolean | null
  readonly deleted_at?: string | null
  readonly title?: string | null
  readonly cover_url?: string | null
}

/** The `input_data` texts the content filter reads (beside the job's `title`). */
export const CONTENT_FILTER_TEXT_FIELDS = ["prompt", "userPrompt", "text"] as const

/** The output keys that carry a job's media, in the order a link prefers them. */
export const MEDIA_OUTPUT_KEYS: ReadonlyArray<readonly [SharedMediaKind, string, string]> = [
  ["video", "videoUrl", "videoUrls"],
  ["image", "imageUrl", "imageUrls"],
  ["audio", "audioUrl", "audioUrls"],
]

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)

/** A file address a link may hand out: http(s), never signed. */
function isOutputAddress(value: unknown): value is string {
  if (typeof value !== "string") return false
  return isShareableAddress(value) || isShareableAddress(value.replace(/^http:/i, "https:"))
}

export interface JobMedia {
  readonly kind: SharedMediaKind
  readonly url: string
  readonly urls: readonly string[]
}

/** The media a job's output shows: its video, else its image, else its sound. */
export function mediaOf(outputData: unknown): JobMedia | null {
  const out = record(redactPrivateJobOutput(outputData))
  for (const [kind, one, many] of MEDIA_OUTPUT_KEYS) {
    const list = Array.isArray(out[many]) ? (out[many] as unknown[]).filter(isOutputAddress) : []
    const first = isOutputAddress(out[one]) ? out[one] : list[0]
    if (!first) continue
    const urls = [first, ...list.filter((u) => u !== first)]
    return { kind, url: first, urls }
  }
  return null
}

/** Whether the job's own texts trip the content filter (the gallery's word list). */
export function contentFiltered(row: Pick<ShareJobRow, "input_data" | "title">): boolean {
  const input = record(row.input_data)
  if (CONTENT_FILTER_TEXT_FIELDS.some((field) => isPromptBlocked(str(input[field])))) return true
  return isPromptBlocked(str(row.title))
}

/** The `input_data` flags a request kept its job private with (the column is the usual one; these are read too). */
export const PRIVATE_INPUT_FLAGS = ["forcePrivate", "force_private"] as const

function keptPrivateByInput(inputData: unknown): boolean {
  const input = record(inputData)
  return PRIVATE_INPUT_FLAGS.some((flag) => input[flag] === true)
}

/** Why this job may not be shared, or null when it may. Not asked of a trashed or child job (never loaded). */
export function shareRefusalOf(row: ShareJobRow): ShareRefusal | null {
  if (row.restricted_at) return "restricted"
  if (row.status !== "completed") return "not_completed"
  if (row.force_private === true || keptPrivateByInput(row.input_data)) return "private_output"
  if (contentFiltered(row)) return "content_filtered"
  if (!mediaOf(row.output_data)) return "no_media"
  return null
}

/** Whether this is a trend run (lib/public-job-data.ts `isTrendRun`'s test). */
export function isTrendRunInput(inputData: unknown): boolean {
  return record(inputData).trend != null
}

/**
 * The model a link names: a Video Remake run's engine by its public name, else
 * the job's model as the public catalog lists it. Never a vendor or a route:
 * an id the catalog does not list (or hides) names no model.
 */
export function sharedModelOf(inputData: unknown): { id: string; name: string } | null {
  const input = record(inputData)
  if (input.type === "cast-swap") {
    // A Flash choice's run is named as the choice (Nodaro Prism Flash, Nodaro Pulse Flash).
    const flash = videoRemakeFlashEngineFrom(input.engine)
    if (flash) return { id: flash, name: VIDEO_REMAKE_FLASH_ENGINE_NAMES[flash] }
    const engine = nodaroMotionEngineFrom(input.engine ?? CAST_SWAP_ENGINE_WHEN_OMITTED)
    return engine ? { id: engine, name: NODARO_MOTION_ENGINE_NAMES[engine] } : null
  }
  for (const candidate of [input.resolvedModel, input.model, input.provider]) {
    const id = str(candidate)
    if (!id || !Object.hasOwn(MODEL_CATALOG, id)) continue
    const entry = MODEL_CATALOG[id]!
    if (entry.pickerHidden === true) continue
    return { id: entry.id, name: entry.label }
  }
  return null
}

const positive = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)

/** The prompt as the person wrote it (`userPrompt`, else `prompt`, else a speech job's `text`), and which key it came from. */
function promptOf(input: Record<string, unknown>): { prompt: string | null; fromText: boolean } {
  const written = str(input.userPrompt) ?? str(input.prompt)
  if (written) return { prompt: written, fromText: false }
  const text = str(input.text)
  return text ? { prompt: text, fromText: true } : { prompt: null, fromText: false }
}

/**
 * A song's own title: the title of the take the link shows (`url`), else, when
 * that take is the job's first, the job's `sunoTitle`. Never one the content
 * filter would keep out of the gallery.
 */
export function songTitleOf(out: Record<string, unknown>, url: string): string | undefined {
  const firstTake = out.audioUrl === url || (Array.isArray(out.audioUrls) && out.audioUrls[0] === url)
  const title = songTakeTitle(out, [url]) ?? (firstTake ? cleanAssetName(out.sunoTitle) : undefined)
  return title && !isPromptBlocked(title) ? title : undefined
}

/**
 * A shareable job as the link shows it (call `shareRefusalOf` first: null media
 * answers null here). `references` is given only with `allowCopy`, and never
 * for a trend run, whose pictures and clip are the platform's recipe.
 * `withoutReference` drops a reference the caller found restricted.
 */
export function toSharedJob(
  row: ShareJobRow,
  opts: { readonly allowCopy: boolean; readonly withoutReference?: (url: string) => boolean },
): SharedJob | null {
  const media = mediaOf(row.output_data)
  if (!media) return null
  const input = record(row.input_data)
  const out = record(redactPrivateJobOutput(row.output_data))
  const trend = isTrendRunInput(input) ? record(input.trend) : null
  const { prompt, fromText } = trend ? { prompt: null, fromText: false } : promptOf(input)
  const negativePrompt = trend ? null : str(input.negativePrompt)
  const references: SharedReference[] | undefined =
    opts.allowCopy && !trend
      ? referencesOf(input, new Set(media.urls)).filter((r) => !(opts.withoutReference?.(r.url) ?? false))
      : undefined
  const width = positive(out.width)
  const height = positive(out.height)
  const durationSec = positive(out.durationSec) ?? positive(out.duration)
  const type = str(input.type) ?? str(row.job_type) ?? "unknown"
  const songTitle = media.kind === "audio" ? songTitleOf(out, media.url) : undefined
  return {
    id: row.id,
    type,
    mediaKind: media.kind,
    outputUrl: media.url,
    ...(media.urls.length > 1 ? { outputUrls: media.urls } : {}),
    ...(width !== undefined && height !== undefined ? { width, height } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    title: str(row.title),
    ...(songTitle ? { songTitle } : {}),
    toolName: shareToolOf(type)?.name ?? null,
    coverUrl: effectiveJobCover({ cover_url: row.cover_url, output_data: out }),
    createdAt: row.created_at,
    prompt,
    displayPrompt: displayPromptOf(prompt, input),
    ...(negativePrompt ? { negativePrompt } : {}),
    model: sharedModelOf(input),
    settings: trend ? {} : publicSettingsOf(input, fromText ? ["text"] : []),
    ...(references ? { references } : {}),
    ...(trend && str(trend.slug) && str(trend.name) ? { trend: { slug: str(trend.slug)!, name: str(trend.name)! } } : {}),
  }
}
