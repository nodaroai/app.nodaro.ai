/**
 * Pure credit estimators for video-utility nodes (loop-video, trim-video,
 * combine-videos). Used by frontend (Run-button display + API call) AND
 * backend (creditGuard reservation) so the displayed cost equals what gets
 ***REDACTED-OSS-SCRUB***
 */

export const VIDEO_UTIL_PRICING = {
  /** 1 credit per 5 seconds of output, ceiling. */
  CREDITS_PER_5_SEC: 1,
  /** Smart-loop-cut work scales at 1 credit per ~24 frames searched. */
  FRAMES_PER_CREDIT: 24,
  /** Used when an upstream node hasn't produced a measurable duration yet. */
  FALLBACK_DURATION_SECONDS: 8,
} as const

export interface LoopVideoEstimatorInput {
  mode?: "repeat" | "duration"
  repeatCount?: number
  targetDuration?: number
  smartLoopCutBeforeRepeat?: boolean
  smartLoopCutLookback?: number
}

export interface TrimVideoEstimatorInput {
  trimMode?: "time" | "frames" | "smart-loop-cut"
  startTime?: number
  endTime?: number
  trimStartFrames?: number
  trimEndFrames?: number
  smartLoopCutLookback?: number
}

export interface CombineVideosEstimatorInput {
  transition?: "cut" | "fade" | "dissolve" | "dip-to-black" | "dip-to-white"
  transitionDuration?: number
  trimStartFrames?: number
  trimEndFrames?: number
}

export function estimateLoopVideoCredits(
  data: LoopVideoEstimatorInput,
  upstreamDuration?: number,
): number {
  const fallback = VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS
  const inputDuration = upstreamDuration ?? fallback

  const output =
    data.mode === "duration"
      ? (data.targetDuration ?? fallback)
      : (data.repeatCount ?? 2) * inputDuration

  const base = Math.ceil(output / 5)
  const cut = data.smartLoopCutBeforeRepeat
    ? Math.ceil((data.smartLoopCutLookback ?? 16) / VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT)
    : 0

  return Math.max(1, base + cut)
}

export function estimateTrimVideoCredits(
  data: TrimVideoEstimatorInput,
  upstreamDuration?: number,
): number {
  const fallback = VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS
  const inputDuration = upstreamDuration ?? fallback

  if (data.trimMode === "smart-loop-cut") {
    const base = Math.ceil(inputDuration / 5)
    const cut = Math.ceil((data.smartLoopCutLookback ?? 16) / VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT)
    return Math.max(1, base + cut)
  }

  if (data.trimMode === "frames") {
    // Source fps unknown frontend-side; assume 24.
    const startSec = (data.trimStartFrames ?? 0) / VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT
    const endSec = (data.trimEndFrames ?? 0) / VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT
    const output = Math.max(0, inputDuration - startSec - endSec)
    return Math.max(1, Math.ceil(output / 5))
  }

  // "time" mode (default)
  const output = (data.endTime ?? 0) - (data.startTime ?? 0)
  return Math.max(1, Math.ceil(output / 5))
}

export function estimateCombineVideosCredits(
  data: CombineVideosEstimatorInput,
  upstreamDurations: ReadonlyArray<number | undefined>,
): number {
  if (upstreamDurations.length === 0) return 1

  const fallback = VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS
  const n = upstreamDurations.length

  let total = 0
  for (const d of upstreamDurations) {
    total += typeof d === "number" && Number.isFinite(d) && d >= 0 ? d : fallback
  }

  if (data.transition && data.transition !== "cut" && n > 1) {
    total -= (data.transitionDuration ?? 0.5) * (n - 1)
  }

  const trimSecPerClip =
    ((data.trimStartFrames ?? 0) + (data.trimEndFrames ?? 0)) /
    VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT
  total -= trimSecPerClip * n

  const base = Math.ceil(Math.max(0, total) / 5)
  const inputAdder = Math.max(0, n - 2)
  return Math.max(1, base + inputAdder)
}

export interface LoopTrimEstimatorInput {
  enabled?: boolean
  framesToTest?: number
}

/** Add-on credits charged for the smart-loop-cut post-process applied to an
 *  image-to-video output. Returns 0 when loopTrim is undefined or disabled.
 *  Formula: ceil(duration / 5) + ceil(framesToTest / 24) — matches the
 *  trim-video smart-loop-cut formula for consistency. */
export function estimateLoopTrimAddonCredits(
  loopTrim: LoopTrimEstimatorInput | undefined,
  outputDurationSeconds: number,
): number {
  if (!loopTrim?.enabled) return 0
  const frames = Math.max(1, Math.min(loopTrim.framesToTest ?? 16, 64))
  return Math.ceil(outputDurationSeconds / 5) +
         Math.ceil(frames / VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT)
}
