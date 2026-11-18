/**
 * A slot's original look (pure): its default pictures (`defaultImages`), a
 * picture of that role as it is in the clip, kept on an optional slot. It is
 * never needed: a run that leaves the slot empty uses it when it has one
 * (unless the trend hides its original), and without one a person takes the
 * example's pictures and any other role stays as in the clip (the server's
 * compose.ts has the whole rule).
 */
import type { TrendSlotKind } from "@/lib/api"

interface LookSlot {
  readonly kind: TrendSlotKind
  readonly required: boolean
  readonly defaultImages?: readonly string[]
}

/** Whether this slot has an original look. */
export function hasOriginalLook(slot: Pick<LookSlot, "defaultImages">): boolean {
  return (slot.defaultImages?.length ?? 0) > 0
}
