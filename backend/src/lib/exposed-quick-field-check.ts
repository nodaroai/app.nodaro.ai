/**
 * App fields derived from a node's quick-strip control (the editor's `exposable-fields.ts`): what the server
 * knows about each, from the table generated off the strip (`mcp/generated/exposable-quick-fields.ts`).
 *
 * A run is held only to a FIXED list (the same values whatever else the node is set to) and to a custom range.
 * A provider-aware list (a resolution, an aspect, a duration that depends on the model) is the union across
 * every model there; holding a run to it would refuse nothing useful, and what one model takes is the route's
 * enum and the payload normalizer's to decide.
 */
import { canonicalExposedFieldKey } from "@nodaro/shared"
import { EXPOSABLE_QUICK_FIELDS, type ExposableQuickFieldSpec } from "./mcp/generated/exposable-quick-fields.js"

/** The spec of a strip-derived app field, by the key the app stored (a renamed field's old spelling included). */
export function exposedQuickFieldSpec(nodeType: string | undefined, storedKey: string): ExposableQuickFieldSpec | undefined {
  if (!nodeType || !Object.hasOwn(EXPOSABLE_QUICK_FIELDS, nodeType)) return undefined
  const fields = EXPOSABLE_QUICK_FIELDS[nodeType]!
  const key = canonicalExposedFieldKey(nodeType, storedKey)
  return Object.hasOwn(fields, key) ? fields[key] : undefined
}

/** Why a submitted value for a strip-derived field is refused, or null when it is accepted (or not ours to check). */
export function quickFieldRefusal(nodeType: string | undefined, storedKey: string, submitted: unknown): string | null {
  // null clears the field (the run then has no value there): nothing to hold to a list.
  if (submitted === null) return null
  const spec = exposedQuickFieldSpec(nodeType, storedKey)
  if (!spec?.fixed) return null
  if (spec.values.includes(submitted as string | number | boolean)) return null
  if (spec.min !== undefined && spec.max !== undefined) {
    if (typeof submitted === "number" && Number.isFinite(submitted) && submitted >= spec.min && submitted <= spec.max) return null
    return `Invalid value for ${storedKey}: ${String(submitted)}. Use a number between ${spec.min} and ${spec.max}.`
  }
  return `Invalid value for ${storedKey}: ${String(submitted)}. Allowed: ${spec.values.join(", ")}`
}
