/**
 * The plan of a Topaz video upscale — the target it renders at and the units it
 * holds — measured from the SOURCE clip once, before anything is reserved.
 *
 * One function for both lanes that charge such a run: `/v1/video-upscale`'s
 * preHandler (and `POST /v1/quote`, which runs the same pricing chain) and the
 * workflow run's reservation (`node-executor.ts`). Both stamp the resolved
 * target onto the job, so the worker renders exactly what was priced.
 *
 * Pricing (decided 2026-10-25, `@nodaro/render-rules` topaz-pricing.ts): the
 * run HOLDS its output-gigapixel ceiling at the unit's price row and is charged
 * the units Replicate reports, never above the hold.
 */
import { resolveTopazVideoTarget, type TopazVideoResolution } from "@nodaro/shared/models"
import {
  TOPAZ_VIDEO_MAX_OUTPUT_GIGAPIXELS,
  TOPAZ_VIDEO_UNIT_CREDIT_ID,
  topazVideoHoldUnits,
  topazVideoHoldSourceSec,
  topazVideoMaxSourceSec,
  topazVideoOutputGigapixels,
} from "@nodaro/render-rules"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { guardedPacketScan, videoTrackHeaderOf, videoTrackLengthFrom } from "./video-track-length.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { linkImportRefusal } from "./link-imports.js"

export interface TopazVideoUpscalePlan {
  readonly resolution: TopazVideoResolution
  readonly fps: number
  /** The units the run holds (its output gigapixels at the hold rate). */
  readonly holdUnits: number
  readonly sourceDurationSec: number
}

export interface TopazVideoUpscaleAsk {
  targetResolution?: unknown
  targetFps?: unknown
  upscaleFactor?: unknown
}

/** A source the plan cannot read: refused before anything is reserved. */
export class TopazVideoSourceUnreadableError extends Error {
  readonly code: "video_unreadable" | ProbeLinkRefusalCode
  /** `refused`: the probe's own meaning when it has one (`probeLinkRefusal`: not a media file, or retryable), said so. */
  constructor(refused?: { readonly code: ProbeLinkRefusalCode; readonly message: string }) {
    super(refused?.message ?? "Couldn't read the video to upscale. Check that the link opens a video file, then try again.")
    this.code = refused?.code ?? "video_unreadable"
    this.name = "TopazVideoSourceUnreadableError"
  }
}

