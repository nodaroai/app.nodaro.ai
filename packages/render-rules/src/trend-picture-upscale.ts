/**
 * Whether a Topaz image upscale of one of a trend's pictures (a slot's default
 * picture) can be stored once it is made: the rule the trend builder offers
 * each factor by and the trend media store refuses by, so the two never
 * differ.
 *
 * A trend picture may weigh at most `TREND_PICTURE_MAX_BYTES`, and the upscale
 * is paid before its result is copied into trend storage, so a factor whose
 * result could weigh more is not offered. The result's weight is judged on its
 * worst case, before it exists: a PNG at `TREND_PICTURE_WORST_BYTES_PER_PIXEL`
 * (uncompressed 24-bit colour). An unknown size is offered every factor (the
 * picture has not loaded yet; the store still refuses an oversized result).
 */

/** The most a trend picture may weigh (a slot's default or hint picture, a reference). */
export const TREND_PICTURE_MAX_BYTES = 30 * 1024 * 1024

/** The worst a stored upscale weighs per pixel: an uncompressed 24-bit picture. */
export const TREND_PICTURE_WORST_BYTES_PER_PIXEL = 3

/** The most pixels an upscaled trend picture may have and still always fit `TREND_PICTURE_MAX_BYTES`. */
export const TREND_PICTURE_UPSCALE_MAX_PIXELS = Math.floor(TREND_PICTURE_MAX_BYTES / TREND_PICTURE_WORST_BYTES_PER_PIXEL)

/** Whether upscaling a `width`×`height` picture by `factor` makes one a trend can always store. */
export function trendPictureUpscaleFits(width: number | undefined, height: number | undefined, factor: number): boolean {
  if (!width || !height) return true
  return width * factor * height * factor <= TREND_PICTURE_UPSCALE_MAX_PIXELS
}
