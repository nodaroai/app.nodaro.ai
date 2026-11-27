/**
 * Seedance 2.5 Extend at 4K (decided 2026-11-25): offered only for a source
 * that is ALREADY 4K. The extend joins the new seconds onto the source at the
 * source's own size, so a 4K extension of a smaller clip would be paid for at
 * 4K and delivered at the source's size.
 *
 * "Already 4K" is the rule Edit Video Pro picks its 4K bridge by: the source's
 * short side (its coded width and height, the smaller of the two) is
 * {@link SEEDANCE_EXTEND_4K_MIN_SHORT_SIDE} pixels or more — 3840×2160, and
 * 2160×3840 upright.
 *
 * One rule for the route and the workflow run (both before anything is held,
 * on the source they probe), the worker (again before it generates), the
 * server's run estimate and the editor (on the size the graph records). A
 * source whose size is not known is never refused here: the server's own
 * probe decides it.
 */
import { isSeedanceExtendPricedBySecondsSent } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
// The 4K spelling the run's own resolution rule (`tailExtendResolution`) reads too, so
// "4K" is refused here exactly when it would be priced and sent as 4K.
import { explicitFourKOf } from "@nodaro/shared/models"

/** The shortest short side, in pixels, of a source a Seedance 2.5 Extend continues at 4K. */
export const SEEDANCE_EXTEND_4K_MIN_SHORT_SIDE = 2160

/** The refusal code a 4K extend of a smaller source answers (a 400, before anything is held). */
export const SEEDANCE_EXTEND_4K_SOURCE_CODE = "extend_source_below_4k"

/** A known size, when it is one: both sides finite and above 0. */
function knownSize(source: { readonly width?: number; readonly height?: number } | undefined): { width: number; height: number } | undefined {
  const width = source?.width
  const height = source?.height
  return typeof width === "number" && typeof height === "number" && width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)
    ? { width, height }
    : undefined
}

/** Whether a source of this size is already 4K (its short side {@link SEEDANCE_EXTEND_4K_MIN_SHORT_SIDE} or more). */
export function isFourKSource(source: { readonly width: number; readonly height: number }): boolean {
  return Math.min(source.width, source.height) >= SEEDANCE_EXTEND_4K_MIN_SHORT_SIDE
}

/**
 * Why a Seedance Extend run at `resolution` cannot continue a source of this
 * size, or undefined when it can: only a 4K request on a known source under
 * 4K is refused. Any other provider, resolution, or an unknown size: undefined.
 */
export function seedanceExtend4kSourceProblem(
  provider: unknown,
  resolution: unknown,
  source: { readonly width?: number; readonly height?: number } | undefined,
): string | undefined {
  // A model that renders no 4K (Seedance 2.5 Flash Extend) runs a 4K spelling at 720p, as before: nothing to refuse.
  if (!isSeedanceExtendPricedBySecondsSent(provider) || !explicitFourKOf(provider, resolution)) return undefined
  const size = knownSize(source)
  if (!size || isFourKSource(size)) return undefined
  const label = MODEL_CATALOG[provider]?.label ?? provider
  return (
    `${label} renders 4K only for a source that is already 4K (its short side ${SEEDANCE_EXTEND_4K_MIN_SHORT_SIDE} pixels or more); ` +
    `this source is ${size.width}×${size.height}. Choose 1080p or lower, or extend a 4K source.`
  )
}

/**
 * The resolutions an Extend Video menu offers for `provider` on a source of
 * this size: the catalog's, less 4K when the source is known and under 4K.
 */
export function seedanceExtendOfferedResolutions(
  provider: string,
  source: { readonly width?: number; readonly height?: number } | undefined,
): string[] {
  const all = (MODEL_CATALOG[provider]?.resolutions ?? []) as readonly string[]
  return all.filter((r) => seedanceExtend4kSourceProblem(provider, r, source) === undefined)
}
