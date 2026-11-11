/**
 * What makes GPT Image 2.6 Flare and Sunburst price differently from every
 * other image model: a quality setting AND a size, and on an edit the number of
 * input images as well. Economy is a flat price and is not listed here.
 *
 * Only the ids and levers live in this published package. The rates and the
 * formula are `backend/src/ee/billing/gpt-image-2-6-pricing.ts`.
 */

export const GPT_IMAGE_2_6_TIERED_T2I = ["gpt-image-2-6-flare", "gpt-image-2-6-sunburst"] as const
export const GPT_IMAGE_2_6_TIERED_I2I = ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"] as const
export type GptImage26TieredModel =
  | (typeof GPT_IMAGE_2_6_TIERED_T2I)[number]
  | (typeof GPT_IMAGE_2_6_TIERED_I2I)[number]

export const GPT_IMAGE_2_6_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const
export type GptImage26Quality = (typeof GPT_IMAGE_2_6_QUALITIES)[number]
/**
 * The quality whose price is known only after the run: KIE picks the level. It
 * is reserved at the Max row and settled on what KIE really billed; every other
 * quality keeps its fixed row.
 */
export const GPT_IMAGE_2_6_METERED_QUALITY: GptImage26Quality = "auto"
export const GPT_IMAGE_2_6_RESOLUTIONS = ["1K", "2K", "4K"] as const
export type GptImage26Resolution = (typeof GPT_IMAGE_2_6_RESOLUTIONS)[number]

export const GPT_IMAGE_2_6_DEFAULT_QUALITY: GptImage26Quality = "medium"
export const GPT_IMAGE_2_6_DEFAULT_RESOLUTION: GptImage26Resolution = "1K"
/** The most input images an edit is priced for (`REF_IMAGE_MAX_LIMITS`). */
export const GPT_IMAGE_2_6_MAX_INPUT_IMAGES = 16

/**
 * A GIF is priced by quality and by how many frames it has, in three bands:
 * KIE draws every frame of a GIF on one sheet, and the frames of a band share a
 * sheet size. Its price does not depend on the ratio or size (a GIF is always
 * square, 512 pixels a frame). Ten to twelve frames take nine's price, so the
 * bands rise in order.
 */
export const GPT_IMAGE_2_6_GIF_BANDS = [
  { id: "2-8", min: 2, max: 8 },
  { id: "9-12", min: 9, max: 12 },
  { id: "13-16", min: 13, max: 16 },
] as const
export type GptImage26GifBand = (typeof GPT_IMAGE_2_6_GIF_BANDS)[number]["id"]
/** The frames a GIF has when none are asked for (KIE's own default). */
export const GPT_IMAGE_2_6_GIF_DEFAULT_FRAMES = 9

/**
 * The band a GIF of `frames` frames is priced in. A value that is not a whole
 * number of frames, or is off the range, lands where the run lands: no value is
 * the default nine frames, others are rounded and kept inside 2 to 16.
 */
export function gptImage26GifBand(frames: unknown): GptImage26GifBand {
  // A numeric string counts as its number, as the run reads it (a form field, a FieldMapping).
  const asked = typeof frames === "number" ? frames : typeof frames === "string" && frames.trim() !== "" ? Number(frames) : Number.NaN
  const n = Number.isFinite(asked) ? Math.round(asked) : GPT_IMAGE_2_6_GIF_DEFAULT_FRAMES
  const first = GPT_IMAGE_2_6_GIF_BANDS[0]
  const last = GPT_IMAGE_2_6_GIF_BANDS[GPT_IMAGE_2_6_GIF_BANDS.length - 1]!
  const clamped = Math.min(Math.max(n, first.min), last.max)
  return (GPT_IMAGE_2_6_GIF_BANDS.find((b) => clamped >= b.min && clamped <= b.max) ?? first).id
}

/**
 * An SVG is drawn at one of three levels of detail (Standard, Detailed, Max),
 * each priced as the same image in PNG plus a fixed amount for the drawing.
 */
export const GPT_IMAGE_2_6_SVG_LEVELS = ["standard", "detailed", "max"] as const
export type GptImage26SvgLevel = (typeof GPT_IMAGE_2_6_SVG_LEVELS)[number]
export const GPT_IMAGE_2_6_DEFAULT_SVG_LEVEL: GptImage26SvgLevel = "standard"

/** The format part of a GPT Image 2.6 price: a GIF's band, an SVG's level, or none (PNG, JPEG and WebP cost the same). */
export type GptImage26PricedFormat =
  | { readonly kind: "gif"; readonly band: GptImage26GifBand }
  | { readonly kind: "svg"; readonly level: GptImage26SvgLevel }

