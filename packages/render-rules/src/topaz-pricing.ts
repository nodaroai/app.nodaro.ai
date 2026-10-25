/**
 * How a Topaz upscale is priced (decided 2026-10-25). Both upscalers run in
 * Topaz units; one unit is priced by its own `model_pricing` row, so an
 * administrator's retune moves the hold, the quote and the charge together.
 *
 * VIDEO — metered. The units a run uses follow the OUTPUT gigapixels it
 * renders (width × height × frames), with a small minimum per run and extra
 * for the frames it interpolates, and which of its models Topaz picks is its
 * own choice. No fixed table tracks them (2026-10-25: 5 s 720p → 4K60 used 19
 * units, 34 s 1080p → 1080p30 used 6). So a run HOLDS a ceiling read from its
 * output gigapixels and is CHARGED the units it used, never above the hold;
 * the rest is refunded at completion.
 *
 * IMAGE — fixed, by output size. An image uses units by its output megapixels,
 * in published steps; a run is charged its factor's tier price or the per-unit
 * price × the size's units, whichever is higher, so an ordinary image costs
 * what it always did and a very large one costs by its size.
 */
import {
  TOPAZ_VIDEO_DEFAULT_RESOLUTION,
  TOPAZ_VIDEO_FALLBACK_FPS,
  topazVideoOutputSize,
  type TopazVideoResolution,
  type TopazVideoSource,
} from "@nodaro/shared/models"

// ─── Video ───────────────────────────────────────────────────────────────

/** The price row of ONE Topaz video unit — the hold and the charge are multiples of it. */
export const TOPAZ_VIDEO_UNIT_CREDIT_ID = "topaz-video:per-unit"

/** Hold units per output gigapixel: above every rate measured (worst 9.5, a 5 s 1080p60 clip). */
export const TOPAZ_VIDEO_HOLD_UNITS_PER_GIGAPIXEL = 10

/** The fewest units a hold covers: the smallest run measured took 2, most short runs 3. */
export const TOPAZ_VIDEO_MIN_HOLD_UNITS = 3

/**
 * The largest output a run accepts, in gigapixels (decided 2026-10-25). Topaz
 * spends ~110–130 s per output gigapixel (measured), so 25 GP is ~55 minutes —
 * inside the reconcile and node budgets, which otherwise fail and refund a run
 * the provider is still rendering. About 50 s at 4K60, 100 s at
 * 4K30, 6.5 min at 1080p30.
 */
export const TOPAZ_VIDEO_MAX_OUTPUT_GIGAPIXELS = 25

/** The longest source a target accepts, in whole seconds (under {@link TOPAZ_VIDEO_MAX_OUTPUT_GIGAPIXELS}). */
export function topazVideoMaxSourceSec(input: Omit<TopazVideoHoldInput, "durationSec">): number {
  const { width, height } = topazVideoOutputSize(input.resolution, input.source)
  return Math.floor((TOPAZ_VIDEO_MAX_OUTPUT_GIGAPIXELS * 1e9) / (width * height * input.fps))
}

/** The source length an estimate prices when the graph does not know it. */
export const TOPAZ_VIDEO_ESTIMATE_FALLBACK_SEC = 10

export interface TopazVideoHoldInput {
  resolution: TopazVideoResolution
  fps: number
  /** The source's length in seconds (the output runs as long). */
  durationSec: number
  /** The source's frame size; absent, a 16:9 frame. */
  source?: Pick<TopazVideoSource, "width" | "height">
}

/** The gigapixels a target renders: output width × height × frames. */
export function topazVideoOutputGigapixels(input: TopazVideoHoldInput): number {
  const { width, height } = topazVideoOutputSize(input.resolution, input.source)
  const frames = Math.ceil(Math.max(0, input.durationSec) * input.fps)
  return (width * height * frames) / 1e9
}

/** The units a run holds: its output gigapixels at the hold rate, at least the minimum. */
export function topazVideoHoldUnits(input: TopazVideoHoldInput): number {
  return Math.max(
    TOPAZ_VIDEO_MIN_HOLD_UNITS,
    Math.ceil(topazVideoOutputGigapixels(input) * TOPAZ_VIDEO_HOLD_UNITS_PER_GIGAPIXEL),
  )
}

/**
 * The units an ESTIMATE quotes before the source is measured (the editor's
 * badge, the server's run estimate): the node's target at the length the graph
 * gives (else {@link TOPAZ_VIDEO_ESTIMATE_FALLBACK_SEC}), a 16:9 frame, and its
 * frame rate (else 30). The run itself measures the real clip.
 */
export function topazVideoEstimateUnits(input: {
  resolution?: TopazVideoResolution
  fps?: number
  durationSec?: number | null
}): number {
  return topazVideoHoldUnits({
    resolution: input.resolution ?? TOPAZ_VIDEO_DEFAULT_RESOLUTION,
    fps: input.fps ?? TOPAZ_VIDEO_FALLBACK_FPS,
    durationSec: input.durationSec != null && input.durationSec > 0 ? input.durationSec : TOPAZ_VIDEO_ESTIMATE_FALLBACK_SEC,
  })
}

// ─── Image ───────────────────────────────────────────────────────────────

/** The price row of ONE Topaz image unit (the 1×/2× tier is one unit). */
export const TOPAZ_IMAGE_UNIT_CREDIT_ID = "topaz-image-upscale"

/** The published size steps: an output of up to `maxMp` megapixels uses `units`. */
export const TOPAZ_IMAGE_UNIT_STEPS: ReadonlyArray<{ readonly maxMp: number; readonly units: number }> = Object.freeze([
  { maxMp: 24, units: 1 },
  { maxMp: 48, units: 2 },
  { maxMp: 60, units: 3 },
  { maxMp: 96, units: 4 },
  { maxMp: 132, units: 5 },
  { maxMp: 168, units: 6 },
  { maxMp: 336, units: 11 },
  { maxMp: 512, units: 17 },
])

/** The largest output a Topaz image upscale accepts, in megapixels. */
export const TOPAZ_IMAGE_MAX_OUTPUT_MP = 512

/** Output megapixels of an image upscaled by `factor` (1, 2 or 4). */
export function topazImageOutputMegapixels(width: number, height: number, factor: number): number {
  return (width * factor * height * factor) / 1e6
}

/** The units an output of `mp` megapixels uses, or `undefined` above the largest step. */
export function topazImageSizeUnits(mp: number): number | undefined {
  return TOPAZ_IMAGE_UNIT_STEPS.find((s) => mp <= s.maxMp)?.units
}
