/**
 * The plan of a Topaz Rhea video upscale (`/v1/video-upscale` with provider
 * `topaz-rhea`) — the factor it sends, the target it is priced at and the
 * seconds it is billed — measured from the SOURCE clip once, before anything
 * is reserved.
 *
 * Read by `/v1/video-upscale`'s preHandler and by `POST /v1/quote`, which runs
 * the same pricing chain. The route stamps the plan onto the job, so the
 * worker sends exactly the factor that was priced.
 *
 * Pricing (decided 2026-11-24, `@nodaro/render-rules` topaz-rhea-pricing.ts):
 * the target's per-second row × the billed seconds, rounded up once; the hold
 * is the charge.
 */
import { isTopazVideoResolution, type TopazVideoResolution } from "@nodaro/shared/models"
import {
  TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS,
  topazRheaBilledSec,
  topazRheaCreditId,
  topazRheaMaxSourceSec,
  topazRheaOutputGigapixels,
  rheaExpectedFrame,
  topazRheaUpscaleFactor,
} from "@nodaro/render-rules"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { displayedFrame } from "./displayed-frame.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { guardedPacketScan, videoTrackHeaderOf, videoTrackLengthFrom } from "./video-track-length.js"
import { probeLinkRefusal, probeRefusalStatus } from "../providers/video/probe-guard.js"
import {
  copyOutsideInput,
  inspectOutsideInput,
  OUTSIDE_INPUT_SIZE_SCALED_DOWNLOAD,
  isOutsideInputRefusal,
  OUTSIDE_INPUT_MAX_BYTES_CEILING,
  OutsideInputBusyError,
  OutsideInputFailedError,
  OutsideInputInspectRefusedError,
  OutsideInputTimedOutError,
  OutsideInputTooLargeError,
} from "./outside-input-copy.js"
import { LinkImportsDisabledError } from "./link-imports.js"
import { UploadBlockedError } from "./upload-policy.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { TopazVideoSourceUnreadableError } from "./topaz-video-plan.js"

export { TopazVideoSourceUnreadableError }

export interface TopazRheaUpscalePlan {
  /** The clip the run sends: our storage's copy of an outside clip, or a stored clip's own address (a quote keeps the caller's). */
  readonly videoUrl: string
  /** The target the run is priced at (720p / 1080p / 4k). */
  readonly target: TopazVideoResolution
  /** The factor sent (1–4): the source's short side × it reaches the target's (at most 4×). */
  readonly upscaleFactor: number
  /** The frame the run delivers (`rheaExpectedFrame`: source × factor, each side even); the delivery crops the engine's file to it. */
  readonly outputWidth: number
  readonly outputHeight: number
  /** The whole seconds the run is billed for. */
  readonly billedSec: number
  /** The target's per-second row. */
  readonly creditId: string
}

const TARGET_LABEL: Readonly<Record<TopazVideoResolution, string>> = { "720p": "720p", "1080p": "1080p", "4k": "4K" }

/** A source whose short side is already at or above the target's: nothing to upscale, refused before anything is held. */
export class TopazRheaAlreadyAtTargetError extends Error {
  readonly code = "video_already_at_target"
  constructor(target: TopazVideoResolution, width: number, height: number) {
    super(
      `This clip is already ${width}×${height}, at or above ${TARGET_LABEL[target]} — there is nothing to upscale. ` +
      "Choose a larger target resolution.",
    )
    this.name = "TopazRheaAlreadyAtTargetError"
  }
}

/** A source longer than the run accepts (`TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS`): refused before anything is held. */
export class TopazRheaTooLongError extends Error {
  readonly code = "video_too_long"
  constructor(readonly maxSec: number, target: TopazVideoResolution) {
    super(
      `This clip is too long to upscale to ${TARGET_LABEL[target]} — up to ${maxSec} seconds can be upscaled at that size. ` +
      "Trim the clip, or choose a lower resolution.",
    )
    this.name = "TopazRheaTooLongError"
  }
}

/** A source larger than {@link TOPAZ_RHEA_MAX_BYTES}: refused before anything is held (or copied). */
export class TopazRheaTooLargeError extends Error {
  readonly code = "video_too_large"
  constructor() {
    super(`This clip is larger than ${Math.floor(TOPAZ_RHEA_MAX_BYTES / (1024 * 1024))} MB, the most this upscale takes. Trim or compress the clip.`)
    this.name = "TopazRheaTooLargeError"
  }
}

/** The largest clip copied into our storage for a run: the outside-input copy's own ceiling. */
export const TOPAZ_RHEA_MAX_BYTES = OUTSIDE_INPUT_MAX_BYTES_CEILING

