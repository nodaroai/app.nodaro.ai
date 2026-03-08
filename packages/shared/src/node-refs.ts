/**
 * Node reference pattern and resolution for {Node Label} template syntax.
 * Shared between frontend and backend.
 */

/** Matches {Node Label} references in text. */
export const NODE_REF_PATTERN = /\{([^}]+)\}/g

/** Reserved template variable names that should NOT be resolved as node refs */
const RESERVED_TEMPLATE_VARS = new Set([
  "name",
  "description",
  "userPrompt",
  "assetDescriptions",
  "outputCount",
])

/**
 * Resolve {Node Label} references in text by replacing them with actual node outputs.
 * Skips reserved template variables used by applyTemplate().
 */
export function resolveNodeRefs(
  text: string,
  labelToOutput: Map<string, string>,
): string {
  return text.replace(NODE_REF_PATTERN, (match, label: string) => {
    const trimmed = label.trim()
    if (RESERVED_TEMPLATE_VARS.has(trimmed)) return match
    const output = labelToOutput.get(trimmed)
    return output !== undefined ? output : match
  })
}
