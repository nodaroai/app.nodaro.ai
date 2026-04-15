/**
 * Helpers for reading a node's accumulated `generatedResults` array.
 *
 * Used by both frontend DAG executor (`node-input-resolver.ts`) and backend
 * orchestrator (`output-extractor.ts`) so they agree on when a node has
 * upstream-consumable output.
 */

/**
 * Extract all output values from a node's accumulated generatedResults.
 * Returns the full flat list (any length). Returns undefined only when empty.
 */
export function extractAllGeneratedResults(
  data: Record<string, unknown>,
): string[] | undefined {
  const results = data.generatedResults as
    | Array<{ url?: string; text?: string }>
    | undefined
  if (!results || results.length === 0) return undefined
  const outputs = results
    .map((r) => r.url || r.text || "")
    .filter((v) => v.length > 0)
  return outputs.length > 0 ? outputs : undefined
}
