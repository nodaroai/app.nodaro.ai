/**
 * Grok Extend's source (`grok-extend`): which clips Grok can extend, and what
 * the run needs to know about one.
 *
 * Grok extends only its OWN clips — a completed Grok Imagine text-to-video
 * (`grok`) or image-to-video (`grok-i2v`) run, named by its provider task id,
 * made on this install by the caller. KIE accepts nothing else (no clip URL,
 * no other model's task, not Grok Imagine Video 1.5's) and would refuse it
 * only after the run was reserved. So every other source is refused HERE,
 * before anything is reserved, with one code and one message
 * ({@link GROK_EXTEND_SOURCE_MESSAGE}). Fail-closed: a task id no row of the
 * caller's answers is refused — unlike `kieTaskOwnedByAnother`, which lets an
 * untracked id through on purpose.
 *
 * The check only reads: the job rows that carry the task id, then (an
 * accepted source only) a probe of its stored clip.
 */
import { supabase } from "./supabase.js"
import { TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { KIE_TEXT_TO_VIDEO_MODELS, KIE_VIDEO_MODELS, type KieModelConfig } from "../providers/kie/models.js"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"

/** The refusal's code, on every source Grok cannot extend. */
export const GROK_EXTEND_SOURCE_CODE = "grok_extend_source"

/**
 * The refusal's message, on every source Grok cannot extend — user-facing
 * copy, shown as written wherever the refusal surfaces.
 */
export const GROK_EXTEND_SOURCE_MESSAGE =
  "Grok can only extend a finished Grok Imagine video (made from text or an image, at 480p or 720p) that you created here. It can't extend uploaded videos, videos from other models (including Grok Imagine Video 1.5), or other people's videos. To extend any other video, choose another Extend provider."

/** The resolutions a Grok source can be extended at: the ones Grok Extend is priced at. */
export type GrokExtendSourceResolution = "480p" | "720p"
const EXTENDABLE_RESOLUTIONS: readonly GrokExtendSourceResolution[] = ["480p", "720p"]

/** The providers whose clips Grok can extend, each with the KIE config its request was built from. */
const SOURCE_CONFIGS = {
  grok: () => KIE_TEXT_TO_VIDEO_MODELS.grok,
  "grok-i2v": () => KIE_VIDEO_MODELS["grok-i2v"],
} as const satisfies Record<string, () => KieModelConfig | undefined>
type GrokSourceProvider = keyof typeof SOURCE_CONFIGS
export const GROK_EXTEND_SOURCE_PROVIDERS = Object.keys(SOURCE_CONFIGS) as readonly GrokSourceProvider[]

/**
 * The resolution Grok Imagine renders a request that names none at: its
 * schema's default (docs.kie.ai/market/grok-imagine/text-to-video and
 * image-to-video, `resolution` default `480p`, read 2026-11-13). A request
 * whose KIE config pins one (text-to-video's 720p) sends that instead.
 */
const GROK_SCHEMA_DEFAULT_RESOLUTION = "480p"

export type GrokExtendSource =
  | {
      ok: true
      /** The source's picture length, in seconds: where the extension starts. */
      sourceSec: number
      /** The resolution it was rendered at: what Grok bills the extension at. */
      resolution: GrokExtendSourceResolution
      /** The task id the source's row carries — the one the run must send (trimmed, as matched). */
      taskId: string
    }
  | { ok: false; code: typeof GROK_EXTEND_SOURCE_CODE; message: string }

interface SourceJobRow {
  id: string
  user_id: string | null
  status: string | null
  provider_kind: string | null
  relay_job_id: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
}

const REFUSAL: GrokExtendSource = { ok: false, code: GROK_EXTEND_SOURCE_CODE, message: GROK_EXTEND_SOURCE_MESSAGE }

/** A task id can be carried by more than one of the caller's finished rows (a child that keeps its parent's): read a handful and pick. */
const ROWS_PER_TASK = 10

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

function isSourceProvider(p: unknown): p is GrokSourceProvider {
  return typeof p === "string" && Object.hasOwn(SOURCE_CONFIGS, p)
}

/** The provider a job ran: the route and the workflow run both record the mode's own id (`grok` / `grok-i2v`). */
const providerOf = (row: SourceJobRow): unknown => str(row.input_data?.provider) ?? str(row.input_data?.resolvedModel)

/**
 * The task lives on this install's KIE account: not relayed through a
 * connected account (`nodaro-cloud`), nor run by another vendor. A KIE kind,
 * or none, or the pickup's `pre-task` stamp — which the task's own stamp
 * replaces best-effort, so a failed write leaves it on a finished KIE run.
 */
function ranOnKieHere(row: SourceJobRow): boolean {
  if (str(row.relay_job_id)) return false
  const kind = str(row.provider_kind)
  return kind === undefined || kind === "pre-task" || kind.startsWith("kie-")
}

/**
 * The resolution the source was rendered at — what Grok bills its extension
 * at. The run recorded the value its request sent (`input_data.resolution`,
 * the route's and the workflow run's normalized one); a run that recorded
 * none sent its KIE config's pinned value, or none at all (Grok's own
 * default). Undefined for a resolution Grok Extend is not priced at.
 */
function sourceResolution(provider: GrokSourceProvider, input: Record<string, unknown>): GrokExtendSourceResolution | undefined {
  const pinned = SOURCE_CONFIGS[provider]()?.extraParams?.resolution
  const rendered = (str(input.resolution) ?? str(pinned) ?? GROK_SCHEMA_DEFAULT_RESOLUTION).toLowerCase()
  return EXTENDABLE_RESOLUTIONS.find((r) => r === rendered)
}

/** Grok Imagine's shorter render (it renders 6 or 10 s): the last fallback of {@link requestedSeconds}. */
const GROK_SHORTER_RENDER_SEC = 6

/**
 * The length the run asked for — what Grok renders — else the length its KIE
 * config sends when none is asked: the fallback when the clip cannot be measured.
 */
function requestedSeconds(provider: GrokSourceProvider, input: Record<string, unknown>): number {
  const config = SOURCE_CONFIGS[provider]()
  for (const v of [input.duration, config?.extraParams?.duration, config?.allowedDurations?.[0]]) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN
    if (Number.isFinite(n) && n > 0) return n
  }
  return GROK_SHORTER_RENDER_SEC
}

