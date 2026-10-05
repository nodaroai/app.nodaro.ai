import { ownsItsList } from "@nodaro/shared"

/**
 * Whether the settings panel lists a node's per-item results: it ran once per
 * item of a list (more than one) and still holds results to show.
 *
 * Never for Extract Field or JSON Process: their `__listResults` is the list
 * they produce, not one result per item, and the results beside it were a
 * history only earlier builds' server runs wrote (`ownsItsList`, @nodaro/shared).
 */
export function iterationResultsShown(nodeType: string | null | undefined, data: Readonly<Record<string, unknown>>): boolean {
  if (ownsItsList(nodeType)) return false
  const listResults = data.__listResults
  const results = data.generatedResults
  return Array.isArray(listResults) && listResults.length > 1 && Array.isArray(results) && results.length > 0
}
