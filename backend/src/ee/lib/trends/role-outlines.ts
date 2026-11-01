/**
 * A trend's role outlines (decided 2026-11-01; pure, no I/O): which outlines
 * a stored face mask's make draws, what it recorded it drew, and what a run
 * is told of them.
 *
 * With `faceMasking.roleOutlines` on (faces hidden), the make rings each
 * person role's masked region in that role's colour (`roleOutlineColour`: by
 * the role's place among the trend's person slots), the region told by that
 * role's slot marks. The make is sent one outline per person slot with
 * marks (`makeOutlinesOf`; a per-person variant, only the people it still
 * covers), answers what it drew per outline, and the approved mask records
 * it (`TrendFaceMask.outlines`). A run is sent which colour is which role
 * (`storedFaceMask.outlines`, `runOutlinesFor`): only outlines that ringed a
 * region somewhere, for roles that have pictures on this run.
 */
import { roleOutlinesOf, type RoleOutline } from "@nodaro/render-rules"
import { roleOutlinesOn, slotMarksOf } from "../../../lib/cast-swap-face-masking.js"
import type { TrendFaceMaskOutline, TrendVersionData } from "./types.js"

export type { RoleOutline }

/**
 * The outlines a make of this draft draws: one per person slot with slot
 * marks, in role order, its colour by its place among the person slots, its
 * boxes in the marks' order — less the people in `emptySlots` (a per-person
 * variant leaves them unmasked: no masked region to ring). None when role
 * outlines are off. New objects.
 */
export function makeOutlinesOf(data: Pick<TrendVersionData, "slots" | "faceMasking">, emptySlots: readonly string[] = []): RoleOutline[] {
  if (!roleOutlinesOn(data.faceMasking)) return []
  const empty = new Set(emptySlots)
  return roleOutlinesOf(data.slots, slotMarksOf(data.faceMasking).map((m) => m.mark)).filter((o) => !empty.has(o.slot))
}

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0

/**
 * What a finished make drew of the outlines it was `sent`
 * (`output_data.outlines`: one `{ slot, colour, regionsDrawn }` per outline
 * sent, any order), recorded in the order sent; null when the answer does
 * not account for every outline sent with its own colour (an engine that
 * strips them, or a make of other outlines). With none sent, an empty list
 * must still come back (`[]`): the engine said it drew none.
 */
export function recordedOutlinesOf(output: unknown, sent: readonly RoleOutline[]): TrendFaceMaskOutline[] | null {
  const list = output && typeof output === "object" ? (output as Record<string, unknown>).outlines : undefined
  if (!Array.isArray(list)) return null
  const recorded: TrendFaceMaskOutline[] = []
  for (const o of sent) {
    const got = list.find((x): x is Record<string, unknown> => !!x && typeof x === "object" && (x as Record<string, unknown>).slot === o.slot)
    if (!got || typeof got.colour !== "string" || got.colour.toUpperCase() !== o.colour.toUpperCase() || !whole(got.regionsDrawn)) return null
    recorded.push({ slot: o.slot, colour: o.colour, regionsDrawn: got.regionsDrawn })
  }
  return recorded
}

/**
 * What a run is told of the outlines on the clip it is sent: `{ role, colour }`
 * (role N = the run's Nth role, its slot's place in `slots`) for each
 * recorded outline that ringed a region (`regionsDrawn > 0`) whose role has
 * pictures on this run. A role sent with none stays as in the clip, so it is
 * not named. In role order.
 */
export function runOutlinesFor(
  recorded: readonly TrendFaceMaskOutline[] | undefined,
  slots: readonly { readonly key: string; readonly images: readonly string[] }[],
): Array<{ role: number; colour: string }> {
  const out: Array<{ role: number; colour: string }> = []
  slots.forEach((slot, i) => {
    const o = recorded?.find((r) => r.slot === slot.key)
    if (o && o.regionsDrawn > 0 && slot.images.length > 0) out.push({ role: i + 1, colour: o.colour })
  })
  return out
}