/** The levers a format is priced from, as a request or a node carries them (unchecked). */
export interface ImageFormatLevers {
  outputFormat?: unknown
  gifFrames?: unknown
  svgLevel?: unknown
}

/** The format levers of a request body or a node's data, for a price. */
export function imageFormatLeversOf(record: Record<string, unknown> | undefined): ImageFormatLevers {
  return { outputFormat: record?.outputFormat, gifFrames: record?.gifFrames, svgLevel: record?.svgLevel }
}

/** Read in any case, as the catalog snap reads it (`normalizeModelInput`). */
function lowered(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined
}

export function gptImage26PricedFormat(levers: ImageFormatLevers | undefined): GptImage26PricedFormat | undefined {
  const format = lowered(levers?.outputFormat)
  if (format === "gif") return { kind: "gif", band: gptImage26GifBand(levers?.gifFrames) }
  if (format === "svg") {
    const asked = lowered(levers?.svgLevel)
    const level = GPT_IMAGE_2_6_SVG_LEVELS.find((l) => l === asked) ?? GPT_IMAGE_2_6_DEFAULT_SVG_LEVEL
    return { kind: "svg", level }
  }
  return undefined
}

export function isGptImage26I2i(model: string): boolean {
  return (GPT_IMAGE_2_6_TIERED_I2I as readonly string[]).includes(model)
}

export function isGptImage26Tiered(model: string): model is GptImage26TieredModel {
  return isGptImage26I2i(model) || (GPT_IMAGE_2_6_TIERED_T2I as readonly string[]).includes(model)
}

/** True for a run whose charge is settled on KIE's own bill: Flare or Sunburst at quality Auto. */
export function isGptImage26AutoRun(provider: unknown, quality: unknown): boolean {
  return typeof provider === "string" && isGptImage26Tiered(provider) && quality === GPT_IMAGE_2_6_METERED_QUALITY
}

/**
 * The images a Generate Image run sends to KIE on GPT Image 2.6: its references
 * and, when it edits a base image, that image too (the worker puts it first,
 * unless it is already one of the references). Any other model is priced on its
 * references alone.
 *
 * @deprecated Use `pricedSentImages` (`input-image-pricing.ts`), which counts
 * the base for every model priced per input image, MiniMax H3 Image included.
 */
export function gptImage26SentImages(
  provider: string | undefined,
  references: readonly string[],
  baseImageUrl: unknown,
): number {
  const countsBase =
    provider !== undefined &&
    isGptImage26Tiered(provider) &&
    typeof baseImageUrl === "string" &&
    baseImageUrl.length > 0 &&
    !references.includes(baseImageUrl)
  return references.length + (countsBase ? 1 : 0)
}

/**
 * The most pictures a saved moodboard holds. A run sends them as references in
 * the seats the node's own images leave free. An estimate cannot read the
 * moodboard, so it counts this many.
 */
export const GPT_IMAGE_2_6_MOODBOARD_MAX_IMAGES = 12

function namesMoodboard(direction: unknown): boolean {
  if (direction === null || typeof direction !== "object") return false
  const style = (direction as Record<string, unknown>).style
  return (Array.isArray(style) ? style : [style]).some(
    (value) => typeof value === "string" && value.startsWith("moodboard:"),
  )
}

/**
 * The input images a workflow estimate counts for one node on a model priced
 * per input image: every list on the node, its source or base image, what is
 * wired in, a moodboard its direction names, and an image-to-image model's own
 * source. An estimate may over-quote, never under.
 *
 * @deprecated Use `pricedEstimatedImages` (`input-image-pricing.ts`), which
 * counts for every model priced per input image, MiniMax H3 Image included.
 */
export function gptImage26EstimatedImages(
  model: string,
  data: Record<string, unknown>,
  wiredImages: number,
): number {
  const listed = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  const single = (v: unknown) => (typeof v === "string" && v.length > 0 ? 1 : 0)
  return (
    listed(data.referenceImageUrls) +
    listed(data.characterDefinitionIds) +
    listed(data.extraRefs) +
    single(data.referenceImageUrl) +
    single(data.baseImageUrl) +
    single(data.sourceImageUrl) +
    wiredImages +
    (namesMoodboard(data.direction) ? GPT_IMAGE_2_6_MOODBOARD_MAX_IMAGES : 0) +
    (isGptImage26I2i(model) ? 1 : 0)
  )
}