/** A plan's refusal as the route answers it: its status, code and sentence. */
export interface TopazRheaRefusal {
  readonly status: number
  readonly code: string
  readonly message: string
}

/**
 * Any refusal a plan can end in, as the route sends it — the clip's (400; a
 * probe that could not run, 503), the copy's "try again" (429 busy, 503 timed
 * out or failed), the deployment's link switch (403) and upload policy (422);
 * undefined for anything else (a cancellation), which the caller rethrows.
 */
export function topazRheaRefusalOf(err: unknown): TopazRheaRefusal | undefined {
  if (err instanceof TopazVideoSourceUnreadableError || err instanceof TopazRheaAlreadyAtTargetError || err instanceof TopazRheaTooLongError || err instanceof TopazRheaTooLargeError) {
    return { status: probeRefusalStatus(err.code), code: err.code, message: err.message }
  }
  if (err instanceof OutsideInputBusyError) return { status: 429, code: err.code, message: "Couldn't fetch the clip just now. Try again in a moment." }
  if (err instanceof OutsideInputTimedOutError || err instanceof OutsideInputFailedError) return { status: 503, code: err.code, message: "Couldn't fetch the clip just now. Try again in a moment." }
  if (err instanceof LinkImportsDisabledError) return { status: 403, code: err.code, message: err.message }
  if (err instanceof UploadBlockedError) return { status: 422, code: "upload_blocked", message: err.message }
  return undefined
}

/** The copy's refusal in this lane's words; anything else as it is. */
function asPlanRefusal(err: unknown): unknown {
  if (err instanceof OutsideInputTooLargeError) return new TopazRheaTooLargeError()
  if (err instanceof OutsideInputInspectRefusedError) {
    const reason = err.reason
    if (reason instanceof TopazRheaAlreadyAtTargetError || reason instanceof TopazRheaTooLongError || reason instanceof TopazVideoSourceUnreadableError) return reason
    return new TopazVideoSourceUnreadableError()
  }
  if (err instanceof OutsideInputBusyError || err instanceof OutsideInputTimedOutError || err instanceof OutsideInputFailedError) return err
  if (isOutsideInputRefusal(err)) return new TopazVideoSourceUnreadableError()
  return err
}

/** What the plan measures of the clip: its displayed frame, rate and picture length. */
interface MeasuredClip {
  readonly frame: { readonly width: number; readonly height: number }
  readonly fps?: number
  readonly track: { readonly sec: number; readonly reading: "container" | "video-stream" }
}

/** Probe the clip at `src` (a local copy or a stored clip): its DISPLAYED frame (a rotation tag applied) and its picture's length. */
async function measureClip(src: string, signal?: AbortSignal): Promise<MeasuredClip> {
  let source: Awaited<ReturnType<typeof probeVideoSource>>
  try {
    source = await probeVideoSource(src, signal ? { signal } : {})
  } catch (err) {
    if (signal?.aborted) throw err
    console.warn(`[topaz-rhea-plan] source probe failed: ${err instanceof Error ? err.message : String(err)}`)
    throw new TopazVideoSourceUnreadableError(probeLinkRefusal(err))
  }
  // The picture's length: the stream's, its DURATION tag (a WebM / MKV), its
  // packets; only when all three fail, the container's — billed less its
  // allowance (`topazRheaBilledSec`). The same reading Topaz's plan takes.
  const track = (await videoTrackLengthFrom(videoTrackHeaderOf(source), guardedPacketScan(src, { timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS, ...(signal ? { signal } : {}) }), signal))
    ?? { sec: source.durationSeconds, reading: "container" as const }
  return { frame: displayedFrame(source), ...(source.fps !== undefined ? { fps: source.fps } : {}), track }
}

/** The run a measured clip plans at `target`, or its refusal (thrown). */
function planOf(clip: MeasuredClip, target: TopazVideoResolution): Omit<TopazRheaUpscalePlan, "videoUrl"> {
  const upscaleFactor = topazRheaUpscaleFactor(clip.frame, target)
  if (upscaleFactor === undefined) throw new TopazRheaAlreadyAtTargetError(target, clip.frame.width, clip.frame.height)
  const shape = { source: clip.frame, factor: upscaleFactor, ...(clip.fps !== undefined ? { fps: clip.fps } : {}) }
  if (topazRheaOutputGigapixels({ ...shape, durationSec: clip.track.sec }) > TOPAZ_RHEA_MAX_OUTPUT_GIGAPIXELS) {
    throw new TopazRheaTooLongError(topazRheaMaxSourceSec(shape), target)
  }
  const output = rheaExpectedFrame(clip.frame, upscaleFactor)
  return {
    target,
    upscaleFactor,
    outputWidth: output.width,
    outputHeight: output.height,
    billedSec: topazRheaBilledSec(clip.track.sec, clip.track.reading),
    creditId: topazRheaCreditId(target),
  }
}

