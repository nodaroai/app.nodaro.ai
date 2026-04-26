/**
 * Multi-select helpers for parameter dimensions that allow up to N picks.
 *
 * A dimension's stored value can be:
 *   - undefined / "" / []  → no pick
 *   - string               → single pick (back-compat with single-select fields)
 *   - string[]             → multi pick (1..N entries)
 *
 * `pickIds` normalizes any of those into a clean string[] (deduped, falsy
 * entries dropped). Pickers cap the array at `maxSelected` (FIFO replacement
 * is the picker's responsibility, not this helper's).
 *
 * Multi-select dimensions today: Person.ethnicity, Mood.mood, Aesthetic.aesthetic.
 */

export function pickIds(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : []
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== "string" || !v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/**
 * Cap a multi-pick array at `maxSelected`, FIFO-replacing the oldest entry
 * when the array is full and a new id is added. Returns a fresh array.
 */
export function togglePick(
  current: ReadonlyArray<string>,
  id: string,
  maxSelected: number,
): string[] {
  if (current.includes(id)) return current.filter((v) => v !== id)
  if (current.length < maxSelected) return [...current, id]
  // FIFO replace: drop oldest, append new
  return [...current.slice(1), id]
}
