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

/**
 * Extract a JSON array (e.g. web-scrape `generatedJson`) as a list of strings.
 * Each array element is stringified; already-string elements pass through.
 */
export function extractGeneratedJsonAsList(
  data: Record<string, unknown>,
): string[] | undefined {
  const jsonArr = data.generatedJson
  if (!Array.isArray(jsonArr) || jsonArr.length === 0) return undefined
  return jsonArr.map((item: unknown) =>
    typeof item === "string" ? item : JSON.stringify(item),
  )
}
