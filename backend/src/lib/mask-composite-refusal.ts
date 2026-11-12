import { MASK_COMPOSITE_REMEASURE_SLACK_SEC, MASK_COMPOSITE_UNIT_SEC, maskCompositeUnits, pricedClipSeconds } from "@nodaro/shared/media"
import type { MaskCompositeLead } from "./mask-composite-length.js"

/**
 * Mask Composite: the render's check that a run was charged for the leading
 * video it renders (the foreground, or the background with a pixelate / blur
 * fill). Pure: no I/O — the worker calls it after its own download and probe,
 * before ffmpeg runs.
 */

/** The shortest length the charge check reads: a lead this short is one unit. */
const MIN_POSITIVE_SEC = 0.001

/** The render's refusal of a run priced for a shorter leading video than the one it renders. */
export type MaskCompositeChargeRefusalCode = "mask_composite_lead_changed"

/**
 * `billedUnits` is the units the route or the workflow run measured and
 * charged — server-written onto the queue payload, never a client's field. A
 * leading video that has grown past them since (a link that served a short
 * file to the price probe and a long one to the download) is refused before
 * anything is drawn, and refunded; so is a run that carries no priced units. A
 * re-measure up to `MASK_COMPOSITE_REMEASURE_SLACK_SEC` longer is the same file
 * (the slack is taken off the seconds, not the units). Lengths in the message
 * are the priced seconds, the rounding the price uses.
 */
export function maskCompositeRefusalForCharge(
  lead: MaskCompositeLead,
  billedUnits: unknown,
  durationSec: number,
): { readonly code: MaskCompositeChargeRefusalCode; readonly message: string } | undefined {
  if (typeof billedUnits !== "number" || !Number.isFinite(billedUnits) || billedUnits < 1) {
    return { code: "mask_composite_lead_changed", message: `This run was not priced for its ${lead} video — run it again` }
  }
  // Never at or below 0: `maskCompositeUnits` reads that as "not known" (the cap).
  const remeasured = Math.max(durationSec - MASK_COMPOSITE_REMEASURE_SLACK_SEC, MIN_POSITIVE_SEC)
  if (maskCompositeUnits(remeasured) <= billedUnits) return undefined
  return {
    code: "mask_composite_lead_changed",
    message: `The ${lead} video is ${pricedClipSeconds(durationSec)} seconds, longer than the ${billedUnits * MASK_COMPOSITE_UNIT_SEC} seconds this run was priced for — run it again`,
  }
}
