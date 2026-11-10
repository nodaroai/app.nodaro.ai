/**
 * GPT Image 2.6 Flare and Sunburst: base credits per quality, size and input
 * image, and per format where it prices differently (a GIF by its band of
 * frames, an SVG by its level of detail; PNG, JPEG and WebP share one row).
 *
 * KIE bills these two by tokens and publishes an estimate per image, the same
 * for both, by quality and size at each shape. These rows are built from the
 * dearest shape read (1:1), so no shape is under-priced. A prompt adds about
 * 0.1 KIE credit and each input image about 2.2.
 *
 * Measured on 2026-11-09: real runs billed within 1% of these figures by size,
 * shape and quality, and 1.8 to 2.2 KIE credits per input image, so the rows
 * stand as built. Worked in hundredths of a KIE credit so that the rounding is
 * exact: base = ceil(KIE credits x 2.5), the credit conversion.
 */
import {
  GPT_IMAGE_2_6_GIF_BANDS,
  GPT_IMAGE_2_6_MAX_INPUT_IMAGES,
  GPT_IMAGE_2_6_QUALITIES,
  GPT_IMAGE_2_6_RESOLUTIONS,
  GPT_IMAGE_2_6_SVG_LEVELS,
  GPT_IMAGE_2_6_TIERED_I2I,
  GPT_IMAGE_2_6_TIERED_T2I,
  type GptImage26GifBand,
  type GptImage26SvgLevel,
} from "@nodaro/shared/model-catalog"

type Quality = (typeof GPT_IMAGE_2_6_QUALITIES)[number]
type Resolution = (typeof GPT_IMAGE_2_6_RESOLUTIONS)[number]

const KIE_HUNDREDTHS: Record<Quality, Record<Resolution, number>> = {
  low: { "1K": 444, "2K": 900, "4K": 1495 },
  medium: { "1K": 782, "2K": 1590, "4K": 2643 },
  high: { "1K": 948, "2K": 1927, "4K": 3202 },
  xhigh: { "1K": 1686, "2K": 3425, "4K": 5693 },
  max: { "1K": 3793, "2K": 7707, "4K": 12808 },
  // KIE picks the level, so the price isn't known before the run: reserved at
  // Max, then settled on what KIE really billed (gptImage26AutoBaseCredits).
  auto: { "1K": 3793, "2K": 7707, "4K": 12808 },
}
const PROMPT_HUNDREDTHS = 10
const INPUT_IMAGE_HUNDREDTHS = 220

export function gptImage26BaseCredits(quality: Quality, resolution: Resolution, inputImages: number): number {
  return toBaseCredits(KIE_HUNDREDTHS[quality][resolution] + PROMPT_HUNDREDTHS + INPUT_IMAGE_HUNDREDTHS * inputImages)
}

/** ceil(KIE credits x 2.5), from hundredths of a KIE credit. */
function toBaseCredits(hundredths: number): number {
  return Math.ceil((hundredths * 25) / 1000)
}

/**
 * A GIF's KIE credits by quality and band of frames, at 512 pixels a frame. KIE
 * bills a GIF by its sheet of frames, so the figure depends on the quality and
 * the band only, never on what is drawn (three prompts, from a plain shape to a
 * busy scene, billed within 0.02 of each other).
 *
 * Measured on 2026-11-10: every Medium band, every quality at 9 frames, and Max
 * at 16 frames; the rest follow the ratio between qualities, which held steady
 * in every band measured. 10 to 12 frames measured below 9 (a smaller sheet):
 * that band takes 9's figure so the bands rise in order. Auto is reserved at
 * Max and settled on what KIE billed, as for a still image. An edit adds about
 * 2.2 KIE credits per input image, as for a still image.
 */
