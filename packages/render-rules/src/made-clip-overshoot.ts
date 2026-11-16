import type { MeasuredFileReading } from "./video-output-length"

/**
 * How far past its planned length a file a node makes in a run can run, by
 * what a measuring step's run reads of it (production, read-only measurement
 * of made clips):
 * - its CONTAINER (ffprobe's format duration, an audio tail included): up to
 *   0.104 s past the length it was asked for (a Seedance 2 Mini clip), taken
 *   as 0.15 s, the allowance Trim, Loop and Combine Videos already take
 *   (`VIDEO_UTILITY_PRICE_GRACE_SEC`);
 * - its VIDEO STREAM: one 24 fps frame (every generation measured at most
 *   +0.042 s, that frame at three decimals).
 *
 * The bound every measuring step's quote is held to: its planned-clip slack,
 * plus what its charge forgives past a mark, less what its quote forgives,
 * covers this on the reading its run measures (`MEASURING_STEP_ALLOWANCES`,
 * held by the overshoot guard). A Dubbing, an Audio Isolation and a PixVerse
 * V6 extension run further; their rows declare their own overshoot
 * (`LONG_OVERSHOOT_PLANNED_CLIP_SLACK_SEC`), which the measured walk reads in
 * place of the step's slack.
 */
export const MADE_CLIP_OVERSHOOT_SEC: Readonly<Record<MeasuredFileReading, number>> = {
  "container": 0.15,
  "video-stream": 1 / 24,
}

/**
 * What a step whose run measures a clip's VIDEO STREAM takes off when it can
 * only measure the clip's CONTAINER — after the stream's own length, its
 * `DURATION` tag (Matroska / WebM) and its packets have all been tried: the
 * whole of how far a made clip's container can run past its picture
 * ({@link MADE_CLIP_OVERSHOOT_SEC}). One allowance for Topaz and Nodaro Video
 * Upscale, Video Overlay and Combine Videos, so the quote's one frame of slack
 * still covers the length the run measures.
 */
export const CONTAINER_FALLBACK_GRACE_SEC = MADE_CLIP_OVERSHOOT_SEC.container

/** A measured length as a video-stream step prices it: the stream's as read; the container's (its fallback) less {@link CONTAINER_FALLBACK_GRACE_SEC}, never below 0. */
export function containerFallbackPricedSec(measuredSec: number, reading: MeasuredFileReading): number {
  return reading === "container" ? Math.max(0, measuredSec - CONTAINER_FALLBACK_GRACE_SEC) : measuredSec
}
