/**
 * FLUX 3 Klein: base credits per size, the same from a prompt and from an edit.
 *
 * KIE bills a flat price per picture by its size, 1.6 KIE credits at 1K, 2.5
 * at 2K and 6.5 at 4K, on both endpoints, with nothing per reference image
 * (kie.ai/flux-3 and KIE's price list, read 2026-11-11; the schemas'
 * `creditsConsumed` note, read 2026-11-12). base = ceil(KIE credits × 2.5),
 * the credit conversion, from hundredths of a KIE credit so the rounding is
 * exact (as `seedream-5-5-pricing.ts`). The KIE figures are
 * `FLUX_3_KLEIN_KIE_HUNDREDTHS` in providers/kie/models.ts, the ones the job's
 * provider cost records.
 *
 * 1K → 4, 2K → 7, 4K → 17 (decided 2026-11-11).
 */
import {
  FLUX_3_KLEIN_DEFAULT_RESOLUTION,
  FLUX_3_KLEIN_I2I,
  FLUX_3_KLEIN_RESOLUTIONS,
  FLUX_3_KLEIN_T2I,
  flux3KleinCreditId,
  type Flux3KleinResolution,
} from "@nodaro/shared/model-catalog"
import { FLUX_3_KLEIN_KIE_HUNDREDTHS } from "../../providers/kie/models.js"

/** ceil(KIE credits × 2.5), from hundredths of a KIE credit. */
function toBaseCredits(hundredths: number): number {
  return Math.ceil((hundredths * 25) / 1000)
}

/** The base credits of one FLUX 3 Klein picture at `resolution`, from a prompt or an edit. */
export function flux3KleinBaseCredits(resolution: Flux3KleinResolution): number {
  return toBaseCredits(FLUX_3_KLEIN_KIE_HUNDREDTHS[resolution])
}

/**
 * Every price row of FLUX 3 Klein, under the ids `flux3KleinCreditId` builds:
 * one per size on each id, and the bare ids at the default size, 1K, which is
 * what a caller that names the model alone is quoted (the catalog's default
 * row, `/v1/credits/model-cost` for the bare id).
 */
export function flux3KleinStaticCosts(): Record<string, number> {
  const out: Record<string, number> = {
    [FLUX_3_KLEIN_T2I]: flux3KleinBaseCredits(FLUX_3_KLEIN_DEFAULT_RESOLUTION),
    [FLUX_3_KLEIN_I2I]: flux3KleinBaseCredits(FLUX_3_KLEIN_DEFAULT_RESOLUTION),
  }
  for (const resolution of FLUX_3_KLEIN_RESOLUTIONS) {
    out[flux3KleinCreditId(FLUX_3_KLEIN_T2I, resolution, 0)] = flux3KleinBaseCredits(resolution)
    out[flux3KleinCreditId(FLUX_3_KLEIN_I2I, resolution, 1)] = flux3KleinBaseCredits(resolution)
  }
  return out
}
