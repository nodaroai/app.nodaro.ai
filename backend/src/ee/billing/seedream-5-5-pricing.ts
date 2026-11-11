/**
 * Seedream 5.5: base credits per size and, on an edit, per input image.
 *
 * KIE bills a flat price per picture by its size — 3.6 KIE credits at 1K or
 * 1.5K, 6.3 at 2K — and an edit adds 1.44 for each input image (kie.ai's
 * product page and price list, read 2026-11-11; KIE's own example, a 2K edit
 * with two inputs, is 6.3 + 2 × 1.44 = 9.18). The parts are summed first and
 * rounded once, in hundredths of a KIE credit so the rounding is exact:
 * base = ceil(KIE credits × 2.5), the credit conversion (as
 * `gpt-image-2-6-pricing.ts`). The KIE figures are `SEEDREAM_5_5_KIE_HUNDREDTHS`
 * in providers/kie/models.ts, the ones the job's provider cost records.
 *
 * Text to image: 9 at 1K and 1.5K, 16 at 2K. An edit with n input images:
 * ceil((360 + 144n) × 25 / 1000) at 1K and 1.5K (1 → 13, 10 → 45),
 * ceil((630 + 144n) × 25 / 1000) at 2K (1 → 20, 10 → 52).
 */
import {
  SEEDREAM_5_5_DEFAULT_RESOLUTION,
  SEEDREAM_5_5_I2I,
  SEEDREAM_5_5_MAX_INPUT_IMAGES,
  SEEDREAM_5_5_RESOLUTIONS,
  SEEDREAM_5_5_T2I,
  type Seedream55Resolution,
} from "@nodaro/shared/model-catalog"
import {
  SEEDREAM_5_5_INPUT_IMAGE_KIE_HUNDREDTHS,
  SEEDREAM_5_5_KIE_HUNDREDTHS,
} from "../../providers/kie/models.js"

/** ceil(KIE credits × 2.5), from hundredths of a KIE credit. */
function toBaseCredits(hundredths: number): number {
  return Math.ceil((hundredths * 25) / 1000)
}

/** The base credits of a Seedream 5.5 run at `resolution` with `inputImages` input images (0 for text to image). */
export function seedream55BaseCredits(resolution: Seedream55Resolution, inputImages: number): number {
  return toBaseCredits(SEEDREAM_5_5_KIE_HUNDREDTHS[resolution] + SEEDREAM_5_5_INPUT_IMAGE_KIE_HUNDREDTHS * inputImages)
}

/**
 * Every price row of Seedream 5.5 (the ids `buildCreditModelIdentifier` builds):
 * `seedream-5-5:<size>`, and `seedream-5-5-i2i:<size>:<N>ref` for 1 to 10 input
 * images. The bare ids are what the model renders with no size named: the
 * text-to-image id at 2K, the edit at 2K with its one source image.
 */
export function seedream55StaticCosts(): Record<string, number> {
  const out: Record<string, number> = {
    [SEEDREAM_5_5_T2I]: seedream55BaseCredits(SEEDREAM_5_5_DEFAULT_RESOLUTION, 0),
    [SEEDREAM_5_5_I2I]: seedream55BaseCredits(SEEDREAM_5_5_DEFAULT_RESOLUTION, 1),
  }
  for (const resolution of SEEDREAM_5_5_RESOLUTIONS) {
    out[`${SEEDREAM_5_5_T2I}:${resolution}`] = seedream55BaseCredits(resolution, 0)
    for (let n = 1; n <= SEEDREAM_5_5_MAX_INPUT_IMAGES; n++) {
      out[`${SEEDREAM_5_5_I2I}:${resolution}:${n}ref`] = seedream55BaseCredits(resolution, n)
    }
  }
  return out
}
