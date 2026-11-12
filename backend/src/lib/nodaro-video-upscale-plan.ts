/**
 * The plan of a Nodaro Video Upscale run — its tier, the clip as the run sends
 * it, its measured length and size, and the seconds it is billed — made once,
 * before anything is reserved (decided 2026-11-11).
 *
 * One function for every lane that charges such a run: `/v1/video-upscale`'s
 * preHandler (and `POST /v1/quote`, which runs the same pricing chain) and the
 * workflow run's stamp (`node-executor.ts`). Both stamp the plan onto the job
 * — the stored clip's URL included — so the worker upscales exactly what was
 * measured and priced.
 *
 * The clip goes through the outside-input copy first
 * (lib/outside-input-copy.ts): a clip already on our storage is used as it
 * is, sized from storage's own record; an outside clip is copied to our
 * storage under the 50 MB cap and measured from the local copy before
 * anything is stored. That copy is what is measured, billed and sent. A quote
 * runs the same checks and stores nothing.
 *
 * Pricing (`@nodaro/render-rules` nodaro-video-upscale-pricing.ts): the tier's
 * four-second row × billed seconds ÷ 4, rounded up once. A flat per-second
 * price, so the hold IS the charge.
 *
 * Limits: a clip longer than 60 s or larger than 50 MB is refused, and so is
 * one that cannot be read — before any credits are held.
 */
import {
  NODARO_VIDEO_UPSCALE_MAX_BYTES,
  NODARO_VIDEO_UPSCALE_PROVIDER,
  NODARO_VIDEO_UPSCALE_MAX_SEC,
  isNodaroVideoUpscaleTier,
  type NodaroVideoUpscaleTier,
} from "@nodaro/shared/models"
import {
  nodaroVideoUpscaleBilledSec,
  nodaroVideoUpscaleCreditId,
  nodaroVideoUpscaleTierOf,
  nodaroVideoUpscaleUnits,
} from "@nodaro/render-rules"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { houseModelServed } from "./house-models-served.js"
import {
  copyOutsideInput,
  inspectOutsideInput,
  isOutsideInputRefusal,
  OutsideInputBusyError,
  OutsideInputFailedError,
  OutsideInputInspectRefusedError,
  OutsideInputTimedOutError,
  OutsideInputTooLargeError,
} from "./outside-input-copy.js"
import { LinkImportsDisabledError } from "./link-imports.js"
import { UploadBlockedError } from "./upload-policy.js"

export interface NodaroVideoUpscalePlan {
  readonly tier: NodaroVideoUpscaleTier
  /** The tier's rate row (the price of four seconds) the run is charged a multiple of. */
  readonly creditId: string
  /**
   * The clip the run sends: a file of our own storage (an outside clip's copy,
   * or a stored clip's canonical address). A quote's plan keeps the URL it was
   * given: it stores nothing and runs nothing.
   */
  readonly videoUrl: string
  /** The clip's length in seconds, unrounded: its picture stream's, else the container's. */
  readonly sourceDurationSec: number
  /** The whole seconds the run is billed (`nodaroVideoUpscaleBilledSec`). */
  readonly billedSec: number
  /** Its exact size: the bytes copied, or storage's record of a stored clip. */
  readonly sourceSizeBytes: number
}

/** A source that cannot be read (or is not a video): refused before anything is reserved. */
export class NodaroVideoUpscaleSourceUnreadableError extends Error {
  readonly code = "video_unreadable"
  constructor() {
    super(
      "Couldn't read the video's length and size to upscale it. Check that the link opens a video file, then try again, " +
      "or choose Topaz to upscale this clip.",
    )
    this.name = "NodaroVideoUpscaleSourceUnreadableError"
  }
}

/** A measure as the refusal states it: rounded UP to two decimals, so a clip a hair over a limit never reads as the limit. */
const upTo2 = (n: number): string => String(Math.ceil(n * 100 - 1e-9) / 100)

/** A source longer than {@link NODARO_VIDEO_UPSCALE_MAX_SEC}: refused before anything is reserved. */
export class NodaroVideoUpscaleTooLongError extends Error {
  readonly code = "video_too_long"
  constructor(readonly durationSec: number) {
    super(
      `This clip is ${upTo2(durationSec)} seconds long. Nodaro Video Upscale takes clips of up to ${NODARO_VIDEO_UPSCALE_MAX_SEC} seconds. ` +
      "Trim the clip, or choose Topaz for longer clips.",
    )
    this.name = "NodaroVideoUpscaleTooLongError"
  }
}

