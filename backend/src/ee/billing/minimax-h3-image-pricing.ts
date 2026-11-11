/**
 * MiniMax H3 Image: base credits per size and, on an edit, per reference image.
 *
 * KIE bills each picture by its size (1K and 2K the same, 4K more) and an edit
 * a fixed amount more for each reference image, the first included
 * (`MINIMAX_H3_IMAGE_KIE_HUNDREDTHS` in providers/kie/models.ts). The total is
 * summed in hundredths of a KIE credit, then rounded once: base =
 * ceil(KIE credits x 2.5), the credit conversion, as for GPT Image 2.6.
 */
import {
  MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION,
  MINIMAX_H3_IMAGE_I2I,
  MINIMAX_H3_IMAGE_MAX_INPUT_IMAGES,
  MINIMAX_H3_IMAGE_RESOLUTIONS,
  MINIMAX_H3_IMAGE_T2I,
  minimaxH3ImageCreditId,
  type MinimaxH3ImageResolution,
} from "@nodaro/shared/model-catalog"
import {
  MINIMAX_H3_IMAGE_KIE_HUNDREDTHS,
  MINIMAX_H3_IMAGE_REFERENCE_KIE_HUNDREDTHS,
} from "../../providers/kie/models.js"

/** ceil(KIE credits x 2.5), from hundredths of a KIE credit. */
function toBaseCredits(hundredths: number): number {
  return Math.ceil((hundredths * 25) / 1000)
}

/** The base credits of one picture at `resolution`, given `references` reference images (0 from a prompt). */
export function minimaxH3ImageBaseCredits(resolution: MinimaxH3ImageResolution, references: number): number {
  return toBaseCredits(MINIMAX_H3_IMAGE_KIE_HUNDREDTHS[resolution] + MINIMAX_H3_IMAGE_REFERENCE_KIE_HUNDREDTHS * references)
}

/**
 * Every price row of MiniMax H3 Image, under the ids `minimaxH3ImageCreditId`
 * builds: one per size from a prompt, one per size and reference count (1 to
 * 16) for an edit. The bare ids stand for the default size, 2K, and an edit's
 * least, one reference image; a run is never priced on them.
 */
export function minimaxH3ImageStaticCosts(): Record<string, number> {
  const out: Record<string, number> = {
    [MINIMAX_H3_IMAGE_T2I]: minimaxH3ImageBaseCredits(MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION, 0),
    [MINIMAX_H3_IMAGE_I2I]: minimaxH3ImageBaseCredits(MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION, 1),
  }
  for (const resolution of MINIMAX_H3_IMAGE_RESOLUTIONS) {
    out[minimaxH3ImageCreditId(MINIMAX_H3_IMAGE_T2I, resolution, 0)] = minimaxH3ImageBaseCredits(resolution, 0)
    for (let n = 1; n <= MINIMAX_H3_IMAGE_MAX_INPUT_IMAGES; n++) {
      out[minimaxH3ImageCreditId(MINIMAX_H3_IMAGE_I2I, resolution, n)] = minimaxH3ImageBaseCredits(resolution, n)
    }
  }
  return out
}
