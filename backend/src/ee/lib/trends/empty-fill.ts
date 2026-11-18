/**
 * What a run takes for an OPTIONAL slot the person leaves empty (pure, no I/O):
 * the one rule `composeTrendRun` (compose.ts) follows and the public trend
 * detail states (`emptyFill` of a slot, routes/trends.ts), so the two cannot
 * disagree.
 *
 *  - `"default"`: the slot's original look (`defaultImages`);
 *  - `"example"`: the chosen example's pictures for the slot (none when that
 *    example has none for it: the slot then stays as in the clip);
 *  - `"original"`: no pictures, so the engine keeps the role as in the clip.
 *
 * By trend:
 *  - Full depth (`faceMasking.source` `"full-depth"`) never uses an example:
 *    its original look, else `"original"`. One that also hides its original
 *    never sends its original look either (often frames of the original it
 *    hides): `"original"`;
 *  - a trend that hides its original: `"example"`, whatever the slot's kind
 *    (`"original"` on a trend with no example);
 *  - every other trend: `"default"` when the slot has an original look,
 *    whatever its kind; else a person `"example"` (`"original"` on a trend
 *    with no example), and a place, product or pet `"original"`.
 */
import { faceMaskingOn, faceMaskingSourceOf } from "../../../lib/cast-swap-face-masking.js"
import type { TrendSlot, TrendVersionData } from "./types.js"

export type TrendEmptyFill = "default" | "example" | "original"

export const TREND_EMPTY_FILLS: readonly TrendEmptyFill[] = ["default", "example", "original"]

/** Whether this trend prepares its clip at full depth. */
export function trendIsFullDepth(data: Pick<TrendVersionData, "faceMasking">): boolean {
  return faceMaskingOn(data.faceMasking) && faceMaskingSourceOf(data.faceMasking) === "full-depth"
}

/** The source an empty optional `slot` takes on this trend; `undefined` for a required slot (it is never left empty). */
export function emptyFillOf(
  data: Pick<TrendVersionData, "faceMasking" | "hideOriginal" | "examples">,
  slot: Pick<TrendSlot, "kind" | "required" | "defaultImages">,
): TrendEmptyFill | undefined {
  if (slot.required) return undefined
  const hidesOriginal = data.hideOriginal === true
  const hasLook = (slot.defaultImages?.length ?? 0) > 0
  const hasExample = data.examples.length > 0
  if (trendIsFullDepth(data)) return hasLook && !hidesOriginal ? "default" : "original"
  if (hidesOriginal) return hasExample ? "example" : "original"
  if (hasLook) return "default"
  return slot.kind === "person" && hasExample ? "example" : "original"
}