/** A source larger than {@link NODARO_VIDEO_UPSCALE_MAX_BYTES}: refused before anything is reserved (or copied). */
export class NodaroVideoUpscaleTooLargeError extends Error {
  readonly code = "video_too_large"
  constructor() {
    super(
      `This clip is larger than ${NODARO_VIDEO_UPSCALE_MAX_BYTES / 1_000_000} MB, the most Nodaro Video Upscale takes. ` +
      "Trim or compress the clip, or choose Topaz for larger files.",
    )
    this.name = "NodaroVideoUpscaleTooLargeError"
  }
}

/**
 * The clip could not be fetched just now (too many fetches at once, a slow or
 * failed step on our side): nothing was held, and the same request may pass
 * in a moment. Its `code` is the copy's own (`input_busy`, `input_timed_out`,
 * `input_failed`).
 */
export class NodaroVideoUpscaleTryAgainError extends Error {
  constructor(readonly code: "input_busy" | "input_timed_out" | "input_failed") {
    super("Couldn't fetch the clip just now. Try again in a moment.")
    this.name = "NodaroVideoUpscaleTryAgainError"
  }
}

export type NodaroVideoUpscaleRefusalError =
  | NodaroVideoUpscaleSourceUnreadableError
  | NodaroVideoUpscaleTooLongError
  | NodaroVideoUpscaleTooLargeError
  | NodaroVideoUpscaleTryAgainError

export function isNodaroVideoUpscaleRefusal(err: unknown): err is NodaroVideoUpscaleRefusalError {
  return err instanceof NodaroVideoUpscaleSourceUnreadableError
    || err instanceof NodaroVideoUpscaleTooLongError
    || err instanceof NodaroVideoUpscaleTooLargeError
    || err instanceof NodaroVideoUpscaleTryAgainError
}

/** Who and what a plan is made for. */
export interface NodaroVideoUpscalePlanContext {
  /** The person the clip is fetched for (the copy's per-user limits, the upload policy). */
  readonly userId: string
  /** The job whose scratch folder holds the copy (a workflow run's); none on a route (the copy sits under the flat scratch key). */
  readonly jobId?: string
  /** A quote: the same checks, nothing stored. */
  readonly quote?: boolean
  /** Stops the clip's fetch, copy and probe (a route's client gone); its reason is thrown as is. */
  readonly signal?: AbortSignal
}

type Source = Awaited<ReturnType<typeof probeVideoSource>>

/** The clip's length held to the limit: judged on the LONGER of the container's and the picture's (a soundtrack can run past the last frame, and either is over the limit this model takes). */
function withinLength(source: Source): Source {
  const longest = Math.max(source.durationSeconds, source.videoDurationSeconds ?? 0)
  if (longest > NODARO_VIDEO_UPSCALE_MAX_SEC) throw new NodaroVideoUpscaleTooLongError(longest)
  return source
}

/** A failure of the box (an ffprobe the platform killed or timed out), not of the clip. */
function isBoxFailure(err: unknown): boolean {
  const flags = err as { killed?: unknown; timedOut?: unknown } | null
  return flags !== null && typeof flags === "object" && (flags.killed === true || flags.timedOut === true)
}

/** The copy's refusal as this model's own sentence; anything else (a cancellation, the link switch, the upload policy) is thrown as it is. */
function asPlanRefusal(err: unknown): unknown {
  if (err instanceof OutsideInputTooLargeError) return new NodaroVideoUpscaleTooLargeError()
  if (err instanceof OutsideInputInspectRefusedError) {
    if (err.reason instanceof NodaroVideoUpscaleTooLongError) return err.reason
    if (isBoxFailure(err.reason)) return new NodaroVideoUpscaleTryAgainError("input_failed")
    console.warn(`[nodaro-video-upscale-plan] the clip's probe failed: ${err.reason instanceof Error ? err.reason.message : String(err.reason)}`)
    return new NodaroVideoUpscaleSourceUnreadableError()
  }
  if (err instanceof OutsideInputBusyError || err instanceof OutsideInputTimedOutError || err instanceof OutsideInputFailedError) {
    return new NodaroVideoUpscaleTryAgainError(err.code)
  }
  // Unreadable, or not a video at all.
  if (isOutsideInputRefusal(err)) return new NodaroVideoUpscaleSourceUnreadableError()
  return err
}

/**
 * Store (or, for a quote, only check) `videoUrl`, measure it and plan its run
 * at the tier `targetResolution` names (coerced: "2K" is 2k, a value this
 * provider does not take is 1080p). The bill is on the picture's own length
 * when it reports one. Throws a {@link NodaroVideoUpscaleRefusalError}, or as
 * it is: `LinkImportsDisabledError` (the deployment refuses outside links),
 * `UploadBlockedError` (its upload policy refused the copy), a cancellation.
 */
