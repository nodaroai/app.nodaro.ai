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

/**
 * Keywords Anthropic's STRICT tool mode does not accept (vendor docs: numeric
 * and string-length constraints, and array constraints beyond `minItems` 0/1).
 * Sending one under `strict: true` is a 400, not a softer guarantee — so the
 * wire schema withholds them and the caller's own Zod enforces them on the
 * answer, the same split `lib/gemini/response-schema.ts` makes for `maxItems`.
 * `pattern` is withheld too: the strict regex dialect is a subset, and a
 * rejected pattern would fail every call carrying that schema.
 */
const STRICT_WITHHELD_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems",
  "uniqueItems",
] as const

/**
 * The wire schema for an Anthropic tool sent with `strict: true`, or
 * `undefined` when the schema cannot be expressed in the strict subset at all
 * and must go WITHOUT `strict` (the model still sees the full schema).
 *
 * Not expressible (→ `undefined`): any `$ref` (strict mode refuses recursive
 * schemas, and telling a recursive ref from a shared one is not worth the
 * risk), and any object whose `additionalProperties` is not `false` — a
 * `z.record()` map or a `.passthrough()` object, which strict mode cannot
 * carry. Every other object gets `additionalProperties: false`, which strict
 * mode requires on all objects.
 *
 * Returns a deep copy; the input is never mutated.
 */
/**
 * Strict mode also refuses a schema with more than this many OPTIONAL
 * properties, counted across every object in it ("Schemas contains too many
 * optional parameters (61) … (limit: 24)" — measured 2026-10-08 on Opus 5.5
 * with describe-to-picker's five-picker schema, a 400 on every call). Such a
 * schema goes without `strict`, like one strict mode cannot express.
 */
export const STRICT_OPTIONAL_LIMIT = 24

export function anthropicStrictToolSchema(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  if (countOptionalProperties(schema) > STRICT_OPTIONAL_LIMIT) return undefined
  const copy = structuredClone(schema)
  return strictWalk(copy) ? copy : undefined
}

/** Every property not named in its object's `required`, over the whole schema. */
export function countOptionalProperties(node: unknown): number {
  if (Array.isArray(node)) return node.reduce<number>((n, item) => n + countOptionalProperties(item), 0)
  if (!node || typeof node !== "object") return 0
  const obj = node as Record<string, unknown>
  let count = 0
  const properties = obj.properties
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const required = new Set(Array.isArray(obj.required) ? (obj.required as unknown[]) : [])
    count += Object.keys(properties as Record<string, unknown>).filter((key) => !required.has(key)).length
  }
  for (const [key, v] of Object.entries(obj)) {
    if (!v || typeof v !== "object") continue
    if (key === "properties" || key === "$defs" || key === "definitions" || key === "patternProperties") {
      count += Object.values(v as Record<string, unknown>).reduce<number>((n, sub) => n + countOptionalProperties(sub), 0)
    } else if (key !== "enum" && key !== "const" && key !== "default" && key !== "examples") {
      count += countOptionalProperties(v)
    }
  }
  return count
}

function strictWalk(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(strictWalk)
  if (!node || typeof node !== "object") return true
  const obj = node as Record<string, unknown>

  if ("$ref" in obj) return false
  const isObject = obj.type === "object" || (obj.properties !== undefined && obj.type === undefined)
  if (isObject) {
    if (obj.additionalProperties === undefined) obj.additionalProperties = false
    else if (obj.additionalProperties !== false) return false
  }
  for (const key of STRICT_WITHHELD_KEYWORDS) delete obj[key]
  if (typeof obj.minItems === "number" && obj.minItems > 1) delete obj.minItems

  for (const [key, v] of Object.entries(obj)) {
    if (!v || typeof v !== "object") continue
    if (key === "properties" || key === "$defs" || key === "definitions" || key === "patternProperties") {
      if (!Object.values(v as Record<string, unknown>).every(strictWalk)) return false
    } else if (key !== "enum" && key !== "const" && key !== "default" && key !== "examples") {
      if (!strictWalk(v)) return false
    }
  }
  return true
}
