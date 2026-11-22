/**
 * Face Swap's input gate and charge (decided 2026-11-22).
 *
 * The target video's length is read before anything is held, and a video past
 * {@link FACE_SWAP_MAX_SEC} (a hair past it forgiven) is refused with nothing
 * held, as is one whose length cannot be read. One rule for the route's step
 * inside the credit guard and the workflow run's stamp. CORE, deliberately not
 * `ee/`: input validation runs in every edition.
 *
 * The charge follows the run: Replicate bills Face Swap by the GPU time of the
 * prediction, which grows with the video. A run is held at its row, which is
 * also the least it is charged; when Replicate billed more for the run than
 * the row covers, the run is charged what it cost, marked up once, collected
 * above the hold (`faceSwapSettle`, read by the worker and the reconcile lane).
 */
import { usdToCredits } from "@nodaro/shared/credits"
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"
import { baseCreditCostFor } from "./credit-base-cost.js"
import { hasCredits } from "./config.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeClipLengthSec } from "./video-utility-probe.js"

/** The row a Face Swap run reserves: the least it is charged, and the price shown before the run. */
export const FACE_SWAP_CREDIT_ID = "roop-face-swap"

/** The longest target video a run takes, in seconds. */
export const FACE_SWAP_MAX_SEC = 60

/** Float noise: a length that is arithmetic can land a hair past the limit, and must not be refused for it. */
const FLOAT_NOISE_SEC = 1e-9

export const FACE_SWAP_UNREADABLE_MESSAGE =
  "Couldn't read the length of the video. Check that the link is a reachable video file in a common format."

/** The refusal of a video past the limit: how long it is, the limit, and what to do. */
export function faceSwapTooLongMessage(seconds: number): string {
  return `The video is ${Math.ceil(seconds)} seconds long. Face Swap takes videos up to ${FACE_SWAP_MAX_SEC} seconds: trim it first.`
}

export type FaceSwapInput =
  | { readonly ok: true; readonly clipSec: number }
  | {
      readonly ok: false
      readonly code: "video_too_long" | "video_unreadable" | ProbeLinkRefusalCode
      readonly message: string
    }

/** Whether a video of `seconds` is within the limit (a hair past it forgiven). */
export function faceSwapLengthFits(seconds: number): boolean {
  return seconds <= FACE_SWAP_MAX_SEC + CLIP_PRICE_GRACE_SEC + FLOAT_NOISE_SEC
}

/**
 * The target video's length as the route and the workflow run read it (its
 * container, as Video to Video reads its clip), or why the run is refused. A
 * read that fails refuses the run, never guesses: a host that could not be
 * looked up for now, or a read that ran out of time, is the retryable 503
 * every such route answers (`probeLinkRefusal`); a file that cannot be read is
 * a 400.
 */
export async function readFaceSwapInput(
  videoUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
  /** A route's deadline for the whole read (its client is waiting); without one the packet scan gets the download bound. */
  bounds: { readonly deadlineAt?: number } = {},
): Promise<FaceSwapInput> {
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
    return { ok: false, code: "video_unreadable", message: FACE_SWAP_UNREADABLE_MESSAGE }
  }
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    return { ok: false, code: "video_unreadable", message: FACE_SWAP_UNREADABLE_MESSAGE }
  }
  if (!faceSwapLengthFits(seconds)) return { ok: false, code: "video_too_long", message: faceSwapTooLongMessage(seconds) }
  return { ok: true, clipSec: seconds }
}

/** Payload fields only the stamp may set: dropped from every face-swap payload first. */
const STAMPED_FIELDS = ["faceSwapVideoSec"] as const

/**
 * The workflow run's twin of the route's step: reads a face-swap payload's
 * video by the same rule, refuses what the route refuses, and stamps the
 * length read (`faceSwapVideoSec`) for the job's record. The caller must run
 * it BEFORE writing input_data. The videoUrl must pass the route's own
 * `safeUrlSchema` first: raw workflow JSON reaches here without the route's
 * Zod. Undefined for any other job.
 */
export async function stampFaceSwapInput(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "face-swap") return undefined
  for (const key of STAMPED_FIELDS) delete payload[key]
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : ""
  if (!safeUrlSchema.safeParse(videoUrl).success) return { code: "video_unreadable", message: FACE_SWAP_UNREADABLE_MESSAGE }
  const read = await readFaceSwapInput(videoUrl, (err) => {
    console.warn("[node-executor] face-swap: the video's length could not be read; refusing the run:", err)
  })
  if (!read.ok) return { code: read.code, message: read.message }
  payload.faceSwapVideoSec = read.clipSec
  return undefined
}

/**
 * The settle fields a finished Face Swap run gives finalize: none when what
 * Replicate billed (`cost`, USD) is within the row (the hold is committed as
 * it is), else a metered settle collected above the hold. The row is read live
 * (`model_pricing`, else the static table), so an administrator's retune moves
 * where the run cost takes over.
 */
export async function faceSwapSettle(
  cost: number | null | undefined,
): Promise<{ readonly meteredCost: true; readonly collectOverHold: true } | Record<string, never>> {
  // Where credits are off nothing is settled, so there is nothing to choose.
  if (!hasCredits() || typeof cost !== "number" || !(cost > 0) || !Number.isFinite(cost)) return {}
  const row = await baseCreditCostFor(FACE_SWAP_CREDIT_ID)
  return usdToCredits(cost) > row ? { meteredCost: true, collectOverHold: true } : {}
}
