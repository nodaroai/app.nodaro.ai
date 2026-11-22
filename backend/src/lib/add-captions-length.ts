/**
 * Add Captions' length limit for a rendered caption (decided 2026-11-22).
 *
 * A caption drawn by the Remotion render (a kinetic style, a styled or timed
 * subtitle, or a transcribed one: `captionRoutesToRemotion`, the predicate its
 * price id follows) costs one flat price, while the render and the
 * transcription grow with the video. So such a run takes a video of at most
 * {@link ADD_CAPTIONS_RENDER_MAX_SEC}, read before anything is held — the
 * route's step inside the credit guard and the workflow run's stamp — and read
 * again by the worker on the file it renders. A longer video, or one whose
 * length cannot be read, is refused with nothing held. The plain-text subtitle
 * burned by FFmpeg is not limited here.
 *
 * CORE, deliberately not `ee/`: input validation runs in every edition.
 */
import { captionRoutesToRemotion } from "@nodaro/shared/captions"
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeClipLengthSec } from "./video-utility-probe.js"

/** The longest video a rendered caption takes, in seconds. */
export const ADD_CAPTIONS_RENDER_MAX_SEC = 300

/** Float noise: a length that is arithmetic can land a hair past the limit, and must not be refused for it. */
const FLOAT_NOISE_SEC = 1e-9

export const ADD_CAPTIONS_UNREADABLE_MESSAGE =
  "Couldn't read the length of the video. Check that the link is a reachable video file in a common format."

/** Whether a video of `seconds` is within the limit (a hair past it forgiven). */
export function captionsRenderLengthFits(seconds: number): boolean {
  return seconds <= ADD_CAPTIONS_RENDER_MAX_SEC + CLIP_PRICE_GRACE_SEC + FLOAT_NOISE_SEC
}

/** The refusal of a video past the limit: how long it is, the limit, and what to do. */
export function captionsTooLongMessage(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  const length = rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`
  return (
    `The video is ${length} long. Add Captions takes videos up to ${ADD_CAPTIONS_RENDER_MAX_SEC / 60} minutes ` +
    "for animated, styled or transcribed captions: trim it first, or burn a plain text subtitle."
  )
}

export type CaptionsLength =
  | { readonly ok: true; readonly videoSec: number }
  | {
      readonly ok: false
      readonly code: "video_too_long" | "video_unreadable" | ProbeLinkRefusalCode
      readonly message: string
    }

/** The fields of a caption request the renderer choice reads (`captionRoutesToRemotion`). */
type CaptionRenderFields = Parameters<typeof captionRoutesToRemotion>[0]

/** Whether a caption request is drawn by the Remotion render, and so limited. */
export function captionsRenderLimited(fields: Readonly<Record<string, unknown>>): boolean {
  return captionRoutesToRemotion(fields as CaptionRenderFields)
}

/**
 * The video's length as the route and the workflow run read it (its
 * container), or why the run is refused. A read that fails refuses the run: a
 * host that could not be looked up for now, or a read that ran out of time, is
 * the retryable 503 every such route answers (`probeLinkRefusal`); a file that
 * cannot be read is a 400.
 */
export async function readCaptionsVideoLength(
  videoUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
  /** A route's deadline for the whole read (its client is waiting); without one the packet scan gets the download bound. */
  bounds: { readonly deadlineAt?: number } = {},
): Promise<CaptionsLength> {
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
    return { ok: false, code: "video_unreadable", message: ADD_CAPTIONS_UNREADABLE_MESSAGE }
  }
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    return { ok: false, code: "video_unreadable", message: ADD_CAPTIONS_UNREADABLE_MESSAGE }
  }
  if (!captionsRenderLengthFits(seconds)) return { ok: false, code: "video_too_long", message: captionsTooLongMessage(seconds) }
  return { ok: true, videoSec: seconds }
}

/**
 * The workflow run's twin of the route's step: for an add-captions payload the
 * Remotion render draws, reads its video by the same rule and refuses what the
 * route refuses. The videoUrl must pass the route's own `safeUrlSchema` first:
 * raw workflow JSON reaches here without the route's Zod. Undefined for any
 * other job, and for a plain-text subtitle.
 */
export async function checkAddCaptionsLength(
  jobName: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "add-captions" || !captionsRenderLimited(payload)) return undefined
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : ""
  if (!safeUrlSchema.safeParse(videoUrl).success) return { code: "video_unreadable", message: ADD_CAPTIONS_UNREADABLE_MESSAGE }
  const read = await readCaptionsVideoLength(videoUrl, (err) => {
    console.warn("[node-executor] add-captions: the video's length could not be read; refusing the run:", err)
  })
  return read.ok ? undefined : { code: read.code, message: read.message }
}