export async function planNodaroVideoUpscale(
  videoUrl: string,
  targetResolution: unknown,
  ctx: NodaroVideoUpscalePlanContext,
): Promise<NodaroVideoUpscalePlan> {
  // An outside clip is measured from its local copy, the probe killed when the copy's time is up.
  const inspect = async (localPath: string, signal: AbortSignal): Promise<Source> =>
    withinLength(await probeVideoSource(localPath, { signal }))
  const common = { kind: "video" as const, maxBytes: NODARO_VIDEO_UPSCALE_MAX_BYTES, userId: ctx.userId, ...(ctx.signal ? { signal: ctx.signal } : {}) }
  let stored: { url: string; bytes: number; inspected?: Source }
  try {
    if (ctx.quote) {
      const checked = await inspectOutsideInput(videoUrl, { ...common, inspect })
      stored = { url: videoUrl, bytes: checked.bytes, ...(checked.inspected ? { inspected: checked.inspected } : {}) }
    } else {
      stored = await copyOutsideInput(videoUrl, { ...common, inspect, ...(ctx.jobId ? { jobId: ctx.jobId } : {}) })
    }
  } catch (err) {
    // Stopped by its caller: the stop as it is, never a refusal of the clip.
    if (ctx.signal?.aborted) throw err
    throw asPlanRefusal(err)
  }
  // A clip already on our storage is measured where it is stored, as before.
  let source = stored.inspected
  if (!source) {
    try {
      source = await probeVideoSource(stored.url, ctx.signal ? { signal: ctx.signal } : {})
    } catch (err) {
      if (ctx.signal?.aborted) throw err
      if (isBoxFailure(err)) throw new NodaroVideoUpscaleTryAgainError("input_failed")
      console.warn(`[nodaro-video-upscale-plan] the stored clip's probe failed: ${err instanceof Error ? err.message : String(err)}`)
      throw new NodaroVideoUpscaleSourceUnreadableError()
    }
    withinLength(source)
  }
  const tier = nodaroVideoUpscaleTierOf(targetResolution)
  const sourceDurationSec = source.videoDurationSeconds ?? source.durationSeconds
  return {
    tier,
    creditId: nodaroVideoUpscaleCreditId(tier),
    videoUrl: stored.url,
    sourceDurationSec,
    billedSec: nodaroVideoUpscaleBilledSec(sourceDurationSec),
    sourceSizeBytes: stored.bytes,
  }
}

/** The BASE (pre-markup) credits a plan holds and is charged: its tier's row × billed seconds ÷ 4, rounded up once. 0 when credits are off. */
export async function nodaroVideoUpscaleBaseCredits(plan: Pick<NodaroVideoUpscalePlan, "creditId" | "billedSec">): Promise<number> {
  return unitRateBaseCredits(plan.creditId, nodaroVideoUpscaleUnits(plan.billedSec))
}

/** The job payload fields a plan stamps (what the worker runs): the stored clip's URL replaces the caller's. */
export function nodaroVideoUpscalePlanFields(plan: NodaroVideoUpscalePlan): Record<string, unknown> {
  return {
    videoUrl: plan.videoUrl,
    tier: plan.tier,
    sourceDurationSec: plan.sourceDurationSec,
    billedSec: plan.billedSec,
    sourceSizeBytes: plan.sourceSizeBytes,
  }
}

/** The refusal of a Nodaro Video Upscale this deployment does not serve: the code a denied model is refused with. */
export const NODARO_VIDEO_UPSCALE_NOT_SERVED_CODE = "model_not_available" as const

/** Why a Nodaro Video Upscale is refused where the deployment cannot run it (one sentence for every lane). */
export const NODARO_VIDEO_UPSCALE_NOT_SERVED_MESSAGE =
  "Nodaro Video Upscale is not available on this server. Choose Topaz to upscale this clip. You were not charged."

/** A request's Nodaro Video Upscale that cannot run: refused before anything is held. */
export interface NodaroVideoUpscaleRefusal {
  readonly code: string
  readonly message: string
}

/**
 * Any refusal a plan can end in, as a lane sends it: this model's own, the
 * deployment's link switch, its upload policy. Undefined for anything else
 * (a cancellation, a drain): the caller rethrows it.
 */
export function nodaroVideoUpscaleRefusalOf(err: unknown): NodaroVideoUpscaleRefusal | undefined {
  if (isNodaroVideoUpscaleRefusal(err)) return { code: err.code, message: err.message }
  if (err instanceof LinkImportsDisabledError) return { code: err.code, message: err.message }
  if (err instanceof UploadBlockedError) return { code: "upload_blocked", message: err.message }
  return undefined
}

