import {
  VIDEO_MASK_LIMITS,
  resolveVideoMaskProvider,
  videoMaskBilledSeconds,
  videoMaskCreditId,
} from "@nodaro/shared/media"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"

/**
 * Video Mask: how long the input clip is priced at, and so which price row a
 * run is charged from. One rule for both places a run starts — the route's
 * preHandler (`POST /v1/video-mask`) and the workflow run (node-executor) — so
 * a clip costs the same wherever it runs.
 *
 * Unlike Video SFX, a clip that cannot be measured is REFUSED: the worker must
 * decode it frame by frame to draw the mask, so a clip ffprobe cannot read
 * would fail there anyway, after the reservation.
 */
export type VideoMaskLength =
  | { readonly ok: true; readonly billedSec: number; readonly creditId: string }
  | {
      readonly ok: false
      readonly code: "invalid_video_duration" | "video_duration_exceeds_limit"
      readonly message: string
    }

export async function measureVideoMaskLength(videoUrl: string, provider?: unknown): Promise<VideoMaskLength> {
  let probed: { durationSeconds: number; fps?: number }
  try {
    probed = await probeVideoSource(videoUrl)
  } catch {
    return {
      ok: false,
      code: "invalid_video_duration",
      message: "Could not read the video. The file may be corrupted or an unsupported format.",
    }
  }
  const billed = videoMaskBilledSeconds(probed.durationSeconds, probed.fps)
  if (billed > VIDEO_MASK_LIMITS.MAX_BILLED_SEC) {
    const fast = (probed.fps ?? 0) > VIDEO_MASK_LIMITS.FPS_BASIS
    return {
      ok: false,
      code: "video_duration_exceeds_limit",
      message:
        `The video is ${Math.ceil(probed.durationSeconds)} seconds${fast ? ` at ${Math.round(probed.fps!)} fps (priced as ${Math.ceil(billed)} s)` : ""}. ` +
        `Video Mask takes up to ${VIDEO_MASK_LIMITS.MAX_BILLED_SEC} seconds at ${VIDEO_MASK_LIMITS.FPS_BASIS} fps — trim it first.`,
    }
  }
  const billedSec = Math.ceil(billed)
  return { ok: true, billedSec, creditId: videoMaskCreditId(billedSec, resolveVideoMaskProvider(provider)) }
}

/**
 * The workflow run's twin of the route's preHandler: measures a video-mask
 * payload's clip and stamps `bucketKey` (the price row the run reserves, see
 * `videoMaskReserveId`). Run BEFORE writing input_data. Returns the route's
 * refusal for a clip it would refuse; undefined otherwise, and for any job that
 * is not a video-mask run, whose payload is left untouched.
 */
export async function stampVideoMaskLength(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "video-mask") return undefined
  const videoUrl = typeof payload.videoUrl === "string" ? payload.videoUrl : ""
  const measured = await measureVideoMaskLength(videoUrl, payload.provider)
  if (!measured.ok) return { code: measured.code, message: measured.message }
  payload.billedSec = measured.billedSec
  payload.bucketKey = measured.creditId
  return undefined
}

/** The price row a stamped video-mask payload reserves; undefined for any other job. */
export function videoMaskReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return jobName === "video-mask" && typeof payload.bucketKey === "string" ? payload.bucketKey : undefined
}
