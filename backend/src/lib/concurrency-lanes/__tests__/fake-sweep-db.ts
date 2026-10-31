// An in-memory PostgREST double for the sweep proofs (sweeps-spare-waiters) and
// the lanes integration (lanes.integration.redis):
// every table a sweep reads, with the filters applied as PostgREST applies
// them, so a sweep's own query decides which rows it sees. A method the double
// does not implement throws (a TypeError on the missing member): a filter is
// never silently ignored, which would let a sweep "spare" a row it never
// filtered out.
//
// Columns: `a->>b` reads `row.a.b` as text and `a->b` as JSON, in a filter and
// in a select alias (`node_id:input_data->>node_id`). A select (and a write's
// returning select) answers ONLY the columns it lists, plus its aliases, so a
// sweep that reads a column it did not select reads `undefined`; `*` answers
// whole rows. An embedded relation in a select list (`profiles!user_id(...)`,
// `usage_logs!inner(...)`) is not joined: the row's own value under the
// relation's name, if a case stored one, passes through.
// An insert of a row with no `id` gets one (and a `created_at`), as the table's defaults do.
import { randomUUID } from "node:crypto"

export type Row = Record<string, unknown>

export interface SweepDbWrite {
  table: string
  op: "insert" | "update" | "upsert" | "delete"
  patch: Row | null
  /** The `id` of every row the write touched (insert: the rows written). */
  ids: unknown[]
}

export interface SweepDb {
  tables: Record<string, Row[]>
  writes: SweepDbWrite[]
  rpcs: Array<{ fn: string; args: unknown }>
  /** The table of every select run (a write's returning select is not a read). */
  reads: string[]
  rows(table: string): Row[]
  /** The row of `table` whose `id` is `id`. */
  row(table: string, id: string): Row | undefined
  client: { from(table: string): unknown; rpc(fn: string, args?: unknown): Promise<{ data: null; error: null }> }
}

type Pred = (row: Row) => boolean

function valueOf(row: Row, col: string): unknown {
  const text = col.indexOf("->>")
  if (text > 0) {
    const base = row[col.slice(0, text)]
    const v = base !== null && typeof base === "object" ? (base as Row)[col.slice(text + 3)] : undefined
    return v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v)
  }
  const json = col.indexOf("->")
  if (json > 0) {
    const base = row[col.slice(0, json)]
    return base !== null && typeof base === "object" ? ((base as Row)[col.slice(json + 2)] ?? null) : null
  }
  return row[col]
}

const cmp = (a: unknown, b: unknown): number => {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  return (a as string | number) < (b as string | number) ? -1 : 1
}

export function makeSweepDb(): SweepDb {
  const db: SweepDb = {
    tables: {},
    writes: [],
    rpcs: [],
    reads: [],
    rows(table) {
      db.tables[table] ??= []
      return db.tables[table]!
    },
    row(table, id) {
      return db.rows(table).find((r) => r.id === id)
    },
    client: {
      from: (table: string) => query(db, table),
      rpc: async (fn: string, args?: unknown) => {
        db.rpcs.push({ fn, args })
        return { data: null, error: null }
      },
    },
  }
  return db
}

