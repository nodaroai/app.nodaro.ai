/** Delimiter the Generate Text templates instruct the LLM to emit between blocks. */
export const GENERATE_TEXT_DELIMITER = "===NEXT==="

/**
 * Split a Generate Text result into fan-out items. Used by BOTH the frontend
 * extractNodeOutput and the backend output-extractor so single-node and DAG
 * execution produce identical `items`.
 */
export function splitGeneratedItems(text: string | null | undefined): string[] {
  if (!text) return []
  const parts = text.split(GENERATE_TEXT_DELIMITER).map((s) => s.trim()).filter(Boolean)
  if (parts.length > 0) return parts
  const trimmed = text.trim()
  return trimmed ? [trimmed] : []
}