/**
 * Store (or, for a quote, only check) the clip, measure it and plan its run.
 * An outside clip is copied into our storage first and measured from the
 * local copy (`copyOutsideInput`): the run sends that copy, so the clip the
 * engine reads is the clip that was measured and priced. A clip already on our
 * storage is used as it is. Throws a refusal `topazRheaRefusalOf` answers, or
 * as it is (a cancellation).
 */
export async function planTopazRheaUpscale(
  videoUrl: string,
  target: TopazVideoResolution,
  ctx: { readonly userId: string; readonly quote?: boolean; readonly signal?: AbortSignal },
): Promise<TopazRheaUpscalePlan> {
  let planned: Omit<TopazRheaUpscalePlan, "videoUrl"> | undefined
  const inspect = async (localPath: string, signal: AbortSignal): Promise<MeasuredClip> => {
    const clip = await measureClip(localPath, signal)
    planned = planOf(clip, target)
    return clip
  }
  // Up to 500 MB from an outside host: size-scaled (a flat 120 s needs 4.2 MB/s),
  // ending inside the copy slot's 5-min hold that bounds this whole step.
  const common = {
    kind: "video" as const, maxBytes: TOPAZ_RHEA_MAX_BYTES, userId: ctx.userId, inspect,
    downloadRate: OUTSIDE_INPUT_SIZE_SCALED_DOWNLOAD, ...(ctx.signal ? { signal: ctx.signal } : {}),
  }
  let storedUrl: string
  try {
    storedUrl = ctx.quote
      ? (await inspectOutsideInput(videoUrl, common), videoUrl)
      : (await copyOutsideInput(videoUrl, common)).url
  } catch (err) {
    if (ctx.signal?.aborted) throw err
    throw asPlanRefusal(err)
  }
  // A clip already on our storage is measured where it is stored.
  if (!planned) planned = planOf(await measureClip(storedUrl, ctx.signal), target)
  return { ...planned, videoUrl: storedUrl }
}

/** The BASE (pre-markup) credits a plan holds and is charged: the target's row × its billed seconds, rounded up once. 0 when credits are off. */
export async function topazRheaBaseCredits(plan: Pick<TopazRheaUpscalePlan, "creditId" | "billedSec">): Promise<number> {
  return unitRateBaseCredits(plan.creditId, plan.billedSec)
}


/**
 * What a Rhea run (this provider, and Nodaro Video Upscale's transparent mode)
 * carries on its job and in its stored request: the factor sent, the seconds
 * billed, the frame delivered and the target whose listed rate records its
 * provider cost. Read back by the worker and the reconcile
 * ({@link readRheaRunFields}), so both deliver the same run.
 */
export interface RheaRunFields {
  readonly upscaleRatio: number
  readonly upscaleBilledSec: number
  readonly upscaleFrameWidth: number
  readonly upscaleFrameHeight: number
  readonly upscaleRateTier: TopazVideoResolution
}

export function rheaRunFields(plan: { upscaleFactor: number; billedSec: number; outputWidth: number; outputHeight: number }, rateTarget: TopazVideoResolution): RheaRunFields {
  return {
    upscaleRatio: plan.upscaleFactor,
    upscaleBilledSec: plan.billedSec,
    upscaleFrameWidth: plan.outputWidth,
    upscaleFrameHeight: plan.outputHeight,
    upscaleRateTier: rateTarget,
  }
}

/** The run fields of a job's data or stored request, or undefined when any is missing (a job that cannot be run or delivered). */
export function readRheaRunFields(data: Readonly<Record<string, unknown>> | null | undefined): RheaRunFields | undefined {
  const d = data ?? {}
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)
  const factor = num(d.upscaleRatio)
  const billedSec = num(d.upscaleBilledSec)
  const width = num(d.upscaleFrameWidth)
  const height = num(d.upscaleFrameHeight)
  if (factor === undefined || billedSec === undefined || width === undefined || height === undefined || !isTopazVideoResolution(d.upscaleRateTier)) return undefined
  return { upscaleRatio: factor, upscaleBilledSec: billedSec, upscaleFrameWidth: width, upscaleFrameHeight: height, upscaleRateTier: d.upscaleRateTier }
}
