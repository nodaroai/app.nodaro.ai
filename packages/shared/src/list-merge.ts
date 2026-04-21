import { tryParseJson } from "./filter-condition.js"

/**
 * Element-wise merge across upstream lists with modulo-wrap.
 *
 * Used by the `merge-lists` node's "zip" mode. Each output position i takes
 * `lists[j][i % lists[j].length]` from every input; JSON objects are spread
 * into a single object (later sources override earlier ones on key conflicts),
 * non-object items are stringified and concatenated.
 *
 * Length semantics mirror the DAG's existing fan-out behavior: the result
 * length equals `max(len)` across non-empty inputs. Shorter inputs cycle.
 * This means a single-item upstream (e.g. a JSON-process node emitting one
 * object, or a list with one row) is automatically injected into every
 * element of a longer list.
 */
export function zipMergeLists(lists: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const nonEmpty = lists.filter((l) => l.length > 0)
  if (nonEmpty.length === 0) return []
  if (nonEmpty.length === 1) return [...nonEmpty[0]]

  const maxLen = Math.max(...nonEmpty.map((l) => l.length))
  const out: string[] = []
  for (let i = 0; i < maxLen; i++) {
    const merged: Record<string, unknown> = {}
    const rawItems: string[] = []
    let hasObject = false
    for (const list of nonEmpty) {
      const item = list[i % list.length]
      rawItems.push(item)
      const parsed = tryParseJson(item)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        hasObject = true
        Object.assign(merged, parsed as Record<string, unknown>)
      }
    }
    out.push(hasObject ? JSON.stringify(merged) : rawItems.join(""))
  }
  return out
}
