/**
 * What a run takes for an OPTIONAL slot the person leaves empty (pure, no I/O):
 * the one rule `composeTrendRun` (compose.ts) follows and the public trend
 * detail states (a slot's `emptyFill` and `defaultImages`, routes/trends.ts),
 * so the two cannot disagree.
 *
 *  - `"default"`: the slot's original look, the pictures `emptyFillLookOf`
 *    gives (the detail serves exactly them as the slot's `defaultImages`);
 *  - `"example"`: the chosen example's pictures for the slot (none when that
 *    example has none for it: the slot then stays as in the clip);
 *  - `"original"`: no pictures, so the engine keeps the role as in the clip.
 *
 * The original look by trend (`emptyFillLookOf`), https pictures only (the
 * only ones the detail can show, so the only ones a run sends):
 *  - a trend that hides its original and is not Full depth: the pictures of the
 *    clip its page shows AS the original (stored Example 1, `shownOriginal` in
 *    public-examples.ts) for that slot, whatever the example a run names; the
 *    slot's own `defaultImages` are never sent or shown there;
 *  - Full depth that also hides its original: none (its own looks are often
 *    frames of the original it hides, and it never uses an example);
 *  - every other trend: the slot's own `defaultImages`.
 *
 * The source, then:
 *  - with an original look: `"default"`, whatever the slot's kind;
 *  - else Full depth, or a trend that hides its original: `"original"` (Full
 *    depth never uses an example; a hidden original's slot takes only the
 *    shown original's pictures);
 *  - else a person `"example"` (`"original"` on a trend with no example), and
 *    a place, product or pet `"original"`.
 */
import { faceMaskingOn, faceMaskingSourceOf } from "../../../lib/cast-swap-face-masking.js"
import type { TrendSlot, TrendVersionData } from "./types.js"

export type TrendEmptyFill = "default" | "example" | "original"

export const TREND_EMPTY_FILLS: readonly TrendEmptyFill[] = ["default", "example", "original"]

type FillData = Pick<TrendVersionData, "faceMasking" | "hideOriginal" | "examples">
type FillSlot = Pick<TrendSlot, "key" | "kind" | "required" | "defaultImages">

/** Whether this trend prepares its clip at full depth. */
export function trendIsFullDepth(data: Pick<TrendVersionData, "faceMasking">): boolean {
  return faceMaskingOn(data.faceMasking) && faceMaskingSourceOf(data.faceMasking) === "full-depth"
}

/**
 * The pictures an empty optional `slot` takes as its original look on this
 * trend (a new array; https only), or none. Empty for a required slot.
 */
export function emptyFillLookOf(data: FillData, slot: FillSlot): string[] {
  if (slot.required) return []
  const hides = data.hideOriginal === true
  if (hides && trendIsFullDepth(data)) return []
  // A hidden original's page shows stored Example 1 as the original (public-examples.ts `shownOriginal`).
  const shown = hides ? data.examples[0] : undefined
  const looks = hides ? (shown && Object.hasOwn(shown.slots, slot.key) ? shown.slots[slot.key] ?? [] : []) : (slot.defaultImages ?? [])
  return looks.filter((u) => u.startsWith("https://"))
}

/** The source an empty optional `slot` takes on this trend; `undefined` for a required slot (it is never left empty). */
export function emptyFillOf(data: FillData, slot: FillSlot): TrendEmptyFill | undefined {
  if (slot.required) return undefined
  if (emptyFillLookOf(data, slot).length > 0) return "default"
  if (trendIsFullDepth(data) || data.hideOriginal === true) return "original"
  return slot.kind === "person" && data.examples.length > 0 ? "example" : "original"
}
