import { VIDEO_SFX_PRICING, videoSfxCreditId } from "@nodaro/shared"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"

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
 * A probe that fails (unreachable, unsupported) falls back to 8 seconds rather
 * than refusing the run; a measured length of zero, or one over the
 * 300-second cap, is refused with the route's own error codes.
 */
export type VideoSfxDuration =
  | { readonly ok: true; readonly durationSec: number; readonly creditId: string }
  | {
      readonly ok: false
      readonly code: "invalid_video_duration" | "video_duration_exceeds_limit"
      readonly message: string
    }

export async function measureVideoSfxDuration(
  videoUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
): Promise<VideoSfxDuration> {
  let seconds: number
  try {
    seconds = (await probeVideoSource(videoUrl)).durationSeconds
  } catch (err) {
    onProbeFailure(err)
    seconds = VIDEO_SFX_PRICING.FALLBACK_DURATION_SEC
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
  const measured = await measureVideoSfxDuration(videoUrl, (err) => {
    console.warn("[node-executor] video-sfx: ffprobe failed; falling back to 8s bucket:", err)
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
