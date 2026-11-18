/**
 * A slot's original look (pure): its default pictures (`defaultImages`), a
 * picture of that role as it is in the clip, kept on an optional slot.
 *
 * Every optional person needs one to publish, whatever the clip preparation
 * (the server's `optional_person_default_missing`, publish-check.ts), except
 * on a trend that hides its original. An optional place, product or pet may
 * have one. Saving never needs it: a draft without one still saves (so it is
 * never in `formIssues`); the editor marks the slot, and the publish refusal
 * names it.
 */
import type { TrendSlotKind } from "@/lib/api"

interface LookSlot {
  readonly kind: TrendSlotKind
  readonly required: boolean
  readonly defaultImages?: readonly string[]
}

/** Whether this slot needs an original look to publish: an optional person, unless the trend hides its original. */
export function originalLookNeededToPublish(slot: Pick<LookSlot, "kind" | "required">, hideOriginal: boolean): boolean {
  return !hideOriginal && !slot.required && slot.kind === "person"
}

/** Whether this slot has an original look. */
export function hasOriginalLook(slot: Pick<LookSlot, "defaultImages">): boolean {
  return (slot.defaultImages?.length ?? 0) > 0
}

/** `optional_person_default_missing` as a sentence, naming the roles (slot keys). */
export function describeOriginalLookMissing(slots: readonly string[] | undefined): string {
  const who = slots && slots.length > 0 ? slots.join(", ") : "an optional person"
  return `Every optional person needs an original look (a picture of them as they are in the clip): add one for ${who}, or make the slot required (2. Slots).`
}
