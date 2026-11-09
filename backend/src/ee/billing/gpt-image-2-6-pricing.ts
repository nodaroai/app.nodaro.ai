/**
 * GPT Image 2.6 Flare and Sunburst: base credits per quality, size and input image.
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
  GPT_IMAGE_2_6_MAX_INPUT_IMAGES,
  GPT_IMAGE_2_6_QUALITIES,
  GPT_IMAGE_2_6_RESOLUTIONS,
  GPT_IMAGE_2_6_TIERED_I2I,
  GPT_IMAGE_2_6_TIERED_T2I,
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
  const hundredths = KIE_HUNDREDTHS[quality][resolution] + PROMPT_HUNDREDTHS + INPUT_IMAGE_HUNDREDTHS * inputImages
  return Math.ceil((hundredths * 25) / 1000)
}

/**
 * The base credits of a run at quality Auto, from the KIE credits its task
 * really used: ceil(KIE credits x 2.5), the same conversion as every row here,
 * at least one. commitJobCredits marks it up and holds it at the reservation.
 */
export function gptImage26AutoBaseCredits(kieCredits: number): number {
  return Math.max(1, Math.ceil((Math.ceil(kieCredits * 100) * 25) / 1000))
}

/** Every price row of Flare and Sunburst. The bare id is medium 1K with no input image. */
export function gptImage26StaticCosts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of [...GPT_IMAGE_2_6_TIERED_T2I, ...GPT_IMAGE_2_6_TIERED_I2I]) {
    out[id] = gptImage26BaseCredits("medium", "1K", 0)
  }
  for (const quality of GPT_IMAGE_2_6_QUALITIES) {
    for (const resolution of GPT_IMAGE_2_6_RESOLUTIONS) {
      for (const id of GPT_IMAGE_2_6_TIERED_T2I) out[`${id}:${quality}:${resolution}`] = gptImage26BaseCredits(quality, resolution, 0)
      for (const id of GPT_IMAGE_2_6_TIERED_I2I) {
        for (let n = 1; n <= GPT_IMAGE_2_6_MAX_INPUT_IMAGES; n++) {
          out[`${id}:${quality}:${resolution}:${n}ref`] = gptImage26BaseCredits(quality, resolution, n)
        }
      }
    }
  }
  return out
}
