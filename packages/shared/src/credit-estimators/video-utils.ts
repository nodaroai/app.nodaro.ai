/**
 * Pure credit estimators for video-utility nodes (loop-video, trim-video,
 * combine-videos, assemble-narrated-video). Used by frontend (Run-button
 * display + API call) AND backend (creditGuard reservation, the workflow
 * run's reservation, the workflow estimate) so the displayed cost equals
 * what gets debited.
 *
 * Every estimate counts pricing UNITS and returns units × CREDIT_UNIT base
 * credits: a unit is 5 seconds of output, ~24 frames a smart loop cut
 * searches, each combine input beyond two, and each step of Assemble Narrated
 * Video (3 + 1 per 6 blocks).
 */

export const VIDEO_UTIL_PRICING = {
  /** Base credits per pricing unit. The node's own `model_pricing` row is one unit. */
  CREDIT_UNIT: 10,
  /** Base credits per 5 seconds of output (one unit), ceiling. */
  CREDITS_PER_5_SEC: 10,
  /** Smart-loop-cut work scales at one unit per ~24 frames searched. */
  FRAMES_PER_CREDIT: 24,
  /** Used when an upstream node hasn't produced a measurable duration yet. */
  FALLBACK_DURATION_SECONDS: 8,
} as const

/** Base credits for a count of pricing units, never below one unit. */
function unitsToCredits(units: number): number {
  return VIDEO_UTIL_PRICING.CREDIT_UNIT * Math.max(1, units)
}

export interface LoopVideoEstimatorInput {
  mode?: "repeat" | "duration"
  repeatCount?: number
  targetDuration?: number
  smartLoopCutBeforeRepeat?: boolean
  smartLoopCutLookback?: number
}

export interface TrimVideoEstimatorInput {
  trimMode?: "time" | "seconds" | "keep-first-seconds" | "keep-last-seconds" | "frames" | "smart-loop-cut"
  startTime?: number
  endTime?: number
  /** Seconds-mirror of frames mode: trim N seconds from start AND/OR end. */
  trimStartSeconds?: number
  trimEndSeconds?: number
  /** Keep only the first/last N seconds (probes duration at runtime). */
  keepFirstSeconds?: number
  keepLastSeconds?: number
  trimStartFrames?: number
  trimEndFrames?: number
  smartLoopCutLookback?: number
}

export interface CombineVideosEstimatorInput {
  /** Any id from `COMBINE_TRANSITIONS`. The estimator only branches on
   *  `cut` vs non-cut, so accepting the full string keeps the catalog as
   *  the single source of truth. */
  transition?: string
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

  return unitsToCredits(base + cut)
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
    return unitsToCredits(base + cut)
  }

  if (data.trimMode === "frames") {
    // Source fps unknown frontend-side; assume 24.
    const startSec = (data.trimStartFrames ?? 0) / VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT
    const endSec = (data.trimEndFrames ?? 0) / VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT
    const output = Math.max(0, inputDuration - startSec - endSec)
    return unitsToCredits(Math.ceil(output / 5))
  }

  if (data.trimMode === "seconds") {
    const output = Math.max(0, inputDuration - (data.trimStartSeconds ?? 0) - (data.trimEndSeconds ?? 0))
    return unitsToCredits(Math.ceil(output / 5))
  }

  if (data.trimMode === "keep-first-seconds") {
    const output = Math.min(inputDuration, Math.max(0, data.keepFirstSeconds ?? 0))
    return unitsToCredits(Math.ceil(output / 5))
  }

  if (data.trimMode === "keep-last-seconds") {
    const output = Math.min(inputDuration, Math.max(0, data.keepLastSeconds ?? 0))
    return unitsToCredits(Math.ceil(output / 5))
  }

  // "time" mode (default)
  const output = (data.endTime ?? 0) - (data.startTime ?? 0)
  return unitsToCredits(Math.ceil(output / 5))
}

export function estimateCombineVideosCredits(
  data: CombineVideosEstimatorInput,
  upstreamDurations: ReadonlyArray<number | undefined>,
): number {
  if (upstreamDurations.length === 0) return unitsToCredits(1)

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
  return unitsToCredits(base + inputAdder)
}

export interface LoopTrimEstimatorInput {
  enabled?: boolean
  framesToTest?: number
}

/** Add-on credits charged for the smart-loop-cut post-process applied to an
 *  image-to-video output. Returns 0 when loopTrim is undefined or disabled.
 *  Formula: CREDIT_UNIT × (ceil(duration / 5) + ceil(framesToTest / 24)) —
 *  the same units as Trim Video's smart loop cut, so 8 s at 16 frames → 30. */
export function estimateLoopTrimAddonCredits(
  loopTrim: LoopTrimEstimatorInput | undefined,
  outputDurationSeconds: number,
): number {
  if (!loopTrim?.enabled) return 0
  const frames = Math.max(1, Math.min(loopTrim.framesToTest ?? 16, 64))
  return unitsToCredits(
    Math.ceil(outputDurationSeconds / 5) + Math.ceil(frames / VIDEO_UTIL_PRICING.FRAMES_PER_CREDIT),
  )
}

/** BASE credits for assemble-narrated-video: 3 units flat + 1 per 6
 *  blocks. 6→40, 24→70, 60→130. Single source of truth shared by the backend
 *  route/creditGuard (`backend/src/providers/video/narrated-block-fit.ts`
 *  re-exports this), the workflow run's reservation and the frontend pre-run
 *  estimate (`frontend/src/hooks/use-estimated-credits.ts`). */
export function assembleNarratedVideoCredits(blockCount: number): number {
  return unitsToCredits(3 + Math.ceil(blockCount / 6))
}
