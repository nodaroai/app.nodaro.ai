/**
 * Cropping a trend's source clip to 16:9 or 9:16: which crop a clip is
 * offered, the size it comes out at, and how a position splits the cut — the
 * rule the crop route refuses by and the trend builder shows, so the two never
 * differ.
 *
 * A clip wider than 16:9 (an ultra-wide 2568×1080, say) is cut at the sides to
 * 16:9, its height kept; one taller than 9:16 is cut at the top and bottom to
 * 9:16, its width kept. Only the crop that trims is offered: a clip at 16:9,
 * at 9:16 or in between (4:3, 1:1) gets none. Sizes are the clip as SHOWN (a
 * phone clip's rotation applied).
 */

export type TrendCropAspect = "16:9" | "9:16"

/**
 * How far past the target shape a clip must be before a crop is offered: 2 %,
 * so a clip a few pixels off 16:9 (1928×1080) is not offered a sliver.
 */
export const TREND_CROP_TOLERANCE = 0.02

/** Where the kept frame sits by default: centered, the cut shared equally between the two sides. */
export const TREND_CROP_DEFAULT_POSITION = 0.5

/** The crop a `width`×`height` clip (as shown) is offered, or null: 16:9 when wider than 16:9, 9:16 when taller than 9:16. */
export function trendCropAspectFor(width: number | undefined, height: number | undefined): TrendCropAspect | null {
  if (!width || !height) return null
  if (width * 9 > height * 16 * (1 + TREND_CROP_TOLERANCE)) return "16:9"
  if (height * 9 > width * 16 * (1 + TREND_CROP_TOLERANCE)) return "9:16"
  return null
}

const even = (x: number) => 2 * Math.floor(x / 2)

/**
 * The size a `width`×`height` clip (as shown) comes out of an `aspect` crop:
 * its height kept for 16:9, its width for 9:16, the other side cut to the
 * shape, both even (yuv420p needs them even). 2568×1080 → 1920×1080.
 */
export function trendCropTargetSize(width: number, height: number, aspect: TrendCropAspect): { width: number; height: number } {
  return aspect === "16:9"
    ? { width: even((height * 16) / 9), height: even(height) }
    : { width: even(width), height: even((width * 16) / 9) }
}

/**
 * How many pixels a crop at `position` (0–1, held inside) takes off each side
 * of a `width`×`height` clip (as shown): `before` = the left (16:9) or top
 * (9:16), `after` = the right or bottom. `before` is even, exactly where the
 * renderer places the frame: 2568×1080 at 0.5 → 324 and 324.
 */
export function trendCropCut(width: number, height: number, aspect: TrendCropAspect, position: number): { before: number; after: number } {
  const p = Math.min(1, Math.max(0, position))
  const target = trendCropTargetSize(width, height, aspect)
  // The renderer's own offset: trunc((iw - ow) · p / 2) · 2 on the clip's real size.
  const total = Math.max(0, aspect === "16:9" ? width - target.width : height - target.height)
  const before = Math.min(total, even(total * p))
  return { before, after: total - before }
}
