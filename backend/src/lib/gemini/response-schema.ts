/**
 * The caller's JSON Schema → the one Google is asked to decode against.
 *
 * `responseJsonSchema` is compiled into a constrained decoder with a state
 * budget, and an array cap multiplies that budget by its bound. A schema that
 * nests a few of them is refused before any token is produced: a bare
 * `400 INVALID_ARGUMENT` that names no keyword, reports no usage, and is
 * identical on every retry. Measured 2026-09-18 on `gemini-3.7-flash` with the
 * scene3d video-reference schema (caps of 32 × 24, 48 and 24): removing ONLY
 * `maxItems` turned the refusal into a ~7 s answer that passed the caller's
 * Zod. `minItems`, `minLength`/`maxLength`, `minimum`/`maximum` and
 * `additionalProperties` were each varied alone and do not contribute, so they
 * stay — they steer the decoder toward a valid answer at no such cost.
 *
 * Withholding the cap does not drop it. `llmCompleteStructured` validates every
 * answer against the caller's Zod schema, which still carries it; the wire
 * schema only ever needed to be a SUPERSET of what the caller accepts.
 *
 * Done here rather than per schema so no caller has to know this about one
 * lane: a plugin's schema is also its request fingerprint and its contract on
 * the KIE and Anthropic lanes, none of which share this limit.
 */

/** Keywords withheld from Google. Closed and measured — extend it with a repro, not a guess. */
const WITHHELD_KEYWORDS: ReadonlySet<string> = new Set(["maxItems"])

/**
 * Keywords whose value is a map of NAME → subschema. Its keys are the caller's
 * own identifiers, so a property called `maxItems` must survive; only the
 * subschemas beneath it are rewritten.
 */
const NAME_KEYED: ReadonlySet<string> = new Set(["properties", "patternProperties", "definitions", "$defs", "dependencies"])

/**
 * The decoder's budget also counts ENUM VALUES, across the whole schema: the
 * five-picker analyzer schema (53 enums, 1,101 ids) is refused the same way,
 * and so is any cut of it that keeps too many ids in total — with every enum
 * capped at 64 values (916 ids) or only the two largest withheld (815) it is
 * still a 400; with the three largest withheld (727) or four (660) it answers
 * in 7–10 s (measured 2026-10-08 on `gemini-3.8-flash`). A per-enum cap does
 * not describe it; a total does, somewhere between 727 and 815. So the wire schema withholds whole `enum` lists,
 * largest first, until the total fits: a withheld list leaves a plain string
 * behind, the prompt's legend still names every id, and the caller's Zod
 * still enforces the full list on the answer.
 */
export const GEMINI_ENUM_VALUE_BUDGET = 700

export function toGeminiResponseSchema(schema: unknown): unknown {
  return withholdEnumsOverBudget(rewrite(schema, false), GEMINI_ENUM_VALUE_BUDGET)
}

/** Withhold `enum` lists, largest first, until their values total at most `budget`. Mutates and returns `schema`. */
export function withholdEnumsOverBudget(schema: unknown, budget: number): unknown {
  const carriers: Array<Record<string, unknown> & { enum: unknown[] }> = []
  collectEnumCarriers(schema, false, carriers)
  let total = carriers.reduce((n, c) => n + c.enum.length, 0)
  carriers.sort((a, b) => b.enum.length - a.enum.length)
  for (const carrier of carriers) {
    if (total <= budget) break
    total -= carrier.enum.length
    delete (carrier as Record<string, unknown>).enum
  }
  return schema
}

function collectEnumCarriers(node: unknown, keysAreNames: boolean, out: Array<Record<string, unknown> & { enum: unknown[] }>): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectEnumCarriers(entry, false, out)
    return
  }
  if (node === null || typeof node !== "object") return
  const obj = node as Record<string, unknown>
  if (!keysAreNames && Array.isArray(obj.enum)) out.push(obj as Record<string, unknown> & { enum: unknown[] })
  for (const [key, value] of Object.entries(obj)) {
    if (!keysAreNames && key === "enum") continue
    collectEnumCarriers(value, !keysAreNames && NAME_KEYED.has(key), out)
  }
}

function rewrite(node: unknown, keysAreNames: boolean): unknown {
  if (Array.isArray(node)) return node.map((entry) => rewrite(entry, false))
  if (node === null || typeof node !== "object") return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (!keysAreNames && WITHHELD_KEYWORDS.has(key)) continue
    out[key] = rewrite(value, !keysAreNames && NAME_KEYED.has(key))
  }
  return out
}