/** True for a refusal the same request may pass in a moment (nothing about the clip is wrong). */
export function isNodaroVideoUpscaleTryAgain(refusal: Pick<NodaroVideoUpscaleRefusal, "code">): boolean {
  return refusal.code === "input_busy" || refusal.code === "input_timed_out" || refusal.code === "input_failed"
}

/** Is this queued job a Video Upscale on the Nodaro Video Upscale provider? */
export function isNodaroVideoUpscaleJob(jobName: string, payload: Readonly<Record<string, unknown>>): boolean {
  return jobName === "video-upscale" && payload.provider === NODARO_VIDEO_UPSCALE_PROVIDER
}

/**
 * The workflow run's twin of the route's preHandler: copy and measure the clip
 * the payload sends into the job's scratch folder, refuse one past a limit,
 * and stamp the plan — the stored clip's URL included — before input_data is
 * written, so the reservation, the stored request and the worker read one
 * plan. A refusal leaves no jobs row and nothing reserved.
 *
 * In a workflow run the model is refused where the deployment does not serve
 * it BEFORE this stamp runs: the payload build's model check
 * (`isModelDenied`'s house-model layer, in payload-builder.ts) refuses it with
 * the generic "not available on this deployment" sentence. The not-served
 * check here (`houseModelServed`, which answers in every process) is only a
 * backstop for a build that let it through; it still refuses without fetching
 * the clip, in this model's own sentence.
 *
 * It does NOT ask `planHouseModelRun`: that answers only in a process that
 * loaded the deployment's plugins, and a workflow run is built in one that may
 * not (the standalone orchestrator); the worker's run plans before it starts,
 * and a run it plans nothing for is refused there and refunded.
 */
export async function stampNodaroVideoUpscale(
  jobName: string,
  payload: Record<string, unknown>,
  ctx: { readonly userId: string; readonly jobId: string; readonly signal?: AbortSignal },
): Promise<{ ok: true; patch: Record<string, unknown> } | { ok: false; refusal: NodaroVideoUpscaleRefusal }> {
  if (!isNodaroVideoUpscaleJob(jobName, payload)) return { ok: true, patch: {} }
  // The backstop (the build refuses an unserved model first): not served here
  // → refused without fetching the clip.
  if (!houseModelServed(NODARO_VIDEO_UPSCALE_PROVIDER)) {
    return { ok: false, refusal: { code: NODARO_VIDEO_UPSCALE_NOT_SERVED_CODE, message: NODARO_VIDEO_UPSCALE_NOT_SERVED_MESSAGE } }
  }
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : undefined
  if (!videoUrl) return { ok: false, refusal: { code: "video_unreadable", message: new NodaroVideoUpscaleSourceUnreadableError().message } }
  let plan: NodaroVideoUpscalePlan
  try {
    plan = await planNodaroVideoUpscale(videoUrl, payload.tier, { userId: ctx.userId, jobId: ctx.jobId, ...(ctx.signal ? { signal: ctx.signal } : {}) })
  } catch (err) {
    // Stopped (the run cancelled, the worker draining): the stop as it is, never a refusal.
    if (ctx.signal?.aborted) throw err
    const refusal = nodaroVideoUpscaleRefusalOf(err)
    if (refusal) return { ok: false, refusal }
    throw err
  }
  return { ok: true, patch: { targetResolution: plan.tier, ...nodaroVideoUpscalePlanFields(plan) } }
}

/** The BASE credits a stamped Nodaro Video Upscale payload holds, or undefined for every other job. */
export async function nodaroVideoUpscaleStampedBaseCredits(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (!isNodaroVideoUpscaleJob(jobName, payload)) return undefined
  const billedSec = payload.billedSec
  if (!isNodaroVideoUpscaleTier(payload.tier)) return undefined
  if (typeof billedSec !== "number" || !Number.isInteger(billedSec) || billedSec <= 0) return undefined
  return nodaroVideoUpscaleBaseCredits({ creditId: nodaroVideoUpscaleCreditId(payload.tier), billedSec })
}

/** The row a stamped Nodaro Video Upscale payload reserves under (its tier's), or undefined for every other job. */
export function nodaroVideoUpscaleReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  if (!isNodaroVideoUpscaleJob(jobName, payload) || !isNodaroVideoUpscaleTier(payload.tier)) return undefined
  return nodaroVideoUpscaleCreditId(payload.tier)
}
