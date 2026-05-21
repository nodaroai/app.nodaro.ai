import pc from "picocolors"

// Lightweight output utilities. We intentionally don't pull in a table-rendering
// library — pad-to-column-width handles the volumes we care about and keeps the
// install footprint tiny.

export interface OutputOpts {
  json?: boolean
}

export function emit(value: unknown, opts: OutputOpts = {}): void {
  if (opts.json) {
    // Pretty-print only when stdout is a TTY. When piped to `jq`, a file, or
    // another process, we emit compact JSON to avoid wasted bytes (~30%
    // smaller for large payloads) + cheaper JSON.stringify.
    const indent = process.stdout.isTTY ? 2 : undefined
    process.stdout.write(JSON.stringify(value, null, indent) + "\n")
  }
}

/**
 * Pretty-print a detail record for human consumption. Used by `get`-style
 * commands that don't fit the tabular `table()` shape. Always pretty-prints
 * (the human path doesn't care about pipe-friendly compactness — that's what
 * `--json` is for).
 *
 * Shared across get commands in objects / locations / characters / jobs /
 * workflows / apps / nodes / projects.
 */
export function detail(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

export function success(line: string): void {
  console.log(pc.green("✓") + " " + line)
}

export function info(line: string): void {
  console.log(line)
}

export function dim(line: string): void {
  console.log(pc.dim(line))
}

export function warn(line: string): void {
  console.error(pc.yellow("⚠") + " " + line)
}

export function table(rows: Array<Record<string, unknown>>, columns: string[]): void {
  if (rows.length === 0) {
    console.log(pc.dim("(empty)"))
    return
  }
  const widths: Record<string, number> = {}
  for (const col of columns) widths[col] = col.length
  for (const row of rows) {
    for (const col of columns) {
      const cell = format(row[col])
      if (cell.length > widths[col]) widths[col] = cell.length
    }
  }
  // Cap any single column at 60 chars so a runaway value doesn't blow up the layout.
  for (const col of columns) widths[col] = Math.min(widths[col], 60)

  console.log(columns.map((c) => pc.bold(c.padEnd(widths[c]))).join("  "))
  console.log(columns.map((c) => "-".repeat(widths[c])).join("  "))
  for (const row of rows) {
    console.log(
      columns
        .map((c) => {
          const cell = format(row[c])
          return cell.length > widths[c] ? cell.slice(0, widths[c] - 1) + "…" : cell.padEnd(widths[c])
        })
        .join("  "),
    )
  }
}

function format(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value)
}
