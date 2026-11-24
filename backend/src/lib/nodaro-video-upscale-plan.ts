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
 * Two modes (decided 2026-11-24), read through `nodaroVideoUpscaleModeOf`
 * (unset: transparent). SHARP is the engine behind the house-model seam, as it
 * always was: the tier's four-second row × whole billed seconds ÷ 4, rounded
 * up once. TRANSPARENT runs on the Rhea lane (providers/fal/topaz-rhea.ts):
 * the clip enlarged by the largest factor that fits it inside the tier's box
 * (Sharp's box, and 1280×720 for 720p; turned for a portrait clip), at most
 * 4× (a clip that already fills the box, or one that would need more, is
 * refused), priced on Transparent's own one-second rows by tier × the exact
 * length (1/64 s steps), rounded up once. Either way a flat price, so the hold IS
 * the charge.
 *
 * Limits, both modes: a clip longer than 60 s or larger than 50 MB is
 * refused, and so is one that cannot be read — before any credits are held.
 * The 50 MB cap bounds the copy into our storage, which both modes go
 * through, so it is kept for transparent too.
 */
import {
  NODARO_VIDEO_UPSCALE_MAX_BYTES,
  NODARO_VIDEO_UPSCALE_PROVIDER,
  NODARO_VIDEO_UPSCALE_MAX_SEC,
  isNodaroVideoUpscaleMode,
  nodaroVideoUpscaleEffectiveMode,
  nodaroVideoUpscaleModeOf,
  nodaroVideoUpscaleModeTakes,
  type NodaroVideoUpscaleMode,
  type NodaroVideoUpscaleModeTier,
} from "@nodaro/shared/models"
import {
  nodaroVideoUpscaleModeBilledSec,
  nodaroVideoUpscaleModeCreditId,
  nodaroVideoUpscaleModeTierOf,
  nodaroVideoUpscaleModeUnits,
  nodaroVideoUpscaleTransparentPlan,
  nodaroVideoUpscaleTransparentRateTarget,
  nodaroVideoUpscaleTransparentServes,
  TOPAZ_RHEA_FALLBACK_FPS,
  TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS,
} from "@nodaro/render-rules"
import { rheaRunFields, type RheaRunFields } from "./topaz-rhea-plan.js"
import { nodaroTransparentAvailable } from "./nodaro-transparent-available.js"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { displayedFrame } from "./displayed-frame.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { guardedPacketScan, videoTrackHeaderOf, videoTrackLengthFrom, type VideoTrackLength } from "./video-track-length.js"
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
  /** The mode it runs in (`nodaroVideoUpscaleModeOf`). */
  readonly mode: NodaroVideoUpscaleMode
  /** The tier, one its mode takes (sharp never 720p). */
  readonly tier: NodaroVideoUpscaleModeTier
  /** The row the run is charged a multiple of (`nodaroVideoUpscaleModeCreditId`). */
  readonly creditId: string
  /**
   * The clip the run sends: a file of our own storage (an outside clip's copy,
   * or a stored clip's canonical address). A quote's plan keeps the URL it was
   * given: it stores nothing and runs nothing.
   */
  readonly videoUrl: string
  /** The clip's length in seconds, unrounded: its picture stream's, else the container's. */
  readonly sourceDurationSec: number
  /** The seconds the run is billed (`nodaroVideoUpscaleModeBilledSec`: whole seconds in sharp, 1/64 s steps in transparent). */
  readonly billedSec: number
  /** Its exact size: the bytes copied, or storage's record of a stored clip. */
  readonly sourceSizeBytes: number
  /** Transparent only: the Rhea run (factor, billed seconds, delivered frame, rate target). */
  readonly rhea?: RheaRunFields
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

/** Transparent: a clip that already fills the tier's box. */
export class NodaroVideoUpscaleAlreadyAtTierError extends Error {
  readonly code = "video_already_at_target"
  constructor(tier: NodaroVideoUpscaleModeTier, width: number, height: number) {
    super(
      `This clip (${width}×${height}) already fills the ${tierLabel(tier)} frame — there is nothing to upscale. ` +
      "Choose a larger resolution.",
    )
    this.name = "NodaroVideoUpscaleAlreadyAtTierError"
  }
}

/** Transparent: a clip that would need more than 4× to reach the tier (it never delivers a smaller frame than the tier promises). */
export class NodaroVideoUpscaleTooSmallError extends Error {
  readonly code = "video_too_small"
  constructor(tier: NodaroVideoUpscaleModeTier, width: number, height: number, largest: NodaroVideoUpscaleModeTier | undefined) {
    super(
      `This clip (${width}×${height}) is too small to upscale to ${tierLabel(tier)} in Transparent mode — it can be enlarged up to 4×. ` +
      (largest ? `Choose ${tierLabel(largest)} or lower.` : "Use a larger clip."),
    )
    this.name = "NodaroVideoUpscaleTooSmallError"
  }
}

/**
 * Transparent: a clip whose output (frame × frames) is past the run's bound
 * (`TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS`, 10 gigapixels), naming the longest this
 * clip may be at this tier. Under the 60 s limit it binds only at 4K (about
 * 50 s at 24 fps, 40 s at 30, 20 s at 60) and at 2K at 60 fps (about 45 s).
 */
export class NodaroVideoUpscaleTransparentTooLongError extends Error {
  readonly code = "video_too_long"
  constructor(tier: NodaroVideoUpscaleModeTier, readonly maxSec: number) {
    super(
      `This clip is too long to upscale to ${tierLabel(tier)} in Transparent mode — up to ${maxSec} seconds of it can be upscaled at that size. ` +
      "Trim the clip, or choose a lower resolution.",
    )
    this.name = "NodaroVideoUpscaleTransparentTooLongError"
  }
}

function tierLabel(tier: NodaroVideoUpscaleModeTier): string {
  return tier === "2k" ? "2K" : tier === "4k" ? "4K" : tier
}

export type NodaroVideoUpscaleRefusalError =
  | NodaroVideoUpscaleTransparentTooLongError
  | NodaroVideoUpscaleAlreadyAtTierError
  | NodaroVideoUpscaleTooSmallError
  | NodaroVideoUpscaleSourceUnreadableError
  | NodaroVideoUpscaleTooLongError
  | NodaroVideoUpscaleTooLargeError
  | NodaroVideoUpscaleTryAgainError

export function isNodaroVideoUpscaleRefusal(err: unknown): err is NodaroVideoUpscaleRefusalError {
  return err instanceof NodaroVideoUpscaleSourceUnreadableError
    || err instanceof NodaroVideoUpscaleAlreadyAtTierError
    || err instanceof NodaroVideoUpscaleTooSmallError
    || err instanceof NodaroVideoUpscaleTransparentTooLongError
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

/** The probe of the clip, and its picture's length (`videoTrackLengthFrom`: the stream's, its tag, its packets, else the container's). */
type Source = Awaited<ReturnType<typeof probeVideoSource>> & { readonly track?: VideoTrackLength }

/** Probe the clip at `src` (a local copy or a stored clip) and read its picture's length while it is there. */
async function measureClip(src: string, signal?: AbortSignal): Promise<Source> {
  const probed = await probeVideoSource(src, signal ? { signal } : {})
  const track = await videoTrackLengthFrom(
    videoTrackHeaderOf(probed),
    guardedPacketScan(src, { timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS, ...(signal ? { signal } : {}) }),
    signal,
  )
  return track ? { ...probed, track } : probed
}

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
  /** The mode as asked: "sharp" / "transparent" sent explicitly, else none (Transparent, falling back to Sharp: `nodaroVideoUpscaleEffectiveMode`). */
  modeAsked?: unknown,
): Promise<NodaroVideoUpscalePlan> {
  // An outside clip is measured from its local copy, the probe killed when the copy's time is up.
  const inspect = async (localPath: string, signal: AbortSignal): Promise<Source> =>
    withinLength(await measureClip(localPath, signal))
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
      source = await measureClip(stored.url, ctx.signal)
    } catch (err) {
      if (ctx.signal?.aborted) throw err
      if (isBoxFailure(err)) throw new NodaroVideoUpscaleTryAgainError("input_failed")
      console.warn(`[nodaro-video-upscale-plan] the stored clip's probe failed: ${err instanceof Error ? err.message : String(err)}`)
      throw new NodaroVideoUpscaleSourceUnreadableError()
    }
    withinLength(source)
  }
  // Transparent: the largest factor that fits the tier's box, or the clip's refusal (before anything is held).
  let rhea: RheaRunFields | undefined
  // The picture's length: the stream's, its DURATION tag (a WebM / MKV), its packets; only when all three fail, the
  // container's — billed less its allowance.
  const track = source.track ?? { sec: source.durationSeconds, reading: "container" as const }
  const sourceDurationSec = track.sec
  // The mode, decided ONCE from what was asked and the measured clip
  // (`nodaroVideoUpscaleEffectiveMode`): no mode runs Transparent unless it
  // cannot serve this clip at this tier, or this install cannot run it — then
  // Sharp at Sharp's price. An explicit mode is kept (Transparent's refusals below).
  const transparentServes = isNodaroVideoUpscaleMode(modeAsked)
    ? undefined
    : !nodaroTransparentAvailable()
      ? false
      : nodaroVideoUpscaleTransparentServes(
          { ...displayedFrame(source), ...(source.fps !== undefined ? { fps: source.fps } : {}), sec: sourceDurationSec },
          nodaroVideoUpscaleModeTierOf("transparent", targetResolution),
        )
  const mode = nodaroVideoUpscaleEffectiveMode(modeAsked, transparentServes)
  const tier = nodaroVideoUpscaleModeTierOf(mode, targetResolution)
  const billedSec = nodaroVideoUpscaleModeBilledSec(mode, sourceDurationSec, track.reading)
  if (mode === "transparent") {
    // The DISPLAYED frame: a phone clip stored 1920×1080 with a 90° rotation tag is portrait.
    const shown = displayedFrame(source)
    const planned = nodaroVideoUpscaleTransparentPlan(shown, tier)
    if (!planned.ok) {
      throw planned.reason === "already_at_tier"
        ? new NodaroVideoUpscaleAlreadyAtTierError(tier, shown.width, shown.height)
        : new NodaroVideoUpscaleTooSmallError(tier, shown.width, shown.height, planned.largestTier)
    }
    // The same output bound as the bare provider: a run past it would outlast the worker's wait.
    const fps = source.fps !== undefined && Number.isFinite(source.fps) && source.fps > 0 ? source.fps : TOPAZ_RHEA_FALLBACK_FPS
    const framePixels = planned.frame.width * planned.frame.height
    if ((framePixels * Math.ceil(sourceDurationSec * fps)) / 1e9 > TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS) {
      throw new NodaroVideoUpscaleTransparentTooLongError(tier, Math.floor((TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS * 1e9) / (framePixels * fps)))
    }
    rhea = rheaRunFields(
      { upscaleFactor: planned.factor, billedSec, outputWidth: planned.frame.width, outputHeight: planned.frame.height },
      nodaroVideoUpscaleTransparentRateTarget(tier),
    )
  }
  return {
    mode,
    tier,
    creditId: nodaroVideoUpscaleModeCreditId(mode, tier),
    videoUrl: stored.url,
    sourceDurationSec,
    billedSec,
    sourceSizeBytes: stored.bytes,
    ...(rhea ? { rhea } : {}),
  }
}

