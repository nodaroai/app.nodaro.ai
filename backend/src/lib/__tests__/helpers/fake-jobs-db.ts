/**
 * A tiny in-memory stand-in for the supabase query builder, enough for the
 * deferred child settlement and its sweep: `select` / `update` with `eq`,
 * `in`, `not(col, "is", null)`, `gte`, `order`, `range`, `maybeSingle`,
 * `single`. A column may be a JSON path (`a->b->>c`).
 */
type Row = Record<string, unknown>
type Filter = (row: Row) => boolean

function valueAt(row: Row, column: string): unknown {
  const parts = column.split(/->>?/)
  let value: unknown = row[parts[0]!]
  for (const key of parts.slice(1)) {
    if (value === null || typeof value !== "object") return undefined
    value = (value as Row)[key]
  }
  // `->>` answers text, as Postgres does: a boolean `true` reads "true".
  if (column.includes("->>") && value !== undefined && value !== null && typeof value !== "object") return String(value)
  return value
}

export class FakeDb {
  readonly tables: Record<string, Row[]> = { jobs: [], usage_logs: [] }

  row(table: string, id: string): Row | undefined {
    return this.tables[table]?.find((r) => r.id === id)
  }

  from(table: string) {
    const rows = (this.tables[table] ??= [])
    const filters: Filter[] = []
    let mode: "select" | "update" = "select"
    let patch: Row = {}
    let range: [number, number] | undefined
    let selectAfterUpdate = false
    const matched = () => rows.filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (mode === "update") {
        const hit = matched()
        for (const r of hit) Object.assign(r, structuredClone(patch))
        return { data: selectAfterUpdate ? hit.map((r) => ({ id: r.id })) : null, error: null }
      }
      const hit = matched().map((r) => structuredClone(r))
      return { data: range ? hit.slice(range[0], range[1] + 1) : hit, error: null }
    }
    const builder = {
      select: (_cols?: string) => {
        if (mode === "update") selectAfterUpdate = true
        return builder
      },
      update: (fields: Row) => {
        mode = "update"
        patch = fields
        return builder
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => valueAt(r, col) === val)
        return builder
      },
      in: (col: string, vals: readonly unknown[]) => {
        filters.push((r) => vals.includes(valueAt(r, col)))
        return builder
      },
      not: (col: string, op: string, val: unknown) => {
        if (op !== "is" || val !== null) throw new Error("FakeDb: only not(col, 'is', null)")
        filters.push((r) => valueAt(r, col) !== null && valueAt(r, col) !== undefined)
        return builder
      },
      gte: (col: string, val: string) => {
        filters.push((r) => typeof valueAt(r, col) === "string" && (valueAt(r, col) as string) >= val)
        return builder
      },
      order: () => builder,
      range: (from: number, to: number) => {
        range = [from, to]
        return builder
      },
      maybeSingle: async () => {
        const { data } = run()
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null }
      },
      single: async () => {
        const { data } = run()
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null }
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    }
    return builder
  }
}
