import {
  checkMotionTransferLength,
  motionTransferOrientation,
  motionTransferPrice,
  motionTransferRateOf,
  motionTransferResolution,
} from "@nodaro/shared/credits"
import { MOTION_TRANSFER_PROVIDERS } from "@nodaro/shared/models"
import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeClipLengthSec } from "./video-utility-probe.js"

/**
 * Motion Transfer input gate: measures the DRIVING video before anything is
 * held, refuses one the model cannot take, and prices the run from the
 * measured length (`motionTransferPrice`, @nodaro/shared). A length the
 * caller declares (`videoDuration`) is never read for the price.
 *
 * CORE, deliberately not `ee/` — input validation runs in every edition. One
 * rule for both places a run starts: the route's measuring step (the credit
 * guard's `beforePricing`, so a model the deployment withholds never costs a
 * download and a refusal is a 400 with nothing held) and the workflow run's
 * stamp (before input_data is written or anything is reserved).
 *
 * The length is the container's, read as Video SFX reads a clip
 * (`probeClipLengthSec`). A probe that fails refuses the run, never prices a
 * guess: a host that could not be looked up for now, or a read that ran out of
 * time, is the retryable 503 every measuring route answers
 * (`probeLinkRefusal`); a file that cannot be read is a 400.
 */
export type MotionTransferMeasure =
  | {
      readonly ok: true
      /** The driving video's measured length, in seconds. */
      readonly measuredSec: number
      /** The whole seconds the run is held and charged for. */
      readonly billedSeconds: number
      /** The row the run reserves. */
      readonly creditId: string
      /** Units of that row the run is charged (a per-second rate); undefined for a row charged once. */
      readonly units?: number
    }
  | {
      readonly ok: false
      readonly code: "video_too_short" | "video_too_long" | "video_unreadable" | ProbeLinkRefusalCode
      readonly message: string
    }

export const MOTION_TRANSFER_UNREADABLE_MESSAGE =
  "The motion video could not be read. Check that the link is a reachable video file."

/** What a run is: its model, the size it names and the character's orientation. */
export interface MotionTransferRunShape {
  readonly provider: string
  readonly resolution?: unknown
  readonly characterOrientation?: unknown
}

export async function measureMotionTransferInput(
  run: MotionTransferRunShape,
  videoUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
  /** A route's deadline for the whole measure (its client is waiting); without one the packet scan gets the download bound. */
  bounds: { readonly deadlineAt?: number } = {},
): Promise<MotionTransferMeasure> {
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
    return { ok: false, code: "video_unreadable", message: MOTION_TRANSFER_UNREADABLE_MESSAGE }
  }
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    return { ok: false, code: "video_unreadable", message: MOTION_TRANSFER_UNREADABLE_MESSAGE }
  }
  const length = checkMotionTransferLength(run.provider, run.characterOrientation, seconds)
  if (!length.ok) return { ok: false, code: length.code, message: length.message }
  const price = motionTransferPrice(run.provider, run.resolution, length.billedSeconds)
  return {
    ok: true,
    measuredSec: seconds,
    billedSeconds: length.billedSeconds,
    creditId: price.creditId,
    ...(price.units !== undefined ? { units: price.units } : {}),
  }
}

/**
 * BASE credits (pre-markup) of a run charged at a per-second rate: the rate
 * row × the billed seconds ÷ the seconds the row prices, rounded up once
 * (`unitRateBaseCredits`, the composition a whole-run quote `<rate>:<N>u`
 * reads too); undefined for a run priced by a tier row.
 */
export async function motionTransferRateBaseCredits(
  provider: unknown,
  resolution: unknown,
  billedSeconds: number,
): Promise<number | undefined> {
  const rate = motionTransferRateOf(provider, resolution)
  if (!rate) return undefined
  return unitRateBaseCredits(rate.rateId, billedSeconds / rate.rateSeconds)
}

/** The model a workflow payload runs: its `provider` when it is one, else the default (Kling 2.6). */
function resolvedProvider(provider: unknown): string {
  return typeof provider === "string" && (MOTION_TRANSFER_PROVIDERS as readonly string[]).includes(provider) ? provider : "kling"
}

/** Payload fields only the stamp may set: dropped from every motion-transfer payload first. */
const STAMPED_FIELDS = ["motionTransferBilledSeconds", "bucketKey"] as const

/**
 * The workflow run's twin of the route's measuring step: measures a
 * motion-transfer payload's driving video by the same rule, refuses what the
 * route refuses, and stamps what the route records — `videoDuration` (the
 * length it measured, replacing any length the node carried: a browser's reading,
 * maybe of an older clip, or anything raw workflow JSON says),
 * `motionTransferBilledSeconds` (the seconds it is held and charged for) and
 * `bucketKey` (the row it reserves, see `motionTransferReserveId`). The
 * provider and the orientation are written back as resolved, so the worker
 * runs what was priced. The caller must run it BEFORE writing input_data: the
 * worker reads the jobs row.
 *
 * The videoUrl must pass the route's own `safeUrlSchema` before anything is
 * probed: raw workflow JSON reaches here without the route's Zod. Undefined
 * for any job that is not a motion-transfer run.
 */
export async function stampMotionTransferInput(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "motion-transfer") return undefined
  for (const key of STAMPED_FIELDS) delete payload[key]
  const provider = resolvedProvider(payload.provider)
  payload.provider = provider
  payload.characterOrientation = motionTransferOrientation(payload.characterOrientation)
  payload.resolution = motionTransferResolution(provider, typeof payload.resolution === "string" && payload.resolution !== "" ? payload.resolution : "720p").resolution
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : ""
  if (!safeUrlSchema.safeParse(videoUrl).success) return { code: "video_unreadable", message: MOTION_TRANSFER_UNREADABLE_MESSAGE }
  const measured = await measureMotionTransferInput(
    { provider, resolution: payload.resolution, characterOrientation: payload.characterOrientation },
    videoUrl,
    (err) => console.warn("[node-executor] motion-transfer: ffprobe failed; refusing the run:", err),
  )
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.videoDuration = measured.measuredSec
  payload.motionTransferBilledSeconds = measured.billedSeconds
  payload.bucketKey = measured.creditId
  return undefined
}

/** The row a stamped motion-transfer payload reserves; undefined for any other job. */
export function motionTransferReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "motion-transfer" && typeof payload.bucketKey === "string" ? payload.bucketKey : undefined
}

/**
 * BASE credits of a stamped motion-transfer payload charged at a per-second
 * rate (what the route's guard charges for the same video); undefined for any
 * other job and for a run priced by a tier row. A rate run that reached here
 * unmeasured is refused, never priced at a guess.
 */
export async function motionTransferStampedBaseCredits(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (jobName !== "motion-transfer") return undefined
  if (!motionTransferRateOf(payload.provider, payload.resolution)) return undefined
  const billed = payload.motionTransferBilledSeconds
  if (typeof billed !== "number" || !(billed > 0)) {
    throw new Error("motion-transfer: a per-second-rate run reached its reservation without its measured video")
  }
  return motionTransferRateBaseCredits(payload.provider, payload.resolution, billed)
}
