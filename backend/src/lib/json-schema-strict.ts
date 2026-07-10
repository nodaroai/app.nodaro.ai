/**
 * Restore `additionalProperties: false` on plain object nodes of a generated
 * JSON schema.
 *
 * Why: zod-to-json-schema (zod 3 era) emitted `additionalProperties: false`
 * for every `z.object()`. zod 4's native `z.toJSONSchema` omits it for
 * strip-mode objects (they silently drop unknown keys rather than reject, so
 * v4 considers the looser schema more honest). Parse behavior is identical —
 * but these schemas are LLM tool definitions: `additionalProperties: false`
 * is what steers the model away from inventing junk keys. Losing it is a
 * silent prompt-contract loosening (caught by the migration's snapshot diff),
 * so we put it back.
 *
 * Only touches object nodes that don't already declare `additionalProperties`
 * — `z.looseObject()/.passthrough()` (emits `additionalProperties: {}`) and
 * `z.record()` (uses `additionalProperties` for the value schema) keep their
 * semantics.
 */
export function restrictObjectSchemas<T>(schema: T): T {
  walk(schema)
  return schema
}

function walk(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item)
    return
  }
  if (!node || typeof node !== "object") return
  const obj = node as Record<string, unknown>

  if (obj.type === "object" && obj.properties && obj.additionalProperties === undefined) {
    obj.additionalProperties = false
  }

  // Recurse into every carrier of subschemas (draft-7 + openapi-3.0 shapes).
  for (const key of [
    "properties",
    "items",
    "prefixItems",
    "additionalProperties",
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "if",
    "then",
    "else",
    "$defs",
    "definitions",
    "patternProperties",
  ]) {
    const v = obj[key]
    if (v && typeof v === "object") {
      if (key === "properties" || key === "$defs" || key === "definitions" || key === "patternProperties") {
        for (const sub of Object.values(v as Record<string, unknown>)) walk(sub)
      } else {
        walk(v)
      }
    }
  }
}
