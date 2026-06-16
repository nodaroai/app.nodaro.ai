/**
 * Quick-preset state derivation — the single source of truth for "what does
 * this preset chip look like right now" across every studio's generation bar
 * (character / object / location / creature).
 *
 * A preset is one of:
 *  - `creating` — a generation for that name is in flight (real OR optimistic).
 *    Takes precedence over `created` so a replace-regenerate (which deletes the
 *    old item the instant it fires) still reads as busy, not idle.
 *  - `created`  — an asset with that name already exists in the tab's grid.
 *  - `idle`     — neither; the chip is clickable.
 *
 * Comparison is case-insensitive: presets are human-friendly labels ("Smile",
 * "Three-Quarter") while stored item names / job names may differ in case.
 * Callers pass already-lowercased sets (see `lowerNameSet`) so the hot render
 * path does no per-call allocation.
 */
export type PresetState = "idle" | "creating" | "created"

export function presetState(
  preset: string,
  createdNames: ReadonlySet<string>,
  busyNames: ReadonlySet<string>,
): PresetState {
  const key = preset.toLowerCase()
  if (busyNames.has(key)) return "creating"
  if (createdNames.has(key)) return "created"
  return "idle"
}

/** Build a lowercased name set from a list of named items (grid contents or
 *  in-flight jobs) for use as the `createdNames` / `busyNames` argument above. */
export function lowerNameSet(items: ReadonlyArray<{ name: string }>): Set<string> {
  return new Set(items.map((i) => i.name.toLowerCase()))
}
