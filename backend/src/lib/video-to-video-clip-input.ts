import {
  checkVideoToVideoClipLength,
  isClipPricedV2vProvider,
  videoToVideoClipPrice,
  videoToVideoClipRateOf,
  videoToVideoSentResolution,
  V2V_CLIP_RATE_IDS,
  WAN_VIDEOEDIT_FLOOR_CREDIT_ID,
  type ClipPricedV2vProvider,
} from "@nodaro/shared/credits"
import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"
import { baseCreditCostFor, unitRateBaseCredits } from "./credit-base-cost.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeClipLengthSec } from "./video-utility-probe.js"

/**
 * Video to Video input gate for the models priced by the length of their clip
 * (HappyHorse Edit, Wan 2.7 VideoEdit — `isClipPricedV2vProvider`): reads the
 * clip's length before anything is held, refuses one the model cannot take,
 * and prices the run from that length (`videoToVideoClipPrice`,
 * @nodaro/shared). Every other Video to Video model is never probed.
 *
 * CORE, deliberately not `ee/` — input validation runs in every edition. One
 * rule for both places a run starts: the route's step in the credit guard
 * (`beforePricing`, so a model the deployment withholds never costs a
 * download and a refusal is a 400 with nothing held; `POST /v1/quote` runs the
 * same step) and the workflow run's stamp (before input_data is written or
 * anything is reserved).
 *
 * The length is the container's (`probeClipLengthSec`). A read that fails
 * refuses the run, never prices a guess: a host that could not be looked up
 * for now, or a read that ran out of time, is the retryable 503 every such
 * route answers (`probeLinkRefusal`); a file that cannot be read is a 400.
 */
export type VideoToVideoClipMeasure =
  | {
      readonly ok: true
      /** The clip's length, in seconds, as the server read it. */
      readonly clipSec: number
      /** The seconds the run is held and charged for (HappyHorse Edit: in half-seconds). */
      readonly billedSeconds: number
      /** The row the run reserves. */
      readonly creditId: string
      /** Units of that row the run is charged (a rate); undefined for a row charged once (Wan 2.7 VideoEdit's flat row). */
      readonly units?: number
    }
  | {
      readonly ok: false
      readonly code: "video_too_short" | "video_too_long" | "video_unreadable" | ProbeLinkRefusalCode
      readonly message: string
    }

export const VIDEO_TO_VIDEO_UNREADABLE_MESSAGE =
  "The video could not be read. Check that the link is a reachable video file."

/** What a clip-priced run is: its model, the size it names and (Wan 2.7 VideoEdit) the output length it asks for. */
export interface VideoToVideoClipRun {
  readonly provider: ClipPricedV2vProvider
  readonly resolution?: unknown
  readonly videoEditDuration?: unknown
}

/**
 * The live base rows of the two prices Wan 2.7 VideoEdit is charged the larger
 * of (its flat row and its rate row) — `model_pricing`, else the static table,
 * the lookup a run is charged from — so an administrator's retune of either row
 * moves where the rate takes over. HappyHorse Edit reads no row here.
 */
async function liveRowsFor(run: VideoToVideoClipRun): Promise<(id: string) => number | undefined> {
  if (run.provider !== "wan-videoedit") return () => undefined
  const rate = videoToVideoClipRateOf(run.provider, run.resolution)!
  const [floor, rateRow] = await Promise.all([baseCreditCostFor(WAN_VIDEOEDIT_FLOOR_CREDIT_ID), baseCreditCostFor(rate.rateId)])
  return (id) => (id === WAN_VIDEOEDIT_FLOOR_CREDIT_ID ? floor : id === rate.rateId ? rateRow : undefined)
}

export async function measureVideoToVideoClip(
  run: VideoToVideoClipRun,
  videoUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
  /** A route's deadline for the whole read (its client is waiting); without one the packet scan gets the download bound. */
  bounds: { readonly deadlineAt?: number } = {},
): Promise<VideoToVideoClipMeasure> {
  let seconds: number
  try {
    seconds = await probeClipLengthSec(videoUrl, {
      reading: "container",
      timeoutMs: PRE_CHARGE_PROBE_TIMEOUT_MS,
      ...(bounds.deadlineAt !== undefined ? { deadlineAt: bounds.deadlineAt } : { packetTimeoutMs: DOWNLOAD_TIMEOUT_MS }),
    })
  } catch (err) {
    onProbeFailure(err)
    const refused = probeLinkRefusal(err)
    if (refused) return { ok: false, ...refused }
    return { ok: false, code: "video_unreadable", message: VIDEO_TO_VIDEO_UNREADABLE_MESSAGE }
  }
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    return { ok: false, code: "video_unreadable", message: VIDEO_TO_VIDEO_UNREADABLE_MESSAGE }
  }
  const length = checkVideoToVideoClipLength(run.provider, seconds, run.videoEditDuration)
  if (!length.ok) return { ok: false, code: length.code, message: length.message }
  const price = videoToVideoClipPrice(run.provider, run.resolution, length.billedSeconds, await liveRowsFor(run))
  return {
    ok: true,
    clipSec: seconds,
    billedSeconds: length.billedSeconds,
    creditId: price.creditId,
    ...(price.units !== undefined ? { units: price.units } : {}),
  }
}

