/**
 * Split text using a loop node's column delimiter.
 *
 * Uses the first text-type column's `splitDelimiter` to determine
 * how to split upstream text. Falls back to newline when no delimiter
 * is configured. The "first text column wins" heuristic is intentional:
 * connected mode pipes a single text stream into the loop, so we use
 * the primary text column's delimiter as the split strategy.
 */
export function splitByLoopDelimiter(
  text: string,
  columns: ReadonlyArray<{ type?: string; splitDelimiter?: string }> | undefined,
): string[] {
  const firstTextCol = (columns ?? []).find((c) => (c.type ?? "text") === "text")
  const delimiter = firstTextCol?.splitDelimiter ?? "\n"
  return text.split(delimiter).map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * Split pasted (or manually-triggered) text into rows, inserting below
 * the source row. Returns the new rows array and truncation metadata.
 *
 * Pure function — callers handle persisting the result and showing toasts.
 */
export function spliceDelimitedRows(
  rows: readonly (readonly string[])[],
  rowIndex: number,
  colIndex: number,
  pastedText: string,
  delimiter: string,
  columnCount: number,
  maxItems: number,
): { newRows: string[][]; truncated: boolean; totalProduced: number } {
  const parts = pastedText.split(delimiter).map((s) => s.trim()).filter((s) => s.length > 0)
  if (parts.length <= 1) {
    // Nothing to split — return rows unchanged with first part (or original) in cell
    const newRows = rows.map((r) => [...r])
    if (parts.length === 1) newRows[rowIndex][colIndex] = parts[0]
    return { newRows, truncated: false, totalProduced: newRows.length }
  }

  const newRows = rows.map((r) => [...r])
  newRows[rowIndex][colIndex] = parts[0]
  const insertRows = parts.slice(1).map((part) => {
    const r = Array.from<string>({ length: columnCount }).fill("")
    r[colIndex] = part
    return r
  })
  newRows.splice(rowIndex + 1, 0, ...insertRows)

  const truncated = newRows.length > maxItems
  const totalProduced = newRows.length
  return {
    newRows: truncated ? newRows.slice(0, maxItems) : newRows,
    truncated,
    totalProduced,
  }
}
