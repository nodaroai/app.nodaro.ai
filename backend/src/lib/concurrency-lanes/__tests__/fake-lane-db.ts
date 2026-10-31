// An in-memory stand-in for the slice of the Supabase client the lane config
// reads and writes: select (eq / in / is / not-is / gte / lt / order / limit /
// maybeSingle), insert, upsert, update (… .select()), delete. Enough of PostgREST's answers to test the
// tolerant paths: a missing table (42P01) or column (42703), a unique
// violation (23505), a foreign key (23503), and an injected failure.

type Row = Record<string, unknown>
type Filter =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "in"; col: string; vals: unknown[] }
  | { kind: "is"; col: string; val: null }
  | { kind: "notNull"; col: string }
  | { kind: "gte" | "lt"; col: string; val: string | number }
type Result = { data: unknown; error: { code: string; message: string } | null }

export interface FakeLaneDb {
  tables: Map<string, Row[]>
  /** Tables that do not exist (42P01). */
  missingTables: Set<string>
  /** `table.column` pairs that do not exist (42703). */
  missingColumns: Set<string>
  /** Tables whose every call fails with a generic error. */
  failing: Set<string>
  /** Primary key of each table (for upsert / insert conflicts); a composite one is comma-separated. */
  keys: Record<string, string>
  /** `table.column` → referenced table: a write naming an id that table lacks is a 23503. */
  foreignKeys: Record<string, string>
  /** Called before an update applies (to simulate a concurrent writer). */
  beforeUpdate: ((table: string) => void) | null
  /** An error an update answers instead of applying (a transient failure), or null to apply it. */
  failUpdate: ((table: string, payload: Row) => { code: string; message: string } | null) | null
  /** Every select run, as `table:cols` (to assert what a reader asked for). */
  selects: string[]
  /** The longest `.in()` list the gateway accepts (null: any); a longer one fails the call. */
  maxInList: number | null
  /** The length of every `.in()` list sent. */
  inLengths: number[]
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
      lane_requeue_payloads: "kind,row_id",
    },
    foreignKeys: { "lane_user_overrides.user_id": "profiles" },
    beforeUpdate: null,
    failUpdate: null,
    selects: [],
    maxInList: null,
    inLengths: [],
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
  private orderBy: { col: string; ascending: boolean } | null = null
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
  is(col: string, val: null): this { this.filters.push({ kind: "is", col, val }); return this }
  not(col: string, op: "is", val: null): this {
    if (op !== "is" || val !== null) throw new Error(`fake-lane-db: not(${col}, ${op}, ${String(val)}) is not supported`)
    this.filters.push({ kind: "notNull", col })
    return this
  }
  gte(col: string, val: string | number): this { this.filters.push({ kind: "gte", col, val }); return this }
  lt(col: string, val: string | number): this { this.filters.push({ kind: "lt", col, val }); return this }
  order(col: string, opts?: { ascending?: boolean }): this { this.orderBy = { col, ascending: opts?.ascending !== false }; return this }
  limit(n: number): this { this.limitN = n; return this }
  maybeSingle(): Promise<Result> { this.single = true; return Promise.resolve(this.run()) }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, ko)
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.col]
      switch (f.kind) {
        case "eq": return v === f.val
        case "is": return (v ?? null) === f.val
        case "notNull": return v !== null && v !== undefined
        case "in": return f.vals.includes(v)
        case "gte": return v !== null && v !== undefined && (v as string | number) >= f.val
        case "lt": return v !== null && v !== undefined && (v as string | number) < f.val
      }
    })
  }

  private fail(code: string, message: string): Result {
    return { data: null, error: { code, message } }
  }

  private run(): Result {
    const { db, table } = this
    if (db.failing.has(table)) return this.fail("XX000", `${table} is unavailable`)
    if (db.missingTables.has(table)) return this.fail("42P01", `relation "public.${table}" does not exist`)
    for (const f of this.filters) {
      if (f.kind !== "in") continue
      db.inLengths.push(f.vals.length)
      if (db.maxInList !== null && f.vals.length > db.maxInList) return this.fail("PGRST000", `URI too long (${f.vals.length} ids)`)
    }
    if (this.op === "select") {
      db.selects.push(`${table}:${this.cols}`)
      const named = this.cols === "*" ? [] : this.cols.split(",").map((c) => c.trim())
      const filtered = this.filters.map((f) => f.col)
      const gone = [...named, ...filtered, ...(this.orderBy ? [this.orderBy.col] : [])].find((c) => db.missingColumns.has(`${table}.${c}`))
      if (gone) return this.fail("42703", `column ${table}.${gone} does not exist`)
      let out = db.rows(table).filter((r) => this.matches(r)).map((r) => ({ ...r }))
      if (this.orderBy) {
        const { col, ascending } = this.orderBy
        out.sort((a, b) => {
          const x = a[col] as string | number
          const y = b[col] as string | number
          return x === y ? 0 : (x < y) === ascending ? -1 : 1
        })
      }
      if (this.limitN !== null) out = out.slice(0, this.limitN)
      return { data: this.single ? (out[0] ?? null) : out, error: null }
    }
    const keyCols = (db.keys[table] ?? "id").split(",")
    const sameKey = (a: Row, b: Row) => keyCols.every((c) => a[c] === b[c])
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
        if (rows.some((r) => sameKey(r, row))) return this.fail("23505", `duplicate key ${keyCols.map((c) => String(row[c])).join(",")}`)
        rows.push({ ...row })
      }
      return { data: null, error: null }
    }
    if (this.op === "upsert") {
      for (const row of this.payload) {
        const i = rows.findIndex((r) => sameKey(r, row))
        if (i >= 0) rows[i] = { ...rows[i], ...row }
        else rows.push({ ...row })
      }
      return { data: null, error: null }
    }
    if (this.op === "update") {
      // A statement naming a missing column fails whole (PostgREST: PGRST204).
      const gone = Object.keys(this.payload[0] ?? {}).find((c) => db.missingColumns.has(`${table}.${c}`))
      if (gone) return this.fail("PGRST204", `Could not find the '${gone}' column of '${table}' in the schema cache`)
      const injected = db.failUpdate?.(table, this.payload[0] ?? {})
      if (injected) return this.fail(injected.code, injected.message)
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
