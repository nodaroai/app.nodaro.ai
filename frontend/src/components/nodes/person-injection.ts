import { buildPickerAnalyzerSpec, applyPickerJson, type PickerApplyMode } from "@nodaro/shared"
import type { PersonData } from "@/types/nodes"

// Spec is catalog-derived and stable — build once at module level.
const PERSON_SPEC = buildPickerAnalyzerSpec("person")

/** Order-independent canonical key for change detection. Two picker-JSON
 *  objects with the same dimension keys/values produce the same key regardless
 *  of property insertion order. `undefined` maps to the empty string. */
export function pickerJsonKey(json: Record<string, unknown> | undefined): string {
  if (!json) return ""
  const keys = Object.keys(json).sort()
  return JSON.stringify(keys.map((k) => [k, json[k]]))
}

/** Build the `updateNodeData` patch (dimension fields + `lastAppliedPickerJson`)
 *  to apply injected picker JSON into a Person node, per the chosen mode. */
export function computeInjectionPatch(
  current: PersonData,
  injected: Record<string, unknown>,
  mode: PickerApplyMode,
): Record<string, unknown> {
  const patch = applyPickerJson(current as Record<string, unknown>, injected, mode, PERSON_SPEC)
  patch.lastAppliedPickerJson = injected
  return patch
}
