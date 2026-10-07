import { canonicalExposedFieldKey } from "./exposed-field-keys.js"
import { INPUT_FIELD_MAP } from "./presentation-utils.js"

/** What an app's picker card may restrict (stored in `presentationSettings.cardMeta[nodeId]`). */
export interface PickerCardRestrictions {
  readonly pickerAllowedValues?: readonly string[]
  readonly pickerAllowedValuesByField?: Readonly<Record<string, readonly string[]>>
}

// Every submitted value is checked, whatever its type — a number or object where a
// catalog id belongs must be refused, not skipped. An unset / cleared pick ("" , null)
// is no selection and passes (the node falls back to its default).
const valuesOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter((x) => x !== undefined && x !== null && x !== "").map(String)

/**
 * The first submitted picker value an app's card restrictions forbid, as the
 * runner's 400 text; null when all pass. Runs on every app run — `run_app`,
 * the SDK and a hand-built body included — so a restriction is never UI-only.
 * A submitted key is read through `canonicalExposedFieldKey`, so a legacy
 * spelling cannot slip past a restriction written against the current field.
 */
export function findRestrictedPickerValue(input: {
  readonly cardMeta: Readonly<Record<string, PickerCardRestrictions | undefined>> | undefined
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly type?: string }>
  readonly inputValues: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
}): string | null {
  if (!input.cardMeta || !input.inputValues) return null
  for (const node of input.nodes) {
    const meta = input.cardMeta[node.id]
    const submitted = input.inputValues[node.id]
    if (!meta || !submitted) continue
    const rules: Array<[string, readonly string[]]> = []
    const rep = node.type ? INPUT_FIELD_MAP[node.type]?.key : undefined
    if (rep && meta.pickerAllowedValues && meta.pickerAllowedValues.length > 0) rules.push([rep, meta.pickerAllowedValues])
    for (const [field, allowed] of Object.entries(meta.pickerAllowedValuesByField ?? {})) {
      if (allowed.length > 0) rules.push([field, allowed])
    }
    for (const [field, allowed] of rules) {
      for (const [key, raw] of Object.entries(submitted)) {
        if (canonicalExposedFieldKey(node.type, key) !== field) continue
        for (const value of valuesOf(raw)) {
          if (!allowed.includes(value)) return `Invalid value for ${field}: ${value}. Allowed: ${allowed.join(", ")}`
        }
      }
    }
  }
  return null
}