/**
 * BASE credits (pre-markup) of a run charged at a rate: the rate row × the
 * units, rounded up once (`unitRateBaseCredits`, the composition a whole-run
 * quote `<rate>:<N>u` reads too); undefined for a run charged its flat row
 * (`units` absent), which the reservation prices from that row.
 */
export async function videoToVideoClipBaseCredits(creditId: string, units: number | undefined): Promise<number | undefined> {
  if (units === undefined) return undefined
  if (!V2V_CLIP_RATE_IDS.includes(creditId)) throw new Error(`video-to-video: ${creditId} is not a clip rate`)
  return unitRateBaseCredits(creditId, units)
}

/** Payload fields only the stamp may set: dropped from every video-to-video payload first. */
const STAMPED_FIELDS = ["videoDuration", "videoToVideoBilledSeconds", "videoToVideoUnits", "bucketKey"] as const

/**
 * The workflow run's twin of the route's step: for a video-to-video payload on
 * a clip-priced model, writes the resolution as sent (HappyHorse Edit: 720p
 * unless 1080p is named), reads the clip by the same rule, refuses what the
 * route refuses, and stamps what the route records — `videoDuration` (the
 * clip's length as read), `videoToVideoBilledSeconds` (the seconds it is held
 * and charged for), `videoToVideoUnits` (the rate's units, when it is charged
 * at a rate) and `bucketKey` (the row it reserves, see
 * `videoToVideoReserveId`). The caller must run it BEFORE writing input_data:
 * the worker reads the jobs row.
 *
 * The videoUrl must pass the route's own `safeUrlSchema` before anything is
 * probed: raw workflow JSON reaches here without the route's Zod. Undefined
 * (nothing touched beyond the stamped fields) for any other job or model.
 */
export async function stampVideoToVideoClipInput(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "video-to-video") return undefined
  for (const key of STAMPED_FIELDS) delete payload[key]
  const provider = payload.provider
  if (!isClipPricedV2vProvider(provider)) return undefined
  if (provider === "happyhorse-edit") payload.resolution = videoToVideoSentResolution(provider, payload.resolution)
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : ""
  if (!safeUrlSchema.safeParse(videoUrl).success) return { code: "video_unreadable", message: VIDEO_TO_VIDEO_UNREADABLE_MESSAGE }
  const measured = await measureVideoToVideoClip(
    { provider, resolution: payload.resolution, videoEditDuration: payload.videoEditDuration },
    videoUrl,
    (err) => console.warn("[node-executor] video-to-video: ffprobe failed; refusing the run:", err),
  )
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.videoDuration = measured.clipSec
  payload.videoToVideoBilledSeconds = measured.billedSeconds
  if (measured.units !== undefined) payload.videoToVideoUnits = measured.units
  payload.bucketKey = measured.creditId
  return undefined
}

/** The row a stamped clip-priced video-to-video payload reserves; undefined for any other job or model. */
export function videoToVideoReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "video-to-video" && isClipPricedV2vProvider(payload.provider) && typeof payload.bucketKey === "string"
    ? payload.bucketKey
    : undefined
}

/**
 * BASE credits of a stamped video-to-video payload charged at a rate (what the
 * route's guard charges for the same clip); undefined for any other job or
 * model, and for a Wan 2.7 VideoEdit run charged its flat row. A clip-priced
 * run that reached here unread is refused, never priced at a guess.
 */
export async function videoToVideoStampedBaseCredits(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (jobName !== "video-to-video" || !isClipPricedV2vProvider(payload.provider)) return undefined
  const creditId = payload.bucketKey
  if (typeof creditId !== "string" || typeof payload.videoToVideoBilledSeconds !== "number") {
    throw new Error("video-to-video: a clip-priced run reached its reservation without its clip's length")
  }
  const units = payload.videoToVideoUnits
  return videoToVideoClipBaseCredits(creditId, typeof units === "number" && units > 0 ? units : undefined)
}
