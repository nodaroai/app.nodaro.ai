/**
 * Evaluate a dot-notation path against a JSON value.
 *
 * Auto-iterates arrays at any depth: if the current value is an array,
 * the evaluator iterates and applies the remaining path to each element,
 * flattening results. This lets simple paths like "caption" work on a
 * top-level array and "pages.markdown" work on a nested array without
 * any wildcard syntax.
 *
 * Returns an array of values. Missing properties are skipped (empty for
 * that branch). Null/undefined leaf values are included — callers coerce.
 * Empty path returns `[value]` (a single-element array wrapping the
 * value) when the value is scalar/object, or the array elements flat
 * when the root is an array.
 */
export function evaluateJsonPath(value: unknown, path: string): unknown[] {
  const segments = path.length === 0 ? [] : path.split(".")
  return walk(value, segments, 0)
}

/**
 * Coerce an array of unknown values (typically from evaluateJsonPath) to
 * strings, skipping null/undefined.  Primitives are stringified; objects
 * are JSON-encoded.
 */
export function stringifyPathResults(raw: unknown[]): string[] {
  const out: string[] = []
  for (const v of raw) {
    if (v === null || v === undefined) continue
    if (typeof v === "string") out.push(v)
    else if (typeof v === "number" || typeof v === "boolean") out.push(String(v))
    else out.push(JSON.stringify(v))
  }
  return out
}

function walk(value: unknown, segments: string[], offset: number): unknown[] {
  if (Array.isArray(value)) {
    const results: unknown[] = []
    for (const item of value) {
      for (const v of walk(item, segments, offset)) results.push(v)
    }
    return results
  }
  if (offset >= segments.length) return [value]
  if (value !== null && typeof value === "object") {
    const head = segments[offset]
    if (!Object.hasOwn(value as object, head)) return []
    return walk((value as Record<string, unknown>)[head], segments, offset + 1)
  }
  return []
}
