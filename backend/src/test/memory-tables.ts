/**
 * An in-memory stand-in for the Supabase client's query chain, for tests that
 * need several tables to agree. It runs the filters the code under test uses,
 * with Postgres's semantics where they differ from JavaScript's:
 *
 *   - a comparison with NULL (eq, neq, in, lte, gte, lt, gt) matches nothing;
 *     `is` and `not(…, "is", null)` are how NULL is asked for;
 *   - `not` supports "is" and "in" only, and throws on anything else rather
 *     than letting every row through;
 *   - `overlaps` takes a Postgres array literal ("{\"a,b\",c}"), or an array,
 *     sent as postgrest-js sends one: joined with commas, unquoted, so an
 *     element holding a comma splits in two;
 *   - ascending order puts NULLs last, descending first;
 *   - `select(columns)` projects the listed columns (a missing one reads null),
 *     so code reading a column it did not select reads undefined, as it would;
 *   - `maybeSingle` over several rows, and `single` over any count but one,
 *     answer PGRST116, as postgrest-js does.
 *
 * Writes: a column listed as unique refuses a duplicate with 23505; `guards`
 * stand in for a table's triggers and checks (a refusal leaves the table as
 * it was); `beforeWrite` runs once just before the next write to a table
 * lands (another writer in between); `onUpdate` adds what a table's trigger
 * stamps on every update; `defaults` fill a column's default on insert. A
 * table listed in `failReads` answers every read with an error; one listed in
 * `missingTables` answers every read and write as Postgres does a table that
 * does not exist yet (42P01), the way staging meets a newer migration's table.
 *
 * Reads nothing from disk: it is a plain module.
 */

export type Row = Record<string, unknown>

export interface WriteRefusal {
  readonly code: string
  readonly message: string
}

/** A table's trigger or check: the row as it would be written (and, on update, as it was), or a refusal. */
export type Guard = (write: { readonly kind: "insert" | "update"; readonly row: Row; readonly before?: Row }) => WriteRefusal | null

export interface MemoryDb {
  tables: Record<string, Row[]>
  unique?: Record<string, readonly string[]>
  failReads?: Set<string>
  /** Tables the database does not have yet: every read and write answers 42P01. */
  missingTables?: Set<string>
  beforeWrite?: Record<string, (() => void) | null>
  onUpdate?: Record<string, () => Row>
  /** What a table's column defaults fill on insert, given the row as sent. */
  defaults?: Record<string, (row: Row) => Row>
  guards?: Record<string, Guard>
}

type Filter = (row: Row) => boolean
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null }

const isNull = (value: unknown) => value === null || value === undefined

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1
  const x = String(a)
  const y = String(b)
  return x === y ? 0 : x < y ? -1 : 1
}

/** A comparison filter: NULL on either side matches nothing, as in SQL. */
const comparing = (column: string, value: unknown, holds: (order: number) => boolean): Filter => (row) =>
  !isNull(row[column]) && !isNull(value) && holds(compare(row[column], value))

/** A Postgres array literal ({a,"b,c"}) as its elements; an array as it is. */
function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const text = String(value)
  if (!text.startsWith("{") || !text.endsWith("}")) throw new Error(`memory-tables: not an array literal: ${text}`)
  const body = text.slice(1, -1)
  const out: string[] = []
  let current = ""
  let quoted = false
  let wasQuoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (quoted) {
      if (ch === "\\") current += body[++i] ?? ""
      else if (ch === '"') quoted = false
      else current += ch
    } else if (ch === '"') {
      quoted = true
      wasQuoted = true
    } else if (ch === ",") {
      out.push(current)
      current = ""
      wasQuoted = false
    } else current += ch
  }
  if (body.length > 0 || wasQuoted) out.push(current)
  return out
}

/** A PostgREST list, "(a,b)", as its elements. */
function listValue(value: unknown): string[] {
  const text = String(value)
  if (!text.startsWith("(") || !text.endsWith(")")) throw new Error(`memory-tables: not a list: ${text}`)
  return text.slice(1, -1).split(",").map((v) => v.trim()).filter((v) => v.length > 0)
}

function projector(columns: string | undefined): ((row: Row) => Row) | null {
  if (columns === undefined) return null
  const names = columns.split(",").map((c) => c.trim()).filter((c) => c.length > 0)
  if (names.length === 0 || names.includes("*")) return null
  if (names.some((n) => n.includes("(") || n.includes(":"))) throw new Error(`memory-tables: embedded or renamed columns are not supported: ${columns}`)
  return (row) => Object.fromEntries(names.map((n) => [n, row[n] ?? null]))
}

