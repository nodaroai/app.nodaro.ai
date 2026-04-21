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

/**
 * If a collected item list has a single entry whose contents parse to a
 * non-empty JSON array, spread the array's elements into separate items.
 * Mirrors the `output.json` spread in the orchestrator so a list node with
 * one row holding a JSON array feeds filter-list / deduplicate / sort-list /
 * merge-lists per-element instead of as one giant stringified blob.
 */
export function spreadJsonArrayIfSingleton(items: string[]): string[] {
  if (items.length !== 1) return items
  const single = items[0]
  if (typeof single !== "string") return items
  const trimmed = single.trim()
  if (!trimmed.startsWith("[")) return items
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return items
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return items
  return parsed.map((el) =>
    typeof el === "string" ? el : JSON.stringify(el),
  )
}