/** The BASE (pre-markup) credits a plan holds and is charged: its mode's row × its units (sharp: billed seconds ÷ 4; transparent: billed seconds), rounded up once. 0 when credits are off. */
export async function nodaroVideoUpscaleBaseCredits(plan: Pick<NodaroVideoUpscalePlan, "creditId" | "billedSec"> & { readonly mode?: NodaroVideoUpscaleMode }): Promise<number> {
  return unitRateBaseCredits(plan.creditId, nodaroVideoUpscaleModeUnits(plan.mode ?? "sharp", plan.billedSec))
}

/** The job payload fields a plan stamps (what the worker runs): the stored clip's URL replaces the caller's. */
export function nodaroVideoUpscalePlanFields(plan: NodaroVideoUpscalePlan): Record<string, unknown> {
  return {
    videoUrl: plan.videoUrl,
    mode: plan.mode,
    tier: plan.tier,
    sourceDurationSec: plan.sourceDurationSec,
    billedSec: plan.billedSec,
    sourceSizeBytes: plan.sourceSizeBytes,
    ...(plan.rhea ?? {}),
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
  // Transparent mode runs on fal: an install with no fal key is refused before the clip is fetched.
  if (payload.mode === "transparent" && !nodaroTransparentAvailable()) {
    return { ok: false, refusal: { code: "provider_unavailable", message: "Nodaro Video Upscale's Transparent mode is not available on this deployment. You were not charged." } }
  }
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : undefined
  if (!videoUrl) return { ok: false, refusal: { code: "video_unreadable", message: new NodaroVideoUpscaleSourceUnreadableError().message } }
  let plan: NodaroVideoUpscalePlan
  try {
    plan = await planNodaroVideoUpscale(videoUrl, payload.tier, { userId: ctx.userId, jobId: ctx.jobId, ...(ctx.signal ? { signal: ctx.signal } : {}) }, payload.mode)
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
  const mode = nodaroVideoUpscaleModeOf(payload.mode)
  if (!nodaroVideoUpscaleModeTakes(mode, payload.tier)) return undefined
  if (typeof billedSec !== "number" || !Number.isFinite(billedSec) || billedSec <= 0) return undefined
  if (mode === "sharp" && !Number.isInteger(billedSec)) return undefined
  return nodaroVideoUpscaleBaseCredits({ mode, creditId: nodaroVideoUpscaleModeCreditId(mode, payload.tier), billedSec })
}

/** The row a stamped Nodaro Video Upscale payload reserves under (its tier's), or undefined for every other job. */
export function nodaroVideoUpscaleReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  if (!isNodaroVideoUpscaleJob(jobName, payload)) return undefined
  const mode = nodaroVideoUpscaleModeOf(payload.mode)
  if (!nodaroVideoUpscaleModeTakes(mode, payload.tier)) return undefined
  return nodaroVideoUpscaleModeCreditId(mode, payload.tier)
}
