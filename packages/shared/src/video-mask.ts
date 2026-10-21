/**
 * Video Mask — text-prompted video segmentation (SAM 3.1 / SAM 3). The wire contract of
 * the `video-mask` node, `POST /v1/video-mask`, the `video_mask` MCP verb,
 * `client.media.videoMask` and `nodaro media video-mask`, defined ONCE:
 *   - every bound the route schema, the node panel and the MCP verb read;
 *   - `videoMaskBilledSeconds`: the length a run is priced at — the clip's
 *     length at the 30 fps basis, so a 60 fps clip is priced at twice its
 *     length (the segmentation works per FRAME);
 *   - `videoMaskCreditId`: which price row (`model_pricing`) that length is
 *     charged from. The credit amounts live in the rows, never here.
 *
 * Worked examples (repeated in docs/nodes/ai-video/video-mask.md):
 *   4 s at 30 fps → `sam-3.1-video:5s`,  12 s at 24 fps → `sam-3.1-video:15s`,
 *   10 s at 60 fps (priced as 20 s) → `sam-3.1-video:30s`,  45 s at 30 fps → `sam-3.1-video:60s`,
 *   100 s at 30 fps → `sam-3.1-video:120s`,  4 min at 30 fps on SAM 3 → `sam-3-video:240s`.
 *
 * Wire contract only — no I/O.
 */

/** Segmentation models a Video Mask run can use. SAM 3.1 (the default)
 *  tracks several objects in one pass and runs faster; SAM 3 costs half. */
export const VIDEO_MASK_PROVIDERS = ["sam-3.1", "sam-3"] as const
export type VideoMaskProvider = (typeof VIDEO_MASK_PROVIDERS)[number]
export const DEFAULT_VIDEO_MASK_PROVIDER: VideoMaskProvider = "sam-3.1"

/** A new Video Mask node's settings — spread into its node definition. */
export const VIDEO_MASK_DEFAULTS = {
  threshold: 0.5,
  provider: "sam-3.1" as VideoMaskProvider,
  /** Off: the mask is the model's, frame for frame (see `HOLD_EMPTY_BELOW_FRACTION`). */
  holdLastMask: false,
  /** 0 = off: every region the model finds is kept (see `MIN_SUBJECT_HEIGHT_PCT_*`). */
  minSubjectHeightPct: 0,
  /** 0 = off: no ceiling on a region's height (see `MAX_SUBJECT_HEIGHT_PCT_*`). */
  maxSubjectHeightPct: 0,
} as const

export const VIDEO_MASK_LIMITS = {
  /** The longest input clip a run accepts, in seconds of PRICED length (see `videoMaskBilledSeconds`). */
  MAX_BILLED_SEC: 300,
  /** Frame rate the price rows assume. A faster clip is priced proportionally longer. */
  FPS_BASIS: 30,
  /** Subject description length cap. */
  PROMPT_MAX_LENGTH: 500,
  /** Detection confidence bounds (the model's own range, narrowed to useful values). */
  THRESHOLD_MIN: 0.05,
  THRESHOLD_MAX: 0.95,
  THRESHOLD_STEP: 0.05,
  /** Default detection confidence. Lower finds more (and less precise) regions. */
  THRESHOLD_DEFAULT: VIDEO_MASK_DEFAULTS.threshold,
  /**
   * `holdLastMask`: a frame whose mask covers less than this fraction of the
   * picture (0.002 % — about 41 px at 1080p: a stray speck, never a subject) counts as empty — the subject lost (hidden behind a
   * hand, turned away) — and shows the most recent non-empty frame's mask
   * instead. Frames before the first detection stay as they are.
   */
  HOLD_EMPTY_BELOW_FRACTION: 0.00002,
  /**
   * `minSubjectHeightPct`: drop every connected white region (8-connected)
   * whose bounding box is shorter than this % of the frame height — extras'
   * small faces behind the main subject. 0 = off. Applied before
   * `holdLastMask`, so a frame left with only small regions counts as empty
   * and is held from the last frame with a big subject.
   */
  MIN_SUBJECT_HEIGHT_PCT_MIN: 0,
  MIN_SUBJECT_HEIGHT_PCT_MAX: 100,
  /**
   * `maxSubjectHeightPct`, the mirror: drop every region whose bounding box is
   * TALLER than this % of the frame height (keep only the small subjects — a
   * paste-back mask of the background faces). 0 = off. With both set, a
   * region is kept when min ≤ height ≤ max (min > max is refused). Same pass,
   * same order (before `holdLastMask`).
   */
  MAX_SUBJECT_HEIGHT_PCT_MIN: 0,
  MAX_SUBJECT_HEIGHT_PCT_MAX: 100,
} as const

