/**
 * The pieces of an alternate route (lib/alternate-route.ts) that both the
 * worker's run and its recovery read: the neutral request built from the
 * default route's prepared body, and the job's own record of the route.
 *
 * No I/O here.
 */
import type { PluginAlternateRouteRequest } from "./private-plugins/types.js"

/** The job types an alternate route may run: the two video generation lanes that reach the seam. */
export type AlternateRouteJobType = "image-to-video" | "text-to-video"

/** `jobs.provider_kind` of a job an alternate route holds. Never `kie-*`: such a kind reads as "ran on the default upstream". */
export const ALTERNATE_ROUTE_PROVIDER_KIND = "alternate-route"

/** `jobs.provider_task_id` prefix of an alternate route's task reference. */
export const ALTERNATE_ROUTE_REF_PREFIX = "alt:"

/** `jobs.provider_task_id` of a job claimed for an alternate route whose task reference is not saved yet. Never a reference. */
export const ALTERNATE_ROUTE_CLAIM_REF = `${ALTERNATE_ROUTE_REF_PREFIX}claimed`

/**
 * The route's record on the job's `input_data`. A `__` key: server-only,
 * dropped from every job read (`redactPrivateJobData`, lib/public-job-data.ts).
 */
export const ALTERNATE_ROUTE_KEY = "__alternateRoute"

/** The default route's request exactly as it was prepared: what a fallback sends. */
export interface SavedDefaultRequest {
  /** The default upstream's task model. */
  readonly taskModel: string
  /** The catalog model id (the billing key the default upstream's egress reads). */
  readonly modelKey: string
  readonly body: Readonly<Record<string, unknown>>
}

export type AlternateRouteState = "claimed" | "running" | "resubmitting" | "fell-back"

export interface AlternateRouteRecord {
  readonly state: AlternateRouteState
  readonly at: number
  readonly routeId?: string
  readonly taskRef?: string
  readonly reason?: string
  /** The upstream's words that ended the route (kept with a resend, for its failure). */
  readonly message?: string
  /** When the route's task first read done with no result file (alerted once). */
  readonly doneWithoutResultAt?: number
  readonly fallback?: SavedDefaultRequest
}

/**
 * `jobs.provider_task_id` prefix of a job whose recovery is sending the default
 * request. The resend's claim writes a fresh, never-repeated value under it, so
 * every compare-and-set keyed on the task id the row held before misses from
 * then on (a worker's fallback, its reference save, a second resend). Never a
 * reference.
 */
export const ALTERNATE_ROUTE_RESENDING_PREFIX = `${ALTERNATE_ROUTE_REF_PREFIX}resending:`

/** True for a saved task id that marks a resend in progress. */
export function isAlternateRouteResending(saved: unknown): boolean {
  return typeof saved === "string" && saved.startsWith(ALTERNATE_ROUTE_RESENDING_PREFIX)
}

/** The task reference saved for `taskRef`. */
export function alternateRouteReference(taskRef: string): string {
  return `${ALTERNATE_ROUTE_REF_PREFIX}${taskRef}`
}

/** The plugin's task reference inside a saved `provider_task_id`, or undefined for the claim, another kind's id, or nothing. */
export function alternateRouteTaskRefOf(saved: unknown): string | undefined {
  if (typeof saved !== "string" || !saved.startsWith(ALTERNATE_ROUTE_REF_PREFIX) || saved === ALTERNATE_ROUTE_CLAIM_REF || isAlternateRouteResending(saved)) return undefined
  const ref = saved.slice(ALTERNATE_ROUTE_REF_PREFIX.length)
  return ref.length > 0 ? ref : undefined
}

function savedDefaultRequestOf(v: unknown): SavedDefaultRequest | undefined {
  if (typeof v !== "object" || v === null) return undefined
  const { taskModel, modelKey, body } = v as Record<string, unknown>
  if (typeof taskModel !== "string" || typeof modelKey !== "string" || typeof body !== "object" || body === null || Array.isArray(body)) return undefined
  return { taskModel, modelKey, body: body as Record<string, unknown> }
}

const STATES: ReadonlySet<string> = new Set<AlternateRouteState>(["claimed", "running", "resubmitting", "fell-back"])

/** The route's record on a job's `input_data`, or undefined when there is none (or it is not one). */
export function alternateRouteRecordOf(inputData: unknown): AlternateRouteRecord | undefined {
  const raw = (inputData as Record<string, unknown> | null | undefined)?.[ALTERNATE_ROUTE_KEY]
  if (typeof raw !== "object" || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.state !== "string" || !STATES.has(r.state)) return undefined
  const fallback = savedDefaultRequestOf(r.fallback)
  return {
    state: r.state as AlternateRouteState,
    at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
    ...(typeof r.routeId === "string" && r.routeId ? { routeId: r.routeId } : {}),
    ...(typeof r.taskRef === "string" && r.taskRef ? { taskRef: r.taskRef } : {}),
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
    ...(typeof r.message === "string" ? { message: r.message } : {}),
    ...(typeof r.doneWithoutResultAt === "number" && Number.isFinite(r.doneWithoutResultAt) ? { doneWithoutResultAt: r.doneWithoutResultAt } : {}),
    ...(fallback ? { fallback } : {}),
  }
}

