import { renderStructuredFields, type StructuredPromptFields } from "@nodaro/shared"

/**
 * Combine a free-text prompt with Path-1 structured fields (Phase 6 v1.1).
 *
 * Returns the composite prompt that gets passed through to the underlying route.
 * If no structured fields are provided, returns `prompt` unchanged.
 */
export function buildCompositePrompt(
  prompt: string,
  structured: StructuredPromptFields | undefined,
): string {
  if (!structured) return prompt
  const fragment = renderStructuredFields(structured)
  if (!fragment) return prompt
  return `${prompt} ${fragment}`.trim()
}
