// @test-units-by-name it names no node unit
/**
 * An in-memory stand-in for the few PostgREST calls the routed-video modules
 * make (`from(table)` → select / insert / upsert / update / delete, the
 * filters eq / neq / is / in / gt / gte / lt / lte — JSON paths such as
 * `detail->>billedAt` included — order, limit, range, maybeSingle, a head
 * count), so a test runs the REAL ledger, resolve and settlement modules over
 * one table instead of mocking each read. `video_route_ledger` keeps its
 * unique (job_id, kind, send, key) and answers 23505 like the database.
 * Every write stamps `updated_at` from the fake's clock, strictly later each
 * time, in the database's own `+00:00` spelling.
 */
type Row = Record<string, unknown>

export interface FakeTables {
  readonly tables: Record<string, Row[]>
  /** The client to hand a `supabase` mock (`{ from }`). */
  readonly client: { from(table: string): unknown; rpc(name: string, args?: unknown): Promise<{ data: unknown; error: unknown }> }
  /** Rows of `table` matching `where` (a shallow equality). */
  rows(table: string, where?: Row): Row[]
  /** Makes the next write to `table` whose patch passes `when` fail as a database error. */
  failNextWrite(table: string, when?: (patch: Row) => boolean): void
}

const UNIQUE: Record<string, readonly string[]> = { video_route_ledger: ["job_id", "kind", "send", "key"] }
const DEFAULTS: Record<string, Row> = { video_route_ledger: { send: 1, key: "", attempts: 0, detail: null, outcome: null, decision: null, state: null, next_attempt_at: null } }

/** A column or JSON path (`a->b->>c`) of a row. */
function valueAt(row: Row, path: string): unknown {
  const parts = path.split(/->>?/)
  let v: unknown = row
  for (const p of parts) v = v && typeof v === "object" ? (v as Row)[p] : undefined
  return v
}

const cmp = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b))
}

export function createFakeTables(seed: Record<string, Row[]> = {}, opts: { now?: () => number } = {}): FakeTables {
  const tables: Record<string, Row[]> = {}
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }))
  let ids = 1000
  let lastStamp = 0
  const failing: Record<string, ((patch: Row) => boolean) | undefined> = {}
  const stamp = (): string => {
    lastStamp = Math.max((opts.now ?? Date.now)(), lastStamp + 1)
    return new Date(lastStamp).toISOString().replace("Z", "+00:00")
  }
  const table = (t: string): Row[] => (tables[t] ??= [])
  const clash = (t: string, row: Row, except?: Row): Row | undefined => {
    const cols = UNIQUE[t]
    if (!cols) return undefined
    return table(t).find((r) => r !== except && cols.every((c) => (r[c] ?? null) === (row[c] ?? null)))
  }
  const failsNow = (t: string, patch: Row): boolean => {
    const f = failing[t]
    if (f && f(patch)) {
      failing[t] = undefined
      return true
    }
    return false
  }

  function builder(t: string) {
    const filters: Array<(r: Row) => boolean> = []
    let op: { kind: "select" | "insert" | "upsert" | "update" | "delete"; row?: Row; patch?: Row; onConflict?: string; ignoreDuplicates?: boolean; head?: boolean; count?: boolean } = { kind: "select" }
    let returning = false
    let order: { col: string; asc: boolean } | undefined
    let limit: number | undefined
    let range: [number, number] | undefined
    let single = false

    const matched = () => {
      let rows = table(t).filter((r) => filters.every((f) => f(r)))
      if (order) rows = [...rows].sort((a, b) => (order!.asc ? 1 : -1) * cmp(valueAt(a, order!.col), valueAt(b, order!.col)))
      if (range) rows = rows.slice(range[0], range[1] + 1)
      if (limit !== undefined) rows = rows.slice(0, limit)
      return rows
    }

    const run = async (): Promise<{ data: unknown; error: unknown; count?: number }> => {
      if (op.kind === "insert") {
        const row = { ...(DEFAULTS[t] ?? {}), ...op.row }
        if (failsNow(t, row)) return { data: null, error: { message: "connection reset" } }
        if (clash(t, row)) return { data: null, error: { code: "23505", message: "duplicate key" } }
        const at = stamp()
        table(t).push({ id: ++ids, created_at: at, updated_at: at, ...row })
        return { data: null, error: null }
      }
      if (op.kind === "upsert") {
        const row = { ...op.row }
        if (failsNow(t, row)) return { data: null, error: { message: "connection reset" } }
        const same = clash(t, { ...(DEFAULTS[t] ?? {}), ...row })
        if (same) {
          if (!op.ignoreDuplicates) Object.assign(same, row, { updated_at: row.updated_at ?? stamp() })
        } else {
          const at = stamp()
          table(t).push({ id: ++ids, created_at: at, updated_at: at, ...(DEFAULTS[t] ?? {}), ...row })
        }
        return { data: null, error: null }
      }
      if (op.kind === "update") {
        if (failsNow(t, op.patch!)) return { data: null, error: { message: "connection reset" } }
        const rows = matched()
        for (const r of rows) Object.assign(r, structuredClone(op.patch!))
        return { data: returning ? rows.map((r) => ({ id: r.id })) : null, error: null }
      }
      if (op.kind === "delete") {
        const rows = matched()
        tables[t] = table(t).filter((r) => !rows.includes(r))
        return { data: null, error: null }
      }
      const all = table(t).filter((r) => filters.every((f) => f(r)))
      const rows = matched().map((r) => structuredClone(r))
      if (single) return { data: rows[0] ?? null, error: null }
      return { data: op.head ? null : rows, error: null, ...(op.count ? { count: all.length } : {}) }
    }

    const chain: Record<string, unknown> = {
      select: (_cols?: string, o?: { count?: string; head?: boolean }) => {
        if (op.kind === "select") op = { kind: "select", head: o?.head === true, count: o?.count === "exact" }
        else returning = true
        return chain
      },
      insert: (row: Row) => ((op = { kind: "insert", row }), chain),
      upsert: (row: Row, o?: { onConflict?: string; ignoreDuplicates?: boolean }) => ((op = { kind: "upsert", row, ignoreDuplicates: o?.ignoreDuplicates === true }), chain),
      update: (patch: Row) => ((op = { kind: "update", patch }), chain),
      delete: () => ((op = { kind: "delete" }), chain),
      eq: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) !== null && valueAt(r, c) !== undefined && valueAt(r, c) === v), chain),
      neq: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) !== null && valueAt(r, c) !== undefined && valueAt(r, c) !== v), chain),
      is: (c: string, v: unknown) => (filters.push((r) => (valueAt(r, c) ?? null) === v), chain),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(valueAt(r, c) ?? null)), chain),
      gt: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) != null && cmp(valueAt(r, c), v) > 0), chain),
      gte: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) != null && cmp(valueAt(r, c), v) >= 0), chain),
      lt: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) != null && cmp(valueAt(r, c), v) < 0), chain),
      lte: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) != null && cmp(valueAt(r, c), v) <= 0), chain),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), chain),
      limit: (n: number) => ((limit = n), chain),
      range: (a: number, b: number) => ((range = [a, b]), chain),
      maybeSingle: () => ((single = true), run()),
      single: () => ((single = true), run()),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad),
    }
    return chain
  }

  return {
    tables,
    client: { from: (t: string) => builder(t), rpc: async () => ({ data: null, error: { code: "PGRST202", message: "not in the fake" } }) },
    rows: (t, where = {}) => table(t).filter((r) => Object.entries(where).every(([c, v]) => (r[c] ?? null) === v)),
    failNextWrite: (t, when = () => true) => {
      failing[t] = when
    },
  }
}