/** `inputData` with `record` as its route record: a new object, the original untouched. */
export function withAlternateRouteRecord(
  inputData: Readonly<Record<string, unknown>> | null | undefined,
  record: AlternateRouteRecord,
): Record<string, unknown> {
  return { ...(inputData ?? {}), [ALTERNATE_ROUTE_KEY]: record }
}

type Draft = {
  -readonly [K in keyof PluginAlternateRouteRequest]?: PluginAlternateRouteRequest[K]
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((u) => typeof u === "string" && u.length > 0) ? [...v] : undefined

/**
 * Every key of the default route's prepared video body, mapped onto the
 * neutral request or deliberately dropped. A mapper answers false for a value
 * it cannot carry, and an UNLISTED key makes the whole run "not offered": the
 * table fails closed, so a lever added to the body later never silently goes
 * missing on the alternate route.
 */
const BODY_KEYS: Readonly<Record<string, (value: unknown, out: Draft) => boolean>> = {
  prompt: (v, out) => { const s = typeof v === "string" ? v : undefined; if (s === undefined) return false; out.prompt = s; return true },
  aspect_ratio: (v, out) => { const s = str(v); if (!s) return false; out.aspectRatio = s; return true },
  duration: (v, out) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
    if (!Number.isFinite(n)) return false
    out.durationSec = n
    return true
  },
  resolution: (v, out) => { const s = str(v); if (!s) return false; out.resolution = s; return true },
  generate_audio: (v, out) => { if (typeof v !== "boolean") return false; out.generateAudio = v; return true },
  draft: (v, out) => { if (typeof v !== "boolean") return false; out.draft = v; return true },
  output_format: (v, out) => { if (v !== "mov") return false; out.outputFormat = "mov"; return true },
  omni_reference_task_type: (v, out) => { const s = str(v); if (!s) return false; out.referenceTaskType = s; return true },
  first_frame_url: (v, out) => { const s = str(v); if (!s) return false; out.firstFrameUrl = s; return true },
  last_frame_url: (v, out) => { const s = str(v); if (!s) return false; out.lastFrameUrl = s; return true },
  reference_image_urls: (v, out) => { const l = strList(v); if (!l) return false; out.referenceImageUrls = l; return true },
  reference_video_urls: (v, out) => { const l = strList(v); if (!l) return false; out.referenceVideoUrls = l; return true },
  reference_audio_urls: (v, out) => { const l = strList(v); if (!l) return false; out.referenceAudioUrls = l; return true },
  // Dropped deliberately, but only at their off value: an "on" lever the
  // alternate route cannot honour makes the run not offered.
  web_search: (v) => v === false,
  nsfw_checker: (v) => v === false,
}

/** The body keys the table knows — exported for its guard test. */
export const ALTERNATE_ROUTE_BODY_KEYS: readonly string[] = Object.keys(BODY_KEYS)

/**
 * The neutral request for a prepared default-route body, or null when the run
 * cannot be offered (an unlisted key, a value a mapper cannot carry, no prompt).
 * Pure: the body is read, never changed.
 */
export function alternateRouteRequestOf(
  body: Readonly<Record<string, unknown>>,
  job: Pick<PluginAlternateRouteRequest, "jobId" | "jobType" | "model" | "parent">,
): PluginAlternateRouteRequest | null {
  const out: Draft = {}
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue
    const map = Object.hasOwn(BODY_KEYS, key) ? BODY_KEYS[key] : undefined
    if (!map || !map(value, out)) return null
  }
  if (out.prompt === undefined) return null
  return {
    jobId: job.jobId,
    jobType: job.jobType,
    model: job.model,
    parent: job.parent,
    prompt: out.prompt,
    draft: out.draft === true,
    referenceImageUrls: out.referenceImageUrls ?? [],
    referenceVideoUrls: out.referenceVideoUrls ?? [],
    referenceAudioUrls: out.referenceAudioUrls ?? [],
    ...(out.referenceTaskType !== undefined ? { referenceTaskType: out.referenceTaskType } : {}),
    ...(out.resolution !== undefined ? { resolution: out.resolution } : {}),
    ...(out.outputFormat !== undefined ? { outputFormat: out.outputFormat } : {}),
    ...(out.aspectRatio !== undefined ? { aspectRatio: out.aspectRatio } : {}),
    ...(out.durationSec !== undefined ? { durationSec: out.durationSec } : {}),
    ...(out.generateAudio !== undefined ? { generateAudio: out.generateAudio } : {}),
    ...(out.firstFrameUrl !== undefined ? { firstFrameUrl: out.firstFrameUrl } : {}),
    ...(out.lastFrameUrl !== undefined ? { lastFrameUrl: out.lastFrameUrl } : {}),
  }
}
