/**
 * Shared separator presets for the Combine Text and Split Text nodes.
 * Single source of truth for both the frontend DAG executor and backend orchestrator.
 */

export const SEPARATOR_PRESETS = [
  "newline",
  "double-newline",
  "comma",
  "space",
  "stars",
  "custom",
] as const

export type SeparatorPreset = (typeof SEPARATOR_PRESETS)[number]

const SPLIT_MAP: Record<string, string> = {
  newline: "\n",
  "double-newline": "\n\n",
  comma: ",",
  space: " ",
  stars: "***",
}

const COMBINE_MAP: Record<string, string> = {
  ...SPLIT_MAP,
  comma: ", ",
}

/** Human-readable label for the node badge. */
export const SEPARATOR_DISPLAY: Record<string, string> = {
  newline: "\\n",
  "double-newline": "\\n\\n",
  comma: ",",
  space: "space",
  stars: "***",
}

export interface ResolveSeparatorOptions {
  /** Use combine-text spacing — e.g. ", " for comma instead of "," */
  combineSpacing?: boolean
}

/**
 * Resolve a separator value to its actual string.
 * - Enum preset → mapped value (e.g. "newline" → "\n")
 * - "custom" → customSeparator field
 * - Anything else → literal string (back-compat with legacy values like "===NEXT===")
 */
export function resolveSeparator(
  raw: string | undefined,
  customSeparator: string | undefined,
  opts?: ResolveSeparatorOptions,
): string {
  const r = raw || "newline"
  if (r === "custom") return customSeparator ?? ""
  const map = opts?.combineSpacing ? COMBINE_MAP : SPLIT_MAP
  return map[r] ?? r
}
