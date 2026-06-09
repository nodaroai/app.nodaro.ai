/**
 * Node reference pattern and resolution for {Node Label} template syntax.
 * Shared between frontend and backend.
 */

/** Matches {Node Label} references in text. */
export const NODE_REF_PATTERN = /\{([^}]+)\}/g

/** Reserved template variable names that should NOT be resolved as node refs */
export const RESERVED_TEMPLATE_VARS = new Set([
  "name",
  "description",
  "userPrompt",
  "assetDescriptions",
  "outputCount",
])

/**
 * Split a `{...}` token body into its node name and optional fallback. Splits on the FIRST `||`
 * (a fallback may itself contain `||`); both sides are trimmed. `fallback` is null when there is
 * no `||`, preserving the legacy "leave the literal token" behavior.
 *   "person || man" -> { name: "person", fallback: "man" }
 *   "person || "    -> { name: "person", fallback: "" }     (resolves to empty when absent)
 *   "person"        -> { name: "person", fallback: null }   (literal {person} when absent)
 */
export function parseNodeRef(raw: string): { name: string; fallback: string | null } {
  const i = raw.indexOf("||")
  if (i === -1) return { name: raw.trim(), fallback: null }
  return { name: raw.slice(0, i).trim(), fallback: raw.slice(i + 2).trim() }
}

/**
 * Resolve {Node Label} references in text by replacing them with actual node outputs.
 * Skips reserved template variables used by applyTemplate().
 * Iterates until stable to handle nested refs (e.g. {List} → {Animal1} → "dog").
 */
export function resolveNodeRefs(
  text: string,
  labelToOutput: ReadonlyMap<string, string>,
): string {
  const MAX_PASSES = 10
  let result = text
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = result.replace(NODE_REF_PATTERN, (match, raw: string) => {
      const { name, fallback } = parseNodeRef(raw)
      if (RESERVED_TEMPLATE_VARS.has(name)) return match
      const output = labelToOutput.get(name)
      if (output !== undefined) return output            // connected, non-empty output → its value
      if (fallback !== null) return fallback             // absent/empty + fallback → default ("" for {name || })
      return match                                       // absent + no || → literal {name}
    })
    if (next === result) break
    result = next
  }
  return result
}