const GIF_KIE_HUNDREDTHS: Record<Quality, Record<GptImage26GifBand, number>> = {
  low: { "2-8": 302, "9-12": 638, "13-16": 906 },
  medium: { "2-8": 531, "9-12": 1125, "13-16": 1595 },
  high: { "2-8": 643, "9-12": 1361, "13-16": 1931 },
  xhigh: { "2-8": 1142, "9-12": 2416, "13-16": 3429 },
  max: { "2-8": 2565, "9-12": 5429, "13-16": 7712 },
  auto: { "2-8": 2565, "9-12": 5429, "13-16": 7712 },
}

export function gptImage26GifBaseCredits(quality: Quality, band: GptImage26GifBand, inputImages: number): number {
  return toBaseCredits(GIF_KIE_HUNDREDTHS[quality][band] + PROMPT_HUNDREDTHS + INPUT_IMAGE_HUNDREDTHS * inputImages)
}

/**
 * An SVG costs the same image in PNG plus the writing of the drawing, which KIE
 * bills by the tokens of the model that writes it. That part grows with how
 * busy the picture is, not with its size (a measured Standard at 4K cost the PNG
 * plus 0.6 KIE credits). These base credits come from the dearest drawing
 * measured, a busy scene, at each level (2026-11-10), and are added to the PNG
 * row after it is rounded.
 */
const SVG_LEVEL_BASE_ADDON: Record<GptImage26SvgLevel, number> = {
  standard: 5,
  detailed: 44,
  max: 61,
}

export function gptImage26SvgBaseCredits(quality: Quality, resolution: Resolution, inputImages: number, level: GptImage26SvgLevel): number {
  return gptImage26BaseCredits(quality, resolution, inputImages) + SVG_LEVEL_BASE_ADDON[level]
}

/**
 * The base credits of a run at quality Auto, from the KIE credits its task
 * really used: ceil(KIE credits x 2.5), the same conversion as every row here,
 * at least one. commitJobCredits marks it up and holds it at the reservation.
 */
export function gptImage26AutoBaseCredits(kieCredits: number): number {
  return Math.max(1, Math.ceil((Math.ceil(kieCredits * 100) * 25) / 1000))
}

/**
 * Every price row of Flare and Sunburst. The bare id is medium 1K with no input
 * image. PNG, JPEG and WebP share the plain rows; a GIF has a row per quality
 * and band, an SVG a row per quality, size and level (the ids are built by
 * `buildCreditModelIdentifier`).
 */
export function gptImage26StaticCosts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of [...GPT_IMAGE_2_6_TIERED_T2I, ...GPT_IMAGE_2_6_TIERED_I2I]) {
    out[id] = gptImage26BaseCredits("medium", "1K", 0)
  }
  const each = (images: (n: number, suffix: string) => void, i2i: boolean) => {
    if (!i2i) return images(0, "")
    for (let n = 1; n <= GPT_IMAGE_2_6_MAX_INPUT_IMAGES; n++) images(n, `:${n}ref`)
  }
  for (const quality of GPT_IMAGE_2_6_QUALITIES) {
    for (const [ids, i2i] of [[GPT_IMAGE_2_6_TIERED_T2I, false], [GPT_IMAGE_2_6_TIERED_I2I, true]] as const) {
      for (const id of ids) {
        for (const resolution of GPT_IMAGE_2_6_RESOLUTIONS) {
          each((n, suffix) => { out[`${id}:${quality}:${resolution}${suffix}`] = gptImage26BaseCredits(quality, resolution, n) }, i2i)
          for (const level of GPT_IMAGE_2_6_SVG_LEVELS) {
            each((n, suffix) => { out[`${id}:${quality}:${resolution}:svg-${level}${suffix}`] = gptImage26SvgBaseCredits(quality, resolution, n, level) }, i2i)
          }
        }
        for (const { id: band } of GPT_IMAGE_2_6_GIF_BANDS) {
          each((n, suffix) => { out[`${id}:${quality}:gif-${band}${suffix}`] = gptImage26GifBaseCredits(quality, band, n) }, i2i)
        }
      }
    }
  }
  return out
}
