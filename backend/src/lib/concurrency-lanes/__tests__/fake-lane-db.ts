// An in-memory stand-in for the slice of the Supabase client the lane config
// reads and writes: select (eq / in / limit / maybeSingle), insert, upsert,
// update (… .select()), delete. Enough of PostgREST's answers to test the
// tolerant paths: a missing table (42P01) or column (42703), a unique
// violation (23505), a foreign key (23503), and an injected failure.

type Row = Record<string, unknown>
type Filter = { kind: "eq"; col: string; val: unknown } | { kind: "in"; col: string; vals: unknown[] }
type Result = { data: unknown; error: { code: string; message: string } | null }

export interface FakeLaneDb {
  tables: Map<string, Row[]>
  /** Tables that do not exist (42P01). */
  missingTables: Set<string>
  /** `table.column` pairs that do not exist (42703). */
  missingColumns: Set<string>
  /** Tables whose every call fails with a generic error. */
  failing: Set<string>
  /** Primary key of each table (for upsert / insert conflicts). */
  keys: Record<string, string>
  /** `table.column` → referenced table: a write naming an id that table lacks is a 23503. */
  foreignKeys: Record<string, string>
  /** Called before an update applies (to simulate a concurrent writer). */
  beforeUpdate: ((table: string) => void) | null
  rows(table: string): Row[]
  client: { from(table: string): unknown }
}

export function makeFakeLaneDb(): FakeLaneDb {
  const db: FakeLaneDb = {
    tables: new Map(),
    missingTables: new Set(),
    missingColumns: new Set(),
    failing: new Set(),
    keys: {
      app_settings: "key",
      lane_plan_sizes: "tier",
      lane_user_overrides: "user_id",
      lane_provider_ceilings: "provider",
      profiles: "id",
    },
    foreignKeys: { "lane_user_overrides.user_id": "profiles" },
    beforeUpdate: null,
    rows(table) {
      if (!db.tables.has(table)) db.tables.set(table, [])
      return db.tables.get(table)!
    },
    client: { from: (table: string) => new Query(db, table) },
  }
  return db
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select"
  private cols = "*"
  private filters: Filter[] = []
  private limitN: number | null = null
  private payload: Row[] = []
  private single = false
  private returning = false

  constructor(private readonly db: FakeLaneDb, private readonly table: string) {}

  select(cols = "*"): this {
    if (this.op === "select") this.cols = cols
    else this.returning = true
    return this
  }
  insert(rows: Row | Row[]): this { this.op = "insert"; this.payload = [rows].flat(); return this }
  upsert(rows: Row | Row[], _opts?: unknown): this { this.op = "upsert"; this.payload = [rows].flat(); return this }
  update(row: Row): this { this.op = "update"; this.payload = [row]; return this }
  delete(): this { this.op = "delete"; return this }
  eq(col: string, val: unknown): this { this.filters.push({ kind: "eq", col, val }); return this }
  in(col: string, vals: unknown[]): this { this.filters.push({ kind: "in", col, vals }); return this }
  limit(n: number): this { this.limitN = n; return this }
  maybeSingle(): Promise<Result> { this.single = true; return Promise.resolve(this.run()) }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, ko)
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => (f.kind === "eq" ? row[f.col] === f.val : f.vals.includes(row[f.col])))
  }

  private fail(code: string, message: string): Result {
    return { data: null, error: { code, message } }
  }

  private run(): Result {
    const { db, table } = this
    if (db.failing.has(table)) return this.fail("XX000", `${table} is unavailable`)
    if (db.missingTables.has(table)) return this.fail("42P01", `relation "public.${table}" does not exist`)
    if (this.op === "select") {
      const named = this.cols === "*" ? [] : this.cols.split(",").map((c) => c.trim())
      const gone = named.find((c) => db.missingColumns.has(`${table}.${c}`))
      if (gone) return this.fail("42703", `column ${table}.${gone} does not exist`)
      let out = db.rows(table).filter((r) => this.matches(r)).map((r) => ({ ...r }))
      if (this.limitN !== null) out = out.slice(0, this.limitN)
      return { data: this.single ? (out[0] ?? null) : out, error: null }
    }
    const key = db.keys[table] ?? "id"
    for (const row of this.payload) {
      for (const [ref, target] of Object.entries(db.foreignKeys)) {
        const [t, col] = ref.split(".")
        if (t !== table || row[col!] == null) continue
        if (!db.rows(target).some((r) => r[db.keys[target] ?? "id"] === row[col!])) return this.fail("23503", `violates foreign key ${ref}`)
      }
    }
    const rows = db.rows(table)
    if (this.op === "insert") {
      for (const row of this.payload) {
        if (rows.some((r) => r[key] === row[key])) return this.fail("23505", `duplicate key ${String(row[key])}`)
        rows.push({ ...row })
      }
      return { data: null, error: null }
    }
    if (this.op === "upsert") {
      for (const row of this.payload) {
        const i = rows.findIndex((r) => r[key] === row[key])
        if (i >= 0) rows[i] = { ...rows[i], ...row }
        else rows.push({ ...row })
      }
      return { data: null, error: null }
    }
    if (this.op === "update") {
      db.beforeUpdate?.(table)
      const hit = rows.filter((r) => this.matches(r))
      for (const r of hit) Object.assign(r, this.payload[0])
      return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null }
    }
    // delete
    db.tables.set(table, rows.filter((r) => !this.matches(r)))
    return { data: null, error: null }
  }
}
