/**
 * A ROW-LIST insert into `model_pricing`, read the way the migration-sync
 * suites read a plain `INSERT … VALUES`:
 *
 *   INSERT INTO model_pricing (model_identifier, credit_cost, is_enabled, …)
 *   SELECT r.model_identifier, r.credit_cost, <anything>, …
 *   FROM (VALUES ('id', 20, …), …) AS r(model_identifier, credit_cost, …)
 *   LEFT JOIN model_pricing AS b ON …
 *   ON CONFLICT (model_identifier) DO NOTHING
 *
 * Its ids and prices are literals as surely as a VALUES list's — the select
 * list takes `model_identifier` and `credit_cost` straight from the literal
 * rows (`<alias>.<column>`) — while its other columns may be read from rows
 * the database already holds. Migration 590 is one: each per-second Video
 * Depth row takes its switches (`is_enabled`, `tier_restriction`, `category`)
 * from the bucket row that priced that second before, so a model an
 * administrator switched off does not come back on through its new rows.
 *
 * Shared by `static-costs-match-migrations.test.ts` and
 * `credit-pricing-migration-sync.test.ts` so the two read the shape the same
 * way. An INSERT … SELECT that BUILDS its ids (migration 419's
 * `base.model_identifier || ':' || tier.name`) is not a row-list insert:
 * `rowListInsert` answers null for it, and it stays a derived insert.
 */

/** One literal row: its id, and its price (`"unknown"` when not a plain number). */
export interface RowListEntry {
  readonly id: string
  readonly cost: number | "unknown"
}

export interface RowListInsert {
  readonly rows: readonly RowListEntry[]
  /** The statement's `ON CONFLICT …` clause; empty when it has none. */
  readonly conflict: string
}

/** Splits `text` on `separator` at depth 0, outside single-quoted strings. */
function splitTopLevel(text: string, separator: string): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let cur = ""
  for (const ch of text) {
    if (ch === "'") quoted = !quoted
    if (!quoted && ch === "(") depth++
    if (!quoted && ch === ")") depth--
    if (!quoted && depth === 0 && ch === separator) {
      out.push(cur.trim())
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** The top-level `( … )` tuples of a VALUES list, each split into its values. */
function tuplesOf(values: string): string[][] {
  return splitTopLevel(values, ",")
    .map((tuple) => /^\(([\s\S]*)\)$/.exec(tuple)?.[1])
    .filter((inner): inner is string => inner !== undefined)
    .map((inner) => splitTopLevel(inner, ","))
}

const SHAPE =
  /^\s*INSERT\s+INTO\s+(?:public\.)?model_pricing\s*\(([^)]*)\)\s*SELECT\s+([\s\S]*?)\s+FROM\s*\(\s*VALUES\s*([\s\S]*?)\)\s*AS\s+(\w+)\s*\(([^)]*)\)([\s\S]*)$/i

/**
 * The literal rows of a row-list insert, or null when `statement` is not one
 * (a plain VALUES insert, a derived INSERT … SELECT, anything else).
 */
export function rowListInsert(statement: string): RowListInsert | null {
  const shape = SHAPE.exec(statement)
  if (!shape) return null
  const [, insertColumns, selectList, values, alias, aliasColumns, rest] = shape
  const columns = insertColumns!.split(",").map((c) => c.trim().toLowerCase())
  const expressions = splitTopLevel(selectList!, ",")
  if (expressions.length !== columns.length) return null
  const rowColumns = aliasColumns!.split(",").map((c) => c.trim().toLowerCase())
  /** The literal-row column `column` is taken from, or -1 when it is not taken straight from one. */
  const rowColumnOf = (column: string): number => {
    const expression = expressions[columns.indexOf(column)]
    const direct = expression ? new RegExp(`^${alias}\\.(\\w+)$`, "i").exec(expression) : null
    return direct ? rowColumns.indexOf(direct[1]!.toLowerCase()) : -1
  }
  const idAt = rowColumnOf("model_identifier")
  if (idAt < 0) return null
  const costAt = rowColumnOf("credit_cost")
  const rows: RowListEntry[] = []
  for (const tuple of tuplesOf(values!)) {
    const id = /^'([^']*)'$/.exec(tuple[idAt] ?? "")?.[1]
    if (id === undefined) return null
    const cost = costAt < 0 ? "unknown" : /^\d+$/.test(tuple[costAt] ?? "") ? Number(tuple[costAt]) : "unknown"
    rows.push({ id, cost })
  }
  return { rows, conflict: /ON\s+CONFLICT[\s\S]*$/i.exec(rest!)?.[0] ?? "" }
}