/** A source longer than the target accepts (`TOPAZ_VIDEO_MAX_OUTPUT_GIGAPIXELS`): refused before anything is reserved. */
export class TopazVideoTooLongError extends Error {
  readonly code = "video_too_long"
  constructor(readonly maxSec: number, resolution: TopazVideoResolution, fps: number) {
    super(
      `This clip is too long to upscale to ${resolution === "4k" ? "4K" : resolution} at ${fps} fps — up to ${maxSec} seconds can be upscaled at those settings. ` +
      "Trim the clip, or choose a lower resolution or frame rate.",
    )
    this.name = "TopazVideoTooLongError"
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

export async function planTopazVideoUpscale(videoUrl: string, ask: TopazVideoUpscaleAsk): Promise<TopazVideoUpscalePlan> {
  let source: Awaited<ReturnType<typeof probeVideoSource>>
  try {
    source = await probeVideoSource(videoUrl)
  } catch (err) {
    console.warn(`[topaz-video-plan] source probe failed: ${err instanceof Error ? err.message : String(err)}`)
    throw new TopazVideoSourceUnreadableError(probeLinkRefusal(err))
  }
  const target = resolveTopazVideoTarget({
    targetResolution: str(ask.targetResolution),
    targetFps: typeof ask.targetFps === "number" ? ask.targetFps : str(ask.targetFps),
    upscaleFactor: str(ask.upscaleFactor),
    source,
  })
  // The picture's length: the stream's, its DURATION tag (a WebM / MKV), its packets; only when all three fail, the
  // container's — held less its allowance (`topazVideoHoldSourceSec`).
  const track = (await videoTrackLengthFrom(videoTrackHeaderOf(source), guardedPacketScan(videoUrl, { timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS })))
    ?? { sec: source.durationSeconds, reading: "container" as const }
  const sourceDurationSec = track.sec
  const shape = { resolution: target.resolution, fps: target.fps, source }
  if (topazVideoOutputGigapixels({ ...shape, durationSec: sourceDurationSec }) > TOPAZ_VIDEO_MAX_OUTPUT_GIGAPIXELS) {
    throw new TopazVideoTooLongError(topazVideoMaxSourceSec(shape), target.resolution, target.fps)
  }
  const heldSec = topazVideoHoldSourceSec(track.sec, track.reading)
  return {
    resolution: target.resolution,
    fps: target.fps,
    holdUnits: topazVideoHoldUnits({
      resolution: target.resolution,
      fps: target.fps,
      durationSec: heldSec,
      source,
    }),
    sourceDurationSec,
  }
}

/** The BASE (pre-markup) credits a plan holds: the unit's row × its hold units. 0 when credits are off. */
export async function topazVideoHoldBaseCredits(plan: Pick<TopazVideoUpscalePlan, "holdUnits">): Promise<number> {
  return unitRateBaseCredits(TOPAZ_VIDEO_UNIT_CREDIT_ID, plan.holdUnits)
}

/** A workflow run's Topaz upscale refused before a jobs row is kept: a source it cannot read or measure, or a link the deployment does not import. */
export interface TopazVideoRefusal {
  readonly code: "video_unreadable" | "video_too_long" | "link_imports_disabled" | ProbeLinkRefusalCode
  readonly message: string
}

/** Is this queued job a Topaz video upscale (the default provider)? */
export function isTopazVideoUpscaleJob(jobName: string, payload: Record<string, unknown>): boolean {
  return jobName === "video-upscale" && (payload.provider === undefined || payload.provider === "topaz")
}

/**
 * The workflow run's twin of the route's preHandler: measure the source the
 * payload sends, resolve the target and stamp it — with the units it holds —
 * onto the payload before input_data is written, so the reservation, the
 * worker and the reconcile lane read one plan. An unreadable source is refused
 * (no jobs row, nothing reserved), as the route refuses it, and so is a link to
 * outside content where the deployment turned link imports off — asked before
 * the clip is read. Every edition: the legacy factor and "same as source" need
 * the clip either way.
 */
export async function stampTopazVideoUpscale(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; patch: Record<string, unknown> } | { ok: false; refusal: TopazVideoRefusal }> {
  if (!isTopazVideoUpscaleJob(jobName, payload)) return { ok: true, patch: {} }
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : undefined
  if (!videoUrl) return { ok: true, patch: {} }
  const linkRefused = linkImportRefusal(videoUrl)
  if (linkRefused) return { ok: false, refusal: linkRefused }
  try {
    const plan = await planTopazVideoUpscale(videoUrl, payload)
    return {
      ok: true,
      patch: { targetResolution: plan.resolution, targetFps: plan.fps, topazHoldUnits: plan.holdUnits },
    }
  } catch (err) {
    if (err instanceof TopazVideoSourceUnreadableError || err instanceof TopazVideoTooLongError) {
      return { ok: false, refusal: { code: err.code, message: err.message } }
    }
    throw err
  }
}

/** The BASE credits a stamped Topaz payload holds, or undefined for every other job. */
export async function topazVideoStampedBaseCredits(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (!isTopazVideoUpscaleJob(jobName, payload)) return undefined
  const holdUnits = payload.topazHoldUnits
  if (typeof holdUnits !== "number" || !Number.isFinite(holdUnits) || holdUnits <= 0) return undefined
  return topazVideoHoldBaseCredits({ holdUnits })
}