const VIDEO_MASK_BUCKETS_SEC = [5, 10, 15, 30, 60, 90, 120, 180, 240, 300] as const

/** Every price row a provider can be charged from, smallest first. */
export function videoMaskCreditIds(provider: VideoMaskProvider = DEFAULT_VIDEO_MASK_PROVIDER): string[] {
  return VIDEO_MASK_BUCKETS_SEC.map((sec) => `${provider}-video:${sec}s`)
}

/**
 * The length a clip is priced at: its duration at the 30 fps basis. A clip
 * at or under 30 fps is priced at its own length; a 60 fps clip at twice it.
 * An unknown frame rate counts as the basis.
 */
export function videoMaskBilledSeconds(durationSec: number, fps?: number | null): number {
  const rate = typeof fps === "number" && Number.isFinite(fps) && fps > 0 ? fps : VIDEO_MASK_LIMITS.FPS_BASIS
  return durationSec * Math.max(1, rate / VIDEO_MASK_LIMITS.FPS_BASIS)
}

/**
 * The price row for a clip priced at `billedSec` seconds. An unknown or
 * non-positive length prices the LONGEST row (a clip the route could not
 * measure is refused, so this is only the pre-run quote for a clip whose
 * length is not known yet); anything past the cap prices the last row.
 */
export function videoMaskCreditId(
  billedSec: number | null | undefined,
  provider: VideoMaskProvider = DEFAULT_VIDEO_MASK_PROVIDER,
): string {
  const ids = videoMaskCreditIds(provider)
  if (typeof billedSec !== "number" || !Number.isFinite(billedSec) || billedSec <= 0) return ids[ids.length - 1]!
  const i = VIDEO_MASK_BUCKETS_SEC.findIndex((b) => billedSec <= b)
  return ids[i === -1 ? ids.length - 1 : i]!
}

/** Narrow an arbitrary value to a known provider, falling back to the default. */
export function resolveVideoMaskProvider(value: unknown): VideoMaskProvider {
  return (VIDEO_MASK_PROVIDERS as readonly string[]).includes(value as string)
    ? (value as VideoMaskProvider)
    : DEFAULT_VIDEO_MASK_PROVIDER
}

/** `POST /v1/video-mask` request body. */
export interface VideoMaskRequest {
  /** The clip to segment. */
  readonly videoUrl: string
  /** What to track: a short noun phrase; separate several with commas. */
  readonly prompt: string
  /** Detection confidence, `VIDEO_MASK_LIMITS.THRESHOLD_MIN`–`THRESHOLD_MAX` (default 0.5). */
  readonly threshold?: number
  readonly provider?: VideoMaskProvider
  /** Hold the last mask where the subject is lost (default false): an empty frame
   *  after the first detection repeats the most recent non-empty one. */
  readonly holdLastMask?: boolean
  /** Ignore subjects smaller than this % of the frame height, 0–100 (default 0 = off):
   *  connected regions whose bounding box is shorter are dropped from every frame. */
  readonly minSubjectHeightPct?: number
  /** Ignore subjects larger than this % of the frame height, 0–100 (default 0 = off):
   *  connected regions whose bounding box is taller are dropped from every frame. */
  readonly maxSubjectHeightPct?: number
}
