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
    const next = result.replace(NODE_REF_PATTERN, (match, label: string) => {
      const trimmed = label.trim()
      if (RESERVED_TEMPLATE_VARS.has(trimmed)) return match
      const output = labelToOutput.get(trimmed)
      return output !== undefined ? output : match
    })
    if (next === result) break
    result = next
  }
  return result
}