/**
 * The source clip's picture length: the video stream's own (the sound can
 * run past the last frame), the container's when the stream reports none.
 * A clip that cannot be measured answers the length its run asked for.
 */
async function sourcePictureSec(
  videoUrl: string,
  provider: GrokSourceProvider,
  input: Record<string, unknown>,
  jobId: string,
  probeTimeoutMs: number | undefined,
): Promise<number> {
  try {
    const probe = await probeVideoSource(videoUrl, probeTimeoutMs !== undefined ? { signal: AbortSignal.timeout(probeTimeoutMs) } : {})
    const seconds = probe.videoDurationSeconds ?? probe.durationSeconds
    if (Number.isFinite(seconds) && seconds > 0) return seconds
  } catch (err) {
    console.warn(`[grok-extend-source] could not measure source job ${jobId}; using the length its run asked for:`, err)
  }
  return requestedSeconds(provider, input)
}

/**
 * Resolve the Grok clip a Grok Extend request names by its provider task id
 * (`taskId`, what the upstream node's output carries as `providerTaskId`):
 * the caller's completed Grok Imagine text-to-video or image-to-video job,
 * with a video, rendered on this install at a resolution Grok Extend is
 * priced at. Answers its picture length (`sourceSec`, where the extension
 * starts), that resolution and the task id it matched (trimmed: the one the
 * run sends); every other source is the one refusal.
 *
 * `probeTimeoutMs`: how long the clip's measurement may take — a request
 * waiting on it sets a tight one. A probe that runs out falls back like any
 * failed probe (the length the source's run asked for).
 */
export async function resolveGrokExtendSource(args: { taskId: string; userId: string; probeTimeoutMs?: number }): Promise<GrokExtendSource> {
  const taskId = str(args.taskId)
  const userId = str(args.userId)
  // An upload (or any URL) carries no provider task: nothing to look up.
  if (!taskId || !userId) return REFUSAL

  // The owner and the status are asked of the database, before the read's
  // limit: rows of other users (or the caller's own failed retries) carrying
  // the same task id can never crowd the caller's finished clip out of it.
  // A clip in the Trash is no source, like any other the caller can't see.
  const { data, error } = await supabase
    .from("jobs")
    .select("id, user_id, status, provider_kind, relay_job_id, input_data, output_data")
    .eq("provider_task_id", taskId)
    .eq("user_id", userId)
    .eq("status", "completed")
    .is(TRASHED_JOB_COLUMN, null)
    .limit(ROWS_PER_TASK)
  if (error) throw new Error(`Grok extend source lookup failed: ${error.message}`)

  for (const row of (data ?? []) as SourceJobRow[]) {
    // Held here too: the answer must never rest on a filter alone.
    if (row.user_id !== userId || row.status !== "completed" || !ranOnKieHere(row)) continue
    const provider = providerOf(row)
    // `grok` is also Grok Imagine's IMAGE id: only a run that made a video counts.
    const videoUrl = str(row.output_data?.videoUrl)
    if (!isSourceProvider(provider) || !videoUrl) continue
    const input = row.input_data ?? {}
    const resolution = sourceResolution(provider, input)
    if (!resolution) continue
    return { ok: true, sourceSec: await sourcePictureSec(videoUrl, provider, input, row.id, args.probeTimeoutMs), resolution, taskId }
  }
  return REFUSAL
}
