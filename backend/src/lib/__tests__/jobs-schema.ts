/**
 * The `jobs` table as the migrations build it, for tests.
 *
 * `jobsColumns()` reads the column set from `supabase/migrations` (the schema's
 * one source of truth). `strictJobsSupabase()` is an in-memory stand-in for the
 * Supabase client whose `jobs` table behaves as PostgREST does against that
 * schema: a write, filter or select naming a column the table lacks fails the
 * WHOLE request with an error and changes nothing. Ordinary mocks accept any
 * key, which is how writes to columns that do not exist shipped unnoticed.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const MIGRATIONS = resolve(__dirname, "../../../../supabase/migrations")

/** The `jobs` columns after every migration, in order. */
export function jobsColumns(): Set<string> {
  const cols = new Set<string>()
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "")
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?jobs"?\s*\(([\s\S]*?)\n\);/i.exec(sql)
    if (create) {
      for (const line of create[1]!.split("\n")) {
        const col = /^\s*"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i.exec(line)
        if (col && !/^(constraint|primary|unique|check|foreign)$/i.test(col[1]!)) cols.add(col[1]!.toLowerCase())
      }
    }
    const alter = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?public"?\.)?"?jobs"?\s+([\s\S]*?);/gi
    for (let m = alter.exec(sql); m; m = alter.exec(sql)) {
      const body = m[1]!
      // `ADD [COLUMN] [IF NOT EXISTS] name` — COLUMN is optional in Postgres.
      for (const a of body.matchAll(/\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
        if (!/^(constraint|primary|unique|check|foreign|column)$/i.test(a[1]!)) cols.add(a[1]!.toLowerCase())
      }
      for (const d of body.matchAll(/\bdrop\s+column\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) cols.delete(d[1]!.toLowerCase())
      for (const r of body.matchAll(/\brename\s+column\s+"?([a-z_][a-z0-9_]*)"?\s+to\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
        cols.delete(r[1]!.toLowerCase())
        cols.add(r[2]!.toLowerCase())
      }
    }
  }
  return cols
}

/** `metadata->>kie_task_id` → `metadata`. */
export function columnOf(ref: string): string {
  return ref.split(/->>?/)[0]!.trim()
}

/** A PostgREST select list → the plain column names it reads from the table itself (embedded resources skipped). */
export function selectColumns(list: string): string[] {
  let flat = list
  for (let prev = ""; prev !== flat; ) {
    prev = flat
    flat = flat.replace(/[a-z_!:]*\([^()]*\)/gi, "")
  }
  return flat
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== "*")
    .map((p) => (p.includes(":") && !p.includes("::") ? p.split(":").pop()! : p))
    .map((p) => p.split("::")[0]!)
    .map(columnOf)
}

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string; code?: string } | null }

/**
 * An in-memory Supabase stand-in. `jobs` is schema-strict (see the file
 * header); every other table answers empty. Enough of the query builder for a
 * route's insert / update / select chains.
 */
export function strictJobsSupabase(seed: Row[] = []) {
  const COLUMNS = jobsColumns()
  const jobs: Row[] = seed.map((r) => ({ ...r }))
  let nextId = 1

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const named: string[] = []
    let op: "select" | "insert" | "update" = "select"
    let payload: Row[] = []
    let returning: string | undefined
    let limit: number | undefined
    let single: "single" | "maybe" | undefined

    const run = (): Result => {
      if (table !== "jobs") return { data: single ? null : [], error: null }
      const unknown = [...named, ...payload.flatMap((p) => Object.keys(p)), ...(returning ? selectColumns(returning) : [])]
        .filter((c) => !COLUMNS.has(c))
      if (unknown.length > 0) {
        // PostgREST: one unknown column fails the whole statement, nothing written.
        return { data: null, error: { code: "PGRST204", message: `Could not find the '${unknown[0]}' column of 'jobs' in the schema cache` } }
      }
      let rows: Row[]
      if (op === "insert") {
        rows = payload.map((p) => ({ id: `job-${nextId++}`, status: "pending", ...p }))
        jobs.push(...rows)
      } else {
        rows = jobs.filter((r) => filters.every((f) => f(r)))
        if (op === "update") for (const r of rows) Object.assign(r, payload[0])
      }
      if (limit !== undefined) rows = rows.slice(0, limit)
      const out = rows.map((r) => ({ ...r }))
      if (single) {
        if (out.length === 1) return { data: out[0], error: null }
        return single === "maybe" && out.length === 0 ? { data: null, error: null } : { data: null, error: { code: "PGRST116", message: "not one row" } }
      }
      return { data: op === "select" || returning !== undefined ? out : null, error: null }
    }

    const filter = (col: string, test: (v: unknown) => boolean) => {
      named.push(columnOf(col))
      const key = col.split(/->>?/)
      filters.push((r) => {
        let v: unknown = r[key[0]!.trim()]
        for (const k of key.slice(1)) v = v && typeof v === "object" ? (v as Row)[k.trim()] : undefined
        return test(v)
      })
      return builder
    }

    const builder = {
      select(cols = "*") {
        if (op === "select") named.push(...selectColumns(cols))
        else returning = cols
        return builder
      },
      insert(rows: Row | Row[]) {
        op = "insert"
        payload = Array.isArray(rows) ? rows : [rows]
        return builder
      },
      update(values: Row) {
        op = "update"
        payload = [values]
        return builder
      },
      eq: (col: string, v: unknown) => filter(col, (x) => x === v),
      neq: (col: string, v: unknown) => filter(col, (x) => x !== v),
      in: (col: string, vs: unknown[]) => filter(col, (x) => vs.includes(x)),
      is: (col: string, v: unknown) => filter(col, (x) => (x ?? null) === v),
      not: (col: string, operator: string, v: string) =>
        filter(col, (x) => !(operator === "in" ? v.replace(/[()]/g, "").split(",").includes(String(x)) : x === v)),
      order: (col: string) => {
        named.push(columnOf(col))
        return builder
      },
      limit: (n: number) => {
        limit = n
        return builder
      },
      single: () => {
        single = "single"
        return builder
      },
      maybeSingle: () => {
        single = "maybe"
        return builder
      },
      then<T>(resolveFn: (r: Result) => T, rejectFn?: (e: unknown) => T) {
        return Promise.resolve(run()).then(resolveFn, rejectFn)
      },
    }
    return builder
  }

  return { client: { from, rpc: async () => ({ data: null, error: null }) }, jobs }
}
