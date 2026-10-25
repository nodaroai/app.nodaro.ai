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

/**
 * `zone`: keep only the subjects whose bounding-box CENTRE lies inside an
 * inner rectangle, given as margins in % of the frame (each
 * `VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MIN`–`ZONE_MARGIN_PCT_MAX`). All zero, or
 * no zone, = off.
 */
export interface VideoMaskZone {
  readonly leftPct: number
  readonly rightPct: number
  readonly topPct: number
  readonly bottomPct: number
}

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
  /** Off: subjects anywhere in the frame are kept (see `ZONE_MARGIN_PCT_*`). */
  zone: null as VideoMaskZone | null,
  /**
   * Off: one pass over the whole clip. On: the clip's scene cuts are found
   * first and each shot is segmented on its own — the model starts afresh
   * after every cut (finding the new shot's subjects), and `holdLastMask`
   * never carries a mask across a cut. A clip with no cut (a flash is
   * usually not one) is one shot: the same mask, fitted to the clip's exact
   * frame count.
   */
  perShot: false,
  /**
   * 0 = off: a new detection only where a request starts anyway (the clip's
   * start, every 1,800 frames, and every cut with `perShot`). Above 0: the
   * model is also sent a new request every this many seconds of footage, so a
   * subject that first appears mid-shot is found within that time (see
   * `REDETECT_EVERY_SEC_*`). These boundaries are not cuts: `holdLastMask`
   * keeps holding across them.
   */
  redetectEverySec: 0,
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
   * `holdLastMask`: the longest a mask is held, in seconds of frames (at the
   * clip's rate). The hold is for a subject hidden for a moment; a run of
   * empty frames longer than this shows the held mask for its first second
   * and then nothing, until the model finds the subject again — a mask held
   * on for longer sits where the subject no longer is.
   */
  HOLD_MAX_SEC: 1,
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
  /**
   * `zone` margins (left / right / top / bottom, % of the frame width or
   * height): drop every connected region whose bounding-box centre lies
   * outside `[w·left/100, w·(1−right/100)] × [h·top/100, h·(1−bottom/100)]`
   * — the faces at the edges of the picture. At most 49 % a side, so the
   * inner rectangle is never empty. Applied after the size cut and before
   * `holdLastMask`, so a frame left with nothing inside counts as empty.
   */
  ZONE_MARGIN_PCT_MIN: 0,
  ZONE_MARGIN_PCT_MAX: 49,
  /**
   * `redetectEverySec`: 0 (off) or `REDETECT_EVERY_SEC_MIN`–`MAX` seconds. The
   * model picks up its subjects near the start of each request; a face that
   * turns to the camera, or a person who walks in, partway through a request is
   * never masked. On, the clip (each shot, with `perShot`) is cut into requests
   * of at most this many seconds of frames — counted from the shot's start, a
   * last piece shorter than `VIDEO_MASK_MIN_SHOT_FRAMES` joining the one before
   * — so the subjects are detected again at every such boundary. Each request
   * adds wall time (they run three at a time); the price follows the clip's
   * length and does not change.
   */
  REDETECT_EVERY_SEC_MIN: 1,
  REDETECT_EVERY_SEC_MAX: 10,
  /** The panel's step (the API takes any value in range). */
  REDETECT_EVERY_SEC_STEP: 1,
} as const

/**
 * The version of what a Video Mask run's mask looks like for a given clip and
 * settings: every finished `video-mask` job reports it as `output_data.recipe`.
 * A mask stored ahead of time and reused (a trend's approved face mask) is
 * held to it, and reads as out of date once it changes.
 *
 * BUMP IT (to the date of the change) whenever the algorithm changes the mask
 * a run produces from the same clip and settings: the cut rule (`perShot`),
 * the hold (`holdLastMask`, `HOLD_*`), the size and zone filters, the
 * rendering. Never for a change that leaves every mask the same (pricing,
 * limits on what is accepted, messages). `"2026-10-25"`: the lone-spike cut
 * rule and the 1 s hold cap.
 */
export const VIDEO_MASK_RECIPE = "2026-10-25"

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

/**
 * A zone as the region filter reads it: each margin a finite number clamped
 * to `ZONE_MARGIN_PCT_MIN`–`ZONE_MARGIN_PCT_MAX` (anything else is 0), and
 * null when there is no zone or every margin is 0 (off). The one reading
 * shared by the worker, a workflow run's payload and the node's own run.
 */
export function resolveVideoMaskZone(value: unknown): VideoMaskZone | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const margin = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x)
      ? Math.min(VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MAX, Math.max(VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MIN, x))
      : 0
  const zone = { leftPct: margin(v.leftPct), rightPct: margin(v.rightPct), topPct: margin(v.topPct), bottomPct: margin(v.bottomPct) }
  return zone.leftPct > 0 || zone.rightPct > 0 || zone.topPct > 0 || zone.bottomPct > 0 ? zone : null
}

/**
 * `redetectEverySec` as a run reads it: a finite number above 0 clamped to
 * `REDETECT_EVERY_SEC_MIN`–`MAX` (a value between 0 and the minimum snaps up
 * to it — it asked for re-detection); anything else (absent, 0, negative,
 * not a number) is 0 = off. The one reading shared by the worker, a workflow
 * run's payload, the node's own run and its panel (the route refuses a value
 * out of range instead).
 */
export function resolveVideoMaskRedetectSec(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(VIDEO_MASK_LIMITS.REDETECT_EVERY_SEC_MAX, Math.max(VIDEO_MASK_LIMITS.REDETECT_EVERY_SEC_MIN, value))
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
  /** Keep only the subjects whose bounding-box centre is inside these margins, each
   *  0–49 % of the frame (a margin left out is 0). null / omitted / all 0 = off. */
  readonly zone?: Partial<VideoMaskZone> | null
  /** Segment each shot on its own (default false): the clip's scene cuts are found
   *  first and the subjects are detected again in every shot; `holdLastMask` never
   *  carries a mask across a cut. The output then carries `shots`. */
  readonly perShot?: boolean
  /** Detect the subjects again every this many seconds (0 = off, the default, or
   *  `VIDEO_MASK_LIMITS.REDETECT_EVERY_SEC_MIN`–`MAX`): the clip — each shot, with
   *  `perShot` — is sent to the model in pieces of at most that length, so a subject
   *  that first appears mid-shot is masked from the next boundary on. Not a cut:
   *  `holdLastMask` holds across these boundaries. Slower (more requests); same price. */
  readonly redetectEverySec?: number
}
