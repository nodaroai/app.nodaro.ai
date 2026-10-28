/**
 * What Topaz is offered for one of a trend's videos (the source clip or an
 * example): the rule the upscale route refuses by and the trend builder
 * shows, so the two never differ.
 *
 * The admin picks the target: 720p or 1080p (the short side). A video under
 * the target on its short side is upscaled to it; one at exactly the target is
 * enhanced at the same size (Topaz's model run again over it, for a sharper,
 * cleaner picture: the point of a 720p ask on a 720p clip); one above the
 * target is offered nothing at that target, since it would shrink. An unknown
 * size (a source clip stored before sizes were recorded) is offered an upscale
 * at either target.
 */

/** The targets a trend's video may be upscaled (or enhanced) to: the short side. */
export const TREND_UPSCALE_RESOLUTIONS = ["720p", "1080p"] as const

export type TrendUpscaleResolution = (typeof TREND_UPSCALE_RESOLUTIONS)[number]

/** The target a request that names none is read as (every upscale made before the choice). */
export const TREND_UPSCALE_DEFAULT_RESOLUTION: TrendUpscaleResolution = "1080p"

const SHORT_SIDES: Readonly<Record<TrendUpscaleResolution, number>> = { "720p": 720, "1080p": 1080 }

/** The short side Topaz is asked for at `resolution`, and the upscaled or enhanced video is stored at. */
export function trendUpscaleShortSide(resolution: TrendUpscaleResolution = TREND_UPSCALE_DEFAULT_RESOLUTION): number {
  return SHORT_SIDES[resolution]
}

/** The default target's short side (1080). */
export const TREND_UPSCALE_SHORT_SIDE = SHORT_SIDES[TREND_UPSCALE_DEFAULT_RESOLUTION]

/** Whether `value` is one of `TREND_UPSCALE_RESOLUTIONS`. */
export function isTrendUpscaleResolution(value: unknown): value is TrendUpscaleResolution {
  return typeof value === "string" && (TREND_UPSCALE_RESOLUTIONS as readonly string[]).includes(value)
}

export type TrendUpscaleOffer = "upscale" | "enhance"

/**
 * What a `width`×`height` video is offered at `resolution` (1080p unless
 * named): an upscale under its short side, an enhance at exactly it, else null.
 */
export function trendUpscaleOfferFor(
  width: number | undefined,
  height: number | undefined,
  resolution: TrendUpscaleResolution = TREND_UPSCALE_DEFAULT_RESOLUTION,
): TrendUpscaleOffer | null {
  if (!width || !height) return "upscale"
  const target = trendUpscaleShortSide(resolution)
  const short = Math.min(width, height)
  if (short < target) return "upscale"
  return short === target ? "enhance" : null
}

/** Every target a `width`×`height` video is offered, smallest first, with what each would do. */
export function trendUpscaleOffersFor(
  width: number | undefined,
  height: number | undefined,
): Array<{ resolution: TrendUpscaleResolution; offer: TrendUpscaleOffer }> {
  return TREND_UPSCALE_RESOLUTIONS.flatMap((resolution) => {
    const offer = trendUpscaleOfferFor(width, height, resolution)
    return offer ? [{ resolution, offer }] : []
  })
}