function chain(db: MemoryDb, name: string) {
  const filters: Filter[] = []
  const sorts: Array<[string, boolean]> = []
  let cap: number | null = null
  let patch: Row | null = null
  let inserted: Row | null = null
  let counted = false
  let head = false
  let project: ((row: Row) => Row) | null = null

  const rows = (): Row[] => (db.tables[name] ??= [])
  const shown = (list: Row[]) => (project ? list.map(project) : list)

  const runWrite = (): Result => {
    const hook = db.beforeWrite?.[name]
    if (hook) {
      db.beforeWrite![name] = null
      hook()
    }
    const guard = db.guards?.[name]
    if (inserted) {
      for (const column of db.unique?.[name] ?? []) {
        if (!isNull(inserted[column]) && rows().some((r) => r[column] === inserted![column])) {
          return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${column}` } }
        }
      }
      const refused = guard?.({ kind: "insert", row: inserted })
      if (refused) return { data: null, error: refused }
      db.tables[name] = [...rows(), inserted]
      return { data: shown([inserted]), error: null }
    }
    const before = rows()
    const hit = new Set(before.filter((r) => filters.every((f) => f(r))))
    const stamp = db.onUpdate?.[name]?.() ?? {}
    const after = before.map((r) => (hit.has(r) ? { ...r, ...patch, ...stamp } : r))
    for (let i = 0; i < before.length; i++) {
      if (!hit.has(before[i]!)) continue
      const refused = guard?.({ kind: "update", row: after[i]!, before: before[i]! })
      if (refused) return { data: null, error: refused }
    }
    db.tables[name] = after
    return { data: shown(after.filter((_, i) => hit.has(before[i]!))), error: null }
  }

  const run = (): Result => {
    if (db.missingTables?.has(name)) return { data: null, error: { code: "42P01", message: `relation "public.${name}" does not exist` }, count: null }
    if (patch || inserted) return runWrite()
    if (db.failReads?.has(name)) return { data: null, error: { message: `${name} is down` }, count: null }
    const hit = rows().filter((r) => filters.every((f) => f(r)))
    const sorted = sorts.reduceRight(
      (acc, [column, ascending]) =>
        [...acc].sort((a, b) => {
          const x = a[column]
          const y = b[column]
          if (isNull(x) || isNull(y)) {
            if (isNull(x) && isNull(y)) return 0
            // Postgres: NULLS LAST ascending, NULLS FIRST descending.
            return (isNull(x) ? 1 : -1) * (ascending ? 1 : -1)
          }
          return compare(x, y) * (ascending ? 1 : -1)
        }),
      hit,
    )
    const limited = cap === null ? sorted : sorted.slice(0, cap)
    return { data: head ? null : shown(limited), error: null, count: counted ? hit.length : null }
  }

  const one = (result: Result, strict: boolean): Result => {
    if (result.error) return result
    const list = (result.data ?? []) as Row[]
    if (list.length > 1 || (strict && list.length !== 1)) {
      return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }
    }
    return { data: list[0] ?? null, error: null }
  }

  const q: Record<string, unknown> = {}
  Object.assign(q, {
    select: (columns?: string, opts?: { count?: string; head?: boolean }) => {
      counted = Boolean(opts?.count)
      head = Boolean(opts?.head)
      project = projector(columns)
      return q
    },
    insert: (row: Row) => ((inserted = { ...(db.defaults?.[name]?.(row) ?? {}), ...row }), q),
    update: (p: Row) => ((patch = { ...p }), q),
    eq: (c: string, v: unknown) => (filters.push(comparing(c, v, (o) => o === 0)), q),
    neq: (c: string, v: unknown) => (filters.push(comparing(c, v, (o) => o !== 0)), q),
    lt: (c: string, v: unknown) => (filters.push(comparing(c, v, (o) => o < 0)), q),
    lte: (c: string, v: unknown) => (filters.push(comparing(c, v, (o) => o <= 0)), q),
    gt: (c: string, v: unknown) => (filters.push(comparing(c, v, (o) => o > 0)), q),
    gte: (c: string, v: unknown) => (filters.push(comparing(c, v, (o) => o >= 0)), q),
    is: (c: string, v: unknown) => (filters.push((r) => (v === null ? isNull(r[c]) : r[c] === v)), q),
    not: (c: string, op: string, v: unknown) => {
      if (op === "is" && v === null) filters.push((r) => !isNull(r[c]))
      else if (op === "in") {
        const list = listValue(v)
        filters.push((r) => !isNull(r[c]) && !list.includes(String(r[c])))
      } else throw new Error(`memory-tables: not.${op} is not supported`)
      return q
    },
    in: (c: string, vs: readonly unknown[]) => (filters.push((r) => !isNull(r[c]) && vs.includes(r[c])), q),
    overlaps: (c: string, vs: unknown) => {
      // As postgrest-js sends an array: its elements joined with commas, unquoted.
      const list = arrayValue(Array.isArray(vs) ? `{${vs.join(",")}}` : vs)
      filters.push((r) => ((r[c] as unknown[] | null) ?? []).some((x) => list.includes(x)))
      return q
    },
    order: (c: string, opts?: { ascending?: boolean }) => (sorts.push([c, opts?.ascending !== false]), q),
    limit: (n: number) => ((cap = n), q),
    single: async () => one(run(), true),
    maybeSingle: async () => one(run(), false),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  })
  return q
}

/** The client: `from(table)` starts a chain over `db`. */
export function memorySupabase(db: MemoryDb) {
  return { from: (name: string) => chain(db, name) }
}
