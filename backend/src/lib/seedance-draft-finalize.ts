import {
  SEEDANCE_DRAFT_FINALIZE_PROVIDER,
  isSeedanceDraftCapable,
  isAutoVideoDuration,
  seedanceDraftFinalizeBillableSec,
  seedanceDraftFinalizeCreditId,
} from "@nodaro/shared/model-catalog"
import { supabase } from "./supabase.js"
import { hasCredits } from "./config.js"
import { probeRefVideoDurations } from "./ref-video-probe.js"
import { draftAudioMuxForSource, type DraftAudioMux } from "./seedance-draft-audio.js"
import { assertSafeProbeSource, getVideoStreamDuration } from "../providers/video/ffmpeg-utils.js"

/**
 * Seedance 2.5 Draft → 1080p finalize: which draft a request points at, whether
 * it may be finalized, and what the finalize costs.
 *
 * ONE rule for both places a finalize starts — the `/v1/video-upscale` route
 * (a preHandler, before the credit guard) and the workflow run (node-executor,
 * before input_data is written) — so the same draft costs the same and is
 * refused the same wherever it runs.
 *
 * Every check is FAIL-CLOSED and runs before anything is reserved:
 *  - the draft belongs to the caller (unlike `kieTaskOwnedByAnother`, which is
 *    deliberately fail-open for untracked ids — an untracked id here is refused);
 *  - it was made by a draft-capable model with the draft flag on;
 *  - it completed;
 *  - it was rendered on THIS install (a draft relayed through a connected
 *    nodaro.ai account lives there) and its provider task id was recorded.
 *
 * The price comes from the SOURCE job, never the request: the finalize renders
 * the draft's own length, so the reservation is exact — output seconds from the
 * draft's delivered clip, and for a draft made with a reference video, the
 * draft's own probe of those clips.
 */

export interface SeedanceDraftFinalizePlan {
  readonly ok: true
  readonly sourceJobId: string
  /** The draft's provider task — what the finalize task names. */
  readonly draftTaskId: string
  /** Whole seconds the finalize bills for its output (= the draft's length). */
  readonly outputSec: number
  readonly hasRefVideo: boolean
  /** The draft's reservation probe of its reference clips (only when hasRefVideo). */
  readonly refVideoDurationsSec: readonly unknown[]
  /** The id the finalize reserves under (`seedance-2-5-hd:{N}s[-ref]`). */
  readonly creditId: string
  /** The audio mux the draft got after rendering, re-applied to the 1080p
   *  render (`seedance-draft-audio.ts`); undefined = none. */
  readonly audioMux?: DraftAudioMux
  /** The stored draft clip (the audio-copy fallback's source). */
  readonly draftVideoUrl?: string
}

export interface SeedanceDraftFinalizeRefusal {
  readonly ok: false
  readonly status: 400 | 403 | 404 | 409 | 422
  readonly code: string
  readonly message: string
}

export type SeedanceDraftFinalizeResolution = SeedanceDraftFinalizePlan | SeedanceDraftFinalizeRefusal

