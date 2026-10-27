/**
 * What Topaz is offered for one of a trend's videos (the source clip or an
 * example): the rule the upscale route refuses by and the trend builder
 * shows, so the two never differ.
 *
 * Topaz is asked for 1080p (the short side) either way. A video under 1080 on
 * its short side is upscaled to it; one at exactly 1080 is enhanced at the
 * same size (Topaz's model run again over it, for a sharper, cleaner picture);
 * one above 1080 is offered nothing, since a 1080p target would shrink it.
 * An unknown size (a source clip stored before sizes were recorded) is
 * offered an upscale.
 */

/** The short side Topaz is asked for, and every upscaled or enhanced video is stored at. */
export const TREND_UPSCALE_SHORT_SIDE = 1080

export type TrendUpscaleOffer = "upscale" | "enhance"

/** What a `width`×`height` video is offered: an upscale under 1080 on its short side, an enhance at exactly 1080, else null. */
export function trendUpscaleOfferFor(width: number | undefined, height: number | undefined): TrendUpscaleOffer | null {
  if (!width || !height) return "upscale"
  const short = Math.min(width, height)
  if (short < TREND_UPSCALE_SHORT_SIDE) return "upscale"
  return short === TREND_UPSCALE_SHORT_SIDE ? "enhance" : null
}
