import { VIDEO_SFX_PRICING, videoSfxCreditId } from "@nodaro/shared/credits"
import { DOWNLOAD_TIMEOUT_MS } from "../providers/video/ffmpeg-timeouts.js"
import { PRE_CHARGE_PROBE_TIMEOUT_MS } from "./pre-charge-probe-bounds.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeClipLengthSec } from "./video-utility-probe.js"
import { probeLinkRefusal, type ProbeLinkRefusalCode } from "../providers/video/probe-guard.js"

/**
 * Video SFX: how long the input video is, and so which price row a run is
 * charged from and how many seconds of sound the model is asked for.
 *
 * One rule for both places a run starts — the route's preHandler
 * (`POST /v1/video-sfx`) and the workflow run (node-executor) — so a clip
 * costs the same, and is scored for the same length, wherever it runs. Before
 * the workflow run measured the clip it reserved the 8-second price for every
 * length and sent no length at all, so the model scored only its default
 * 8 seconds of a longer clip.
 *
 * The length is the container's, read the way Trim, Loop and Combine Videos
 * read a clip (`probeClipLengthSec`): from the header, and for a file whose
 * header carries no length (a WebM a browser recorded) from the end of its
 * last video packet, streamed — a route within its deadline, the workflow run
 * within the render's own download bound.
 *
 * A probe that fails refuses the run before anything is charged, never prices
 * a fallback length (an 8-second guess under-priced every longer clip): a host
 * that could not be looked up for now, or a read that ran out of time, is the
 * retryable 503 every measuring route answers (`probeLinkRefusal`); a link that
 * is not an ordinary media file, or a file that cannot be read, is a 400. A
 * measured length of zero, or one over the 300-second cap, is refused with the
 * route's own error codes.
 */
export type VideoSfxDuration =
  | { readonly ok: true; readonly durationSec: number; readonly creditId: string }
  | {
      readonly ok: false
      readonly code: "invalid_video_duration" | "video_duration_exceeds_limit" | ProbeLinkRefusalCode
      readonly message: string
    }

export async function measureVideoSfxDuration(
  videoUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
  /** A route's deadline for the whole measure (its client is waiting); without one the packet scan gets the download bound. */
  bounds: { readonly deadlineAt?: number } = {},
): Promise<VideoSfxDuration> {
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
    return {
      ok: false,
      code: "invalid_video_duration",
      message: "Could not read the video. The file may be corrupted or an unsupported format.",
    }
  }
  if (!(seconds > 0)) {
    return {
      ok: false,
      code: "invalid_video_duration",
      message: "Video has no detectable duration. The file may be corrupted or an unsupported format.",
    }
  }
  if (seconds > VIDEO_SFX_PRICING.MAX_DURATION_SEC) {
    return {
      ok: false,
      code: "video_duration_exceeds_limit",
      message:
        `Video is ${Math.ceil(seconds)} seconds. Maximum duration is ` +
        `${VIDEO_SFX_PRICING.MAX_DURATION_SEC} seconds (5 minutes) for SFX generation.`,
    }
  }
  const durationSec = Math.ceil(seconds)
  return { ok: true, durationSec, creditId: videoSfxCreditId(durationSec) }
}

/**
 * The workflow run's twin of the route's preHandler: measures a video-sfx
 * payload's clip and stamps the two fields the route writes into each job's
 * input_data — `duration_seconds` (what the worker asks the model to score)
 * and `bucketKey` (the price row the run reserves, see `videoSfxReserveId`).
 * The caller must run it BEFORE writing input_data, because the worker reads
 * the jobs row, never the queue payload.
 *
 * Returns the route's refusal for a clip it would refuse (no length, over the
 * cap); undefined otherwise, and for any job that is not a video-sfx run,
 * whose payload is left untouched.
 */
export async function stampVideoSfxDuration(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "video-sfx") return undefined
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : ""
  // Raw workflow JSON reaches here without the route's Zod: only an http(s) link to a public host is probed.
  if (!safeUrlSchema.safeParse(videoUrl).success) {
    return { code: "invalid_video_duration", message: "Could not read the video. The file may be corrupted or an unsupported format." }
  }
  const measured = await measureVideoSfxDuration(videoUrl, (err) => {
    console.warn("[node-executor] video-sfx: ffprobe failed; refusing the run:", err)
  })
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.duration_seconds = measured.durationSec
  payload.bucketKey = measured.creditId
  return undefined
}

/** The price row a stamped video-sfx payload reserves; undefined for any other job. */
export function videoSfxReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "video-sfx" && typeof payload.bucketKey === "string" ? payload.bucketKey : undefined
}
