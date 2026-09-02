/**
 * LEAF MODULE — no runtime imports. person.ts and styling.ts import this;
 * any catalog import here reopens the person → age-floor → picker-catalogs
 * load-time cycle.
 *
 * `isMinorAge` is an ADULT ALLOW-LIST on purpose: a new age id added to the
 * catalog is inside the floor until someone lists it here as adult. Custom
 * numeric ages use the same boundary as `buildAgeFragment` in person.ts
 * ("in their teens" below 20).
 */

export const ADULT_ONLY_FLAG = "adultOnly" as const

/** Catalog age ids that describe an ADULT. Everything else is floored. */
export const ADULT_AGE_IDS: ReadonlySet<string> = new Set([
  "age-early-20s", "age-late-20s", "age-20s", "age-30s", "age-40s", "age-50s", "age-60s", "age-elderly",
])

/** Type entries whose hint reads as a child even with no age selected. */
export const MINOR_IMPLYING_TYPE_IDS: ReadonlySet<string> = new Set([
  "alice-wonderland", "dorothy-oz", "peter-pan", "magical-girl", "prince", "princess",
])

/** True when the picker value describes someone under 20, or a child-typed
 *  subject with no age. An explicit adult age always wins. */
export function isMinorAge(
  value: { readonly age?: string; readonly customAge?: number; readonly type?: string } | null | undefined,
): boolean {
  if (!value) return false
  const { age, customAge, type } = value
  if (typeof age === "string" && age.length > 0) {
    if (age === "age-custom") return !(typeof customAge === "number" && Number.isFinite(customAge) && customAge >= 20)
    return !ADULT_AGE_IDS.has(age)
  }
  return typeof type === "string" && MINOR_IMPLYING_TYPE_IDS.has(type)
}