interface DraftJobRow {
  id: string
  user_id: string | null
  status: string | null
  provider_task_id: string | null
  provider_kind: string | null
  relay_job_id?: string | null
  parent_job_id?: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const refuse = (
  status: SeedanceDraftFinalizeRefusal["status"],
  code: string,
  message: string,
): SeedanceDraftFinalizeRefusal => ({ ok: false, status, code, message })

const isDraftRow = (row: DraftJobRow): boolean =>
  row.input_data?.draft === true && isSeedanceDraftCapable(row.input_data?.provider as string | undefined)

/**
 * Resolve and validate the draft a finalize request names — by its provider
 * task id (`taskId`, what a workflow edge carries, like the VEO upscalers) or
 * by its job id (`sourceJobId`).
 */
export async function resolveSeedanceDraftFinalize(args: {
  userId: string
  taskId?: string
  sourceJobId?: string
  /**
   * Whether the draft may be a CHILD job (`parent_job_id` set). Only a
   * worker-side handler's own request may (`mayUseChildJobAsSource`); for
   * every other caller a child reads exactly as a draft that does not exist.
   */
  allowChildSource?: boolean
}): Promise<SeedanceDraftFinalizeResolution> {
  const { userId, taskId, sourceJobId, allowChildSource = false } = args
  if (!taskId && !sourceJobId) {
    return refuse(400, "draft_source_required", "Seedance 2.5 HD finalizes a Seedance 2.5 draft — pass the draft's taskId or sourceJobId.")
  }
  if (sourceJobId && !UUID_RE.test(sourceJobId)) {
    return refuse(404, "draft_not_found", "No Seedance draft was found for that id.")
  }

  const query = supabase
    .from("jobs")
    .select("id, user_id, status, provider_task_id, provider_kind, relay_job_id, parent_job_id, input_data, output_data")
  // A task id can be carried by more than one row (a VEO upscale child stores
  // its parent's id), so read a handful and pick, never `.limit(1)` blindly.
  const { data, error } = sourceJobId
    ? await query.eq("id", sourceJobId).limit(1)
    : await query.eq("provider_task_id", taskId as string).limit(10)
  if (error) throw new Error(`draft lookup failed: ${error.message}`)
  // A child job is no draft of the caller's unless the caller may name one.
  const rows = ((data ?? []) as DraftJobRow[]).filter((r) => allowChildSource || r.parent_job_id == null)

  const own = rows.filter((r) => r.user_id === userId)
  if (own.length === 0) {
    return rows.length > 0
      ? refuse(403, "forbidden", "You do not own the referenced draft.")
      : refuse(404, "draft_not_found", "No Seedance draft was found for that id.")
  }

  const drafts = own.filter(isDraftRow)
  if (drafts.length === 0) {
    const fromDraftModel = own.some((r) => isSeedanceDraftCapable(r.input_data?.provider as string | undefined))
    return fromDraftModel
      ? refuse(422, "not_a_draft", "That Seedance 2.5 video was not made as a draft. Turn on Draft on the Seedance 2.5 node, then finalize the draft you like.")
      : refuse(422, "not_a_seedance_draft", "Seedance 2.5 HD only works on a Seedance 2.5 draft. Use Topaz to upscale any other video.")
  }

  const completed = drafts.find((r) => r.status === "completed")
  if (!completed) {
    return refuse(409, "draft_not_ready", "That draft has not finished successfully, so there is nothing to finalize yet.")
  }

  // A draft relayed to a connected nodaro.ai account was rendered (and lives)
  // there; this install holds no provider task of its own for it.
  if (completed.relay_job_id || completed.provider_kind === "nodaro-cloud") {
    return refuse(
      409,
      "draft_not_finalizable",
      "This draft was rendered through a connected nodaro.ai account, so it can't be finalized on this install.",
    )
  }
  if (!completed.provider_task_id) {
    return refuse(
      409,
      "draft_not_finalizable",
      "This draft has no provider task recorded, so it can't be finalized. Make a new draft.",
    )
  }

  const outputSec = await draftOutputSeconds(completed)
  if (outputSec === undefined) {
    return refuse(422, "invalid_media_duration", "Couldn't read the draft's length, so the finalize can't be priced. Nothing was charged.")
  }

  const input = completed.input_data ?? {}
  const refUrls = Array.isArray(input.referenceVideoUrls) ? (input.referenceVideoUrls as unknown[]) : []
  const hasRefVideo = refUrls.length > 0
  const refVideoDurationsSec = !hasRefVideo
    ? []
    : Array.isArray(input.refVideoDurationsSec)
      ? (input.refVideoDurationsSec as unknown[])
      : await probeRefVideoDurations({ provider: input.provider as string, referenceVideoUrls: refUrls })

  return {
    ok: true,
    sourceJobId: completed.id,
    draftTaskId: completed.provider_task_id,
    outputSec,
    hasRefVideo,
    refVideoDurationsSec,
    creditId: seedanceDraftFinalizeCreditId(outputSec, hasRefVideo),
    ...withAudioMux(input, completed.output_data ?? {}),
  }
}

function withAudioMux(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): { audioMux?: DraftAudioMux; draftVideoUrl?: string } {
  const audioMux = draftAudioMuxForSource(input, output)
  if (!audioMux) return {}
  const stored = typeof output.videoUrl === "string" && output.videoUrl ? output.videoUrl : undefined
  return { audioMux, ...(stored ? { draftVideoUrl: stored } : {}) }
}

/** Video-stream length of a clip URL (never the container: an audio track a
 *  mux made longer must not lengthen the take). SSRF-guarded like every probe. */
export async function videoStreamSeconds(url: string): Promise<number> {
  await assertSafeProbeSource(url)
  return getVideoStreamDuration(url)
}

/**
 * The RAW length of a draft's take — what the provider rendered, before any
 * post-process (an audio mux, a voice mux, a smart-loop-cut) — recorded on the
 * draft job as `output_data.draftRenderSec` when it completes. The finalize
 * re-renders exactly that take, so this is what it bills. Undefined for a run
 * that is not a draft, and when the clip cannot be measured (the gate then
 * falls back to the stored clip).
 */
export async function measureSeedanceDraftRenderSec(args: {
  draft: unknown
  provider: string | undefined
  outputUrl: string
}): Promise<number | undefined> {
  if (args.draft !== true || !isSeedanceDraftCapable(args.provider)) return undefined
  try {
    const seconds = await videoStreamSeconds(args.outputUrl)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
  } catch (err) {
    console.warn("[seedance-draft-finalize] could not measure the raw draft take; the finalize will read the stored clip:", err)
    return undefined
  }
}

/** The `extraOutputData` entry a completing draft records (empty when unmeasured). */
export function draftRenderOutputData(draftRenderSec: number | undefined): { draftRenderSec?: number } {
  return draftRenderSec !== undefined ? { draftRenderSec } : {}
}

/**
 * The draft's take length in billable whole seconds.
 *
 * Preferred: the raw take recorded at completion (`draftRenderSec`) — exact,
 * whatever post-process the stored clip went through. Fallback for a draft
 * without it: the stored clip's VIDEO stream (an audio mux lengthens the
 * container, not the picture), and never less than a fixed requested
 * duration (a smart-loop-cut shortens the stored clip, not the take).
 */
async function draftOutputSeconds(row: DraftJobRow): Promise<number | undefined> {
  const recorded = row.output_data?.draftRenderSec
  if (typeof recorded === "number" && Number.isFinite(recorded) && recorded > 0) {
    return seedanceDraftFinalizeBillableSec(recorded)
  }
  const url = row.output_data?.videoUrl
  if (typeof url !== "string" || !url) return undefined
  let measured: number
  try {
    measured = await videoStreamSeconds(url)
  } catch (err) {
    console.warn(`[seedance-draft-finalize] could not measure draft ${row.id}:`, err)
    return undefined
  }
  if (!Number.isFinite(measured) || measured <= 0) return undefined
  const input = row.input_data ?? {}
  const requested = typeof input.duration === "number" && !isAutoVideoDuration(input.duration) ? input.duration : 0
  return seedanceDraftFinalizeBillableSec(Math.max(measured, requested))
}

/**
 * BASE credits overriding the seeded row for a finalize whose draft had a
 * reference video (input + output seconds); undefined otherwise — the
 * `seedance-2-5-hd:{N}s` row then prices it as is. Core shim over the ee
 * helper (dynamic import), so community/business never load billing code.
 */
export async function seedanceDraftFinalizeBaseCredits(
  plan: Pick<SeedanceDraftFinalizePlan, "hasRefVideo" | "outputSec" | "refVideoDurationsSec">,
): Promise<number | undefined> {
  if (!hasCredits() || !plan.hasRefVideo) return undefined
  const { seedanceDraftFinalizeRefBaseCredits } = await import("../ee/billing/seedance2-ref-video-credits.js")
  return seedanceDraftFinalizeRefBaseCredits({ outputSec: plan.outputSec, refVideoDurationsSec: plan.refVideoDurationsSec })
}

// ── Workflow run (node-executor) ─────────────────────────────────────────────

/** True when a video-upscale payload is a Seedance draft finalize. */
export function isSeedanceDraftFinalizePayload(jobName: string, payload: Record<string, unknown>): boolean {
  return jobName === "video-upscale" && payload.provider === SEEDANCE_DRAFT_FINALIZE_PROVIDER
}

/** What {@link seedanceDraftFinalizeStamp} returns: the fields to merge into the payload, or the route's refusal. */
export type SeedanceDraftFinalizeStamp =
  | { readonly ok: true; readonly patch: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly refusal: { readonly code: string; readonly message: string } }

/**
 * The workflow run's twin of the route's preHandler: resolves the draft a
 * finalize payload names and returns what the run must send and reserve, as a
 * PATCH for the caller to merge into its payload (never mutated here) —
 * `sourceJobId`, `kieTaskId` (the draft's task), `reservedCreditId`, the
 * reference-video input + output seconds, and the audio mux to re-apply. The
 * caller must merge it BEFORE writing input_data. Returns the route's refusal;
 * an empty patch for every other job.
 */
export async function seedanceDraftFinalizeStamp(
  jobName: string,
  payload: Readonly<Record<string, unknown>>,
  userId: string,
): Promise<SeedanceDraftFinalizeStamp> {
  if (!isSeedanceDraftFinalizePayload(jobName, payload)) return { ok: true, patch: {} }
  const resolved = await resolveSeedanceDraftFinalize({
    userId,
    taskId: typeof payload.kieTaskId === "string" ? payload.kieTaskId : undefined,
    sourceJobId: typeof payload.sourceJobId === "string" ? payload.sourceJobId : undefined,
  })
  if (!resolved.ok) return { ok: false, refusal: { code: resolved.code, message: resolved.message } }
  return {
    ok: true,
    patch: {
      sourceJobId: resolved.sourceJobId,
      kieTaskId: resolved.draftTaskId,
      reservedCreditId: resolved.creditId,
      draftOutputSec: resolved.outputSec,
      draftHasRefVideo: resolved.hasRefVideo,
      draftRefVideoDurationsSec: resolved.refVideoDurationsSec,
      ...(resolved.audioMux ? { draftAudioMux: resolved.audioMux } : {}),
      ...(resolved.draftVideoUrl ? { draftVideoUrl: resolved.draftVideoUrl } : {}),
    },
  }
}

/** The id a stamped finalize payload reserves; undefined for any other job. */
export function seedanceDraftFinalizeReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return isSeedanceDraftFinalizePayload(jobName, payload) && typeof payload.reservedCreditId === "string"
    ? payload.reservedCreditId
    : undefined
}

/** BASE credits a stamped reference-video finalize reserves (before markup); undefined otherwise. */
export async function seedanceDraftFinalizeStampedBaseCredits(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (!isSeedanceDraftFinalizePayload(jobName, payload) || payload.draftHasRefVideo !== true) return undefined
  return seedanceDraftFinalizeBaseCredits({
    hasRefVideo: true,
    outputSec: Number(payload.draftOutputSec),
    refVideoDurationsSec: Array.isArray(payload.draftRefVideoDurationsSec) ? payload.draftRefVideoDurationsSec : [],
  })
}
