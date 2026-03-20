/**
 * Edge range utilities for resolving 1-based index expressions
 * and applying range/step slicing to output lists.
 *
 * Used by both frontend DAG executor and backend orchestrator
 * to support edge-level range, step, and item selection.
 */

/**
 * Resolves a 1-based index expression to a 0-based array index.
 *
 * Supported expressions:
 * - "1", "2", ... — absolute 1-based index
 * - "last" — last element
 * - "last-1", "last-2", ... — relative from end
 *
 * Out-of-bounds values are clamped. Malformed input falls back to `defaultExpr`.
 */
export function resolveIndex(
  expr: string,
  listLength: number,
  defaultExpr: string = "1",
): number {
  if (listLength <= 0) return 0

  const trimmed = expr.trim()
  let index: number

  if (trimmed === "last") {
    index = listLength - 1
  } else if (trimmed.startsWith("last-")) {
    const offset = parseInt(trimmed.slice(5), 10)
    if (isNaN(offset) || offset < 0) return resolveIndex(defaultExpr === expr ? "1" : defaultExpr, listLength)
    index = listLength - 1 - offset
  } else {
    const n = parseInt(trimmed, 10)
    if (isNaN(n)) return resolveIndex(defaultExpr === expr ? "1" : defaultExpr, listLength)
    index = n - 1
  }

  return Math.max(0, Math.min(index, listLength - 1))
}

/**
 * Applies range and step slicing to a list of strings.
 *
 * `from` and `to` are 1-based index expressions (see `resolveIndex`).
 * `step` controls iteration direction and stride:
 * - positive step: forward iteration (from must be <= to)
 * - negative step: reverse iteration (from must be >= to)
 * - step 0 is treated as step 1
 *
 * Returns empty array if direction mismatches (e.g., from < to with negative step).
 */
export function applyRange(
  list: string[],
  from?: string,
  to?: string,
  step?: number,
): string[] {
  if (list.length === 0) return []

  const fromIdx = resolveIndex(from ?? "1", list.length, "1")
  const toIdx = resolveIndex(to ?? "last", list.length, "last")
  const effectiveStep = step === 0 || step === undefined ? 1 : step

  if (effectiveStep > 0 && fromIdx > toIdx) return []
  if (effectiveStep < 0 && fromIdx < toIdx) return []

  const result: string[] = []
  if (effectiveStep > 0) {
    for (let i = fromIdx; i <= toIdx; i += effectiveStep) result.push(list[i])
  } else {
    for (let i = fromIdx; i >= toIdx; i += effectiveStep) result.push(list[i])
  }
  return result
}

/**
 * Migrates legacy `item:N` (0-based) outputMode to structured format.
 *
 * Legacy: `{ outputMode: "item:0" }` — 0-based index baked into mode string
 * New:    `{ outputMode: "item", itemIndex: "1" }` — 1-based expression
 *
 * Returns the data unchanged if not a legacy item mode.
 */
export function migrateEdgeOutputMode(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return data

  const mode = data.outputMode as string | undefined
  if (!mode || !mode.startsWith("item:")) return data

  const idx = parseInt(mode.split(":")[1], 10)
  return {
    ...data,
    outputMode: "item",
    itemIndex: String(isNaN(idx) ? 1 : idx + 1),
  }
}

/**
 * Builds a human-readable label for edge range configuration.
 *
 * Returns `undefined` when the configuration matches defaults (no label needed).
 *
 * Examples:
 * - "2..last-1"     — range from 2 to last-1
 * - "2..last-1 +2"  — with step 2
 * - "last..1 -1"    — reversed
 * - "3"             — item mode, index 3
 */
export function buildRangeLabel(
  mode: string,
  rangeFrom?: string,
  rangeTo?: string,
  rangeStep?: number,
  itemIndex?: string,
): string | undefined {
  if (mode === "last") return undefined

  if (mode === "item") return itemIndex || undefined

  // For "each" and "all" modes — build range label if non-default
  const from = rangeFrom ?? "1"
  const to = rangeTo ?? "last"
  const step = rangeStep ?? 1

  const isDefaultRange = from === "1" && to === "last"
  const isDefaultStep = step === 1

  if (isDefaultRange && isDefaultStep) return undefined

  let label = `${from}..${to}`
  if (mode === "each" && !isDefaultStep) {
    label += step > 0 ? ` +${step}` : ` ${step}`
  }
  return label
}
