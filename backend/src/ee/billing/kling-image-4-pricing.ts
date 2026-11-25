/**
 * Kling Image 4.0: base credits per size, per input item and per image.
 *
 * KIE bills each picture by its size — 11.3 KIE credits at 2K, 17 at 4K, 28.3
 * at 8K — plus 0.5 for each input item, a reference image or a named subject
 * (kie.ai/kling-image-4-0 and KIE's price list, read 2026-11-22). One picture
 * is summed in hundredths of a KIE credit and rounded once: base =
 * ceil(KIE credits × 2.5), the credit conversion (as
 * `minimax-h3-image-pricing.ts`). A set of C images is C times that picture's
 * credits (decided 2026-11-22: a set is per image), so ten at 2K are 290, never
 * a total rounded once. The KIE figures are `KLING_IMAGE_4_KIE_HUNDREDTHS` in
 * providers/kie/models.ts, the ones the job's provider cost records.
 *
 * One picture: 29 at 2K, 43 at 4K, 71 at 8K. With n input items:
 * ceil((1130 + 50n) × 25 / 1000) at 2K (1 → 30, 10 → 41), and likewise at
 * 4K (1700) and 8K (2830).
 */
import {
  KLING_IMAGE_4_DEFAULT_RESOLUTION,
  KLING_IMAGE_4_I2I,
  KLING_IMAGE_4_MAX_INPUT_ITEMS,
  KLING_IMAGE_4_RESOLUTIONS,
  KLING_IMAGE_4_SET_MAX,
  KLING_IMAGE_4_SET_MIN,
  KLING_IMAGE_4_T2I,
  klingImage4CreditId,
  type KlingImage4Resolution,
} from "@nodaro/shared/model-catalog"
import {
  KLING_IMAGE_4_INPUT_ITEM_KIE_HUNDREDTHS,
  KLING_IMAGE_4_KIE_HUNDREDTHS,
} from "../../providers/kie/models.js"

/** ceil(KIE credits × 2.5), from hundredths of a KIE credit. */
function toBaseCredits(hundredths: number): number {
  return Math.ceil((hundredths * 25) / 1000)
}

/** The base credits of `images` pictures at `resolution` with `inputItems` input items (0 from a prompt). */
export function klingImage4BaseCredits(resolution: KlingImage4Resolution, inputItems: number, images = 1): number {
  const one = toBaseCredits(KLING_IMAGE_4_KIE_HUNDREDTHS[resolution] + KLING_IMAGE_4_INPUT_ITEM_KIE_HUNDREDTHS * inputItems)
  return one * images
}

/**
 * Every price row of Kling Image 4.0, under the ids `klingImage4CreditId`
 * builds: per size from a prompt, per size and input-item count (1 to 10) with
 * images, each for one picture and for a set of 2 to 10. The bare ids stand
 * for the default, 2K, one picture (an edit with its one item); a run is never
 * priced on them.
 */
export function klingImage4StaticCosts(): Record<string, number> {
  const out: Record<string, number> = {
    [KLING_IMAGE_4_T2I]: klingImage4BaseCredits(KLING_IMAGE_4_DEFAULT_RESOLUTION, 0),
    [KLING_IMAGE_4_I2I]: klingImage4BaseCredits(KLING_IMAGE_4_DEFAULT_RESOLUTION, 1),
  }
  const counts = [1, ...Array.from({ length: KLING_IMAGE_4_SET_MAX - KLING_IMAGE_4_SET_MIN + 1 }, (_, i) => KLING_IMAGE_4_SET_MIN + i)]
  for (const resolution of KLING_IMAGE_4_RESOLUTIONS) {
    for (const images of counts) {
      out[klingImage4CreditId(KLING_IMAGE_4_T2I, resolution, 0, images)] = klingImage4BaseCredits(resolution, 0, images)
      for (let n = 1; n <= KLING_IMAGE_4_MAX_INPUT_ITEMS; n++) {
        out[klingImage4CreditId(KLING_IMAGE_4_I2I, resolution, n, images)] = klingImage4BaseCredits(resolution, n, images)
      }
    }
  }
  return out
}