function query(db: SweepDb, table: string) {
  let op: "select" | "insert" | "update" | "upsert" | "delete" = "select"
  let cols = "*"
  let payload: Row[] = []
  let returning = false
  const preds: Pred[] = []
  const orders: Array<{ col: string; ascending: boolean }> = []
  let limitN: number | null = null
  let rangeFrom = 0

  /** The select list's top-level entries (commas inside an embedded relation's parentheses do not split). */
  const entriesOf = (): string[] => {
    const out: string[] = []
    let depth = 0
    let cur = ""
    for (const ch of cols) {
      if (ch === "(") depth++
      if (ch === ")") depth--
      if (ch === "," && depth === 0) {
        out.push(cur.trim())
        cur = ""
      } else cur += ch
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }

  const project = (row: Row): Row => {
    if (cols.trim() === "*") return { ...row }
    const out: Row = {}
    for (const entry of entriesOf()) {
      const embedded = entry.match(/^([a-z_][a-z0-9_]*)(?:![a-z_]+)?\(/i)
      if (embedded) {
        const name = embedded[1]!
        if (name in row) out[name] = row[name]
        continue
      }
      const colon = entry.indexOf(":")
      if (colon > 0) {
        out[entry.slice(0, colon).trim()] = valueOf(row, entry.slice(colon + 1).trim())
        continue
      }
      // `a->>b` without an alias is answered under `b`, as PostgREST does.
      const name = entry.split(/->>?/).pop()!.trim()
      out[name] = valueOf(row, entry)
    }
    return out
  }

  const run = (): { data: unknown; error: null } => {
    const rows = db.rows(table)
    if (op === "insert" || op === "upsert") {
      // The database names a row that does not name itself.
      payload = payload.map((r) => (r.id === undefined && op === "insert" ? { id: randomUUID(), created_at: new Date().toISOString(), ...r } : r))
      for (const r of payload) {
        const i = op === "upsert" ? rows.findIndex((x) => x.id !== undefined && x.id === r.id) : -1
        if (i >= 0) rows[i] = { ...rows[i], ...r }
        else rows.push({ ...r })
      }
      db.writes.push({ table, op, patch: null, ids: payload.map((r) => r.id) })
      return { data: returning ? payload.map(project) : null, error: null }
    }
    const hit = rows.filter((r) => preds.every((p) => p(r)))
    if (op === "update") {
      for (const r of hit) Object.assign(r, payload[0])
      db.writes.push({ table, op, patch: payload[0] ?? null, ids: hit.map((r) => r.id) })
      return { data: returning ? hit.map(project) : null, error: null }
    }
    if (op === "delete") {
      db.tables[table] = rows.filter((r) => !hit.includes(r))
      db.writes.push({ table, op, patch: null, ids: hit.map((r) => r.id) })
      return { data: returning ? hit.map(project) : null, error: null }
    }
    db.reads.push(table)
    let out = [...hit]
    for (const o of [...orders].reverse()) {
      out.sort((a, b) => (o.ascending ? 1 : -1) * cmp(valueOf(a, o.col), valueOf(b, o.col)))
    }
    out = out.slice(rangeFrom)
    if (limitN !== null) out = out.slice(0, limitN)
    return { data: out.map(project), error: null }
  }

  const q = {
    select(c?: string) {
      cols = c ?? "*"
      if (op !== "select") returning = true
      return q
    },
    insert(rows: Row | Row[]) { op = "insert"; payload = [rows].flat(); return q },
    upsert(rows: Row | Row[]) { op = "upsert"; payload = [rows].flat(); return q },
    update(patch: Row) { op = "update"; payload = [patch]; return q },
    delete() { op = "delete"; return q },
    eq(col: string, v: unknown) { preds.push((r) => valueOf(r, col) === v); return q },
    neq(col: string, v: unknown) { preds.push((r) => valueOf(r, col) !== v); return q },
    in(col: string, vs: readonly unknown[]) { preds.push((r) => vs.includes(valueOf(r, col))); return q },
    is(col: string, v: null | boolean) { preds.push((r) => (v === null ? (valueOf(r, col) ?? null) === null : valueOf(r, col) === v)); return q },
    not(col: string, operator: string, v: unknown) {
      if (operator === "is" && v === null) preds.push((r) => (valueOf(r, col) ?? null) !== null)
      else if (operator === "in" && typeof v === "string") {
        const vs = v.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""))
        preds.push((r) => !vs.includes(String(valueOf(r, col))))
      } else throw new Error(`fake-sweep-db: not(${col}, ${operator}) is not supported`)
      return q
    },
    lt(col: string, v: string | number) { preds.push((r) => valueOf(r, col) !== null && valueOf(r, col) !== undefined && cmp(valueOf(r, col), v) < 0); return q },
    lte(col: string, v: string | number) { preds.push((r) => valueOf(r, col) !== null && valueOf(r, col) !== undefined && cmp(valueOf(r, col), v) <= 0); return q },
    gt(col: string, v: string | number) { preds.push((r) => valueOf(r, col) !== null && valueOf(r, col) !== undefined && cmp(valueOf(r, col), v) > 0); return q },
    gte(col: string, v: string | number) { preds.push((r) => valueOf(r, col) !== null && valueOf(r, col) !== undefined && cmp(valueOf(r, col), v) >= 0); return q },
    order(col: string, opts?: { ascending?: boolean }) { orders.push({ col, ascending: opts?.ascending !== false }); return q },
    limit(n: number) { limitN = n; return q },
    range(from: number, to: number) { rangeFrom = from; limitN = to - from + 1; return q },
    maybeSingle: async () => {
      const r = run()
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }
    },
    single: async () => {
      const r = run()
      const first = Array.isArray(r.data) ? r.data[0] : r.data
      return first ? { data: first, error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
    },
    then<A, B = never>(ok?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return Promise.resolve().then(run).then(ok, ko)
    },
  }
  return q
}
