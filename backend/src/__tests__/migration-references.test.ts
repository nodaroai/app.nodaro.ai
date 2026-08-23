import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Guard: a migration may only name tables and columns that exist by the time
 * it runs.
 *
 * PL/pgSQL resolves column names at first EXECUTION, not at CREATE FUNCTION.
 * So a trigger or policy body that references a column a LATER migration
 * adds applies cleanly, passes every test that never fires it, and fails in
 * production the first time the code path runs — an account deletion, an
 * autosave. This check reads every `table.column` and `FROM/JOIN/UPDATE`
 * target out of each organizations migration and asserts it exists in the
 * schema as of that file: everything sorted before it, plus itself.
 *
 * Scope is the organizations migrations (`NNN_orgs_*.sql`), where this
 * pattern has bitten repeatedly. Widen the filter once the remaining history
 * is clean enough to pass.
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations")

/** Aliases and schema prefixes that look like `table.column` but are not. */
const NOT_A_TABLE = new Set([
  "p", "o", "w", "l", "c", "wm", "om", "wf", "ws", "s", "t", "u", "e", "d", "x",
  "new", "old", "new_row", "old_row", "v_row", "v_wf", "excluded",
  "public", "auth", "pg_temp", "pg_catalog", "information_schema",
])

/** Column-shaped things that are not columns. */
const NOT_A_COLUMN = new Set(["*"])

function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
}

/** The schema after applying `files` in order: table -> set of columns. */
function schemaAfter(files: string[]): Map<string, Set<string>> {
  const cols = new Map<string, Set<string>>()
  const norm = (t: string) => t.replace(/^public\./i, "").replace(/"/g, "").toLowerCase()
  const ensure = (t: string) => {
    const k = norm(t)
    if (!cols.has(k)) cols.set(k, new Set())
    return cols.get(k)!
  }
  for (const f of files) {
    const sql = stripCommentsAndStrings(readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([\w."]+)\s*\(/gi)) {
      const set = ensure(m[1])
      let i = m.index! + m[0].length
      let depth = 1
      let cur = ""
      const parts: string[] = []
      for (; i < sql.length && depth > 0; i++) {
        const ch = sql[i]
        if (ch === "(") depth++
        else if (ch === ")") {
          depth--
          if (depth === 0) break
        }
        if (ch === "," && depth === 1) {
          parts.push(cur)
          cur = ""
        } else cur += ch
      }
      parts.push(cur)
      for (const p of parts) {
        const w = (p.trim().split(/\s+/)[0] ?? "").replace(/"/g, "")
        if (w && !/^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|CHECK|EXCLUDE|LIKE)$/i.test(w)) set.add(w.toLowerCase())
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE(?: ONLY)?(?: IF EXISTS)?\s+([\w."]+)([\s\S]*?);/gi)) {
      const set = ensure(m[1])
      for (const c of m[2].matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+"?(\w+)"?/gi)) set.add(c[1].toLowerCase())
      for (const c of m[2].matchAll(/DROP COLUMN(?: IF EXISTS)?\s+"?(\w+)"?/gi)) set.delete(c[1].toLowerCase())
      for (const c of m[2].matchAll(/RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi)) {
        set.delete(c[1].toLowerCase())
        set.add(c[2].toLowerCase())
      }
    }
  }
  return cols
}

/** Every `table.column` and `FROM|JOIN|UPDATE <table>` a file names. */
function references(sql: string): { tableCols: Set<string>; tables: Set<string> } {
  const s = stripCommentsAndStrings(sql)
  const tableCols = new Set<string>()
  const tables = new Set<string>()
  for (const m of s.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_*][a-z0-9_]*)\b/gi)) {
    const t = m[1].toLowerCase()
    const c = m[2].toLowerCase()
    if (NOT_A_TABLE.has(t) || NOT_A_COLUMN.has(c)) continue
    tableCols.add(`${t}.${c}`)
  }
  // FROM, JOIN, UPDATE <table> and INSERT INTO <table> name a table. Bare
  // INTO and ON are left out on purpose: in PL/pgSQL they introduce variables
  // (SELECT ... INTO v_x) and clauses (ON CONFLICT), not tables. Known gaps,
  // so nobody assumes coverage this does not have: a CTE name not in the
  // alias list is flagged as a missing table; only the first table of a
  // comma-join is captured; REFERENCES targets are not checked (a bad one
  // fails loudly at apply, which is the safe direction).
  for (const m of s.matchAll(/\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO)\s+(?:ONLY\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\b/gi)) {
    const t = m[1].toLowerCase()
    if (NOT_A_TABLE.has(t)) continue
    // Keywords, catalog relations, set-returning functions — and the three
    // role names that follow REVOKE ... FROM / GRANT ... TO, which are not
    // tables either.
    if (/^(of|on|set|only|select|insert|delete|conflict|update|table|function|trigger|policy|index|constraint|schema|type|view|extension|cascade|nothing|do|each|row|statement|true|false|null|anon|authenticated|service_role|public|pg_policies|pg_class|pg_constraint|pg_trigger|pg_proc|pg_namespace|jsonb_array_elements|unnest|generate_series)$/.test(t)) continue
    if (/^v_/.test(t)) continue
    tables.add(t)
  }
  return { tableCols, tables }
}

/** Every reference in `sql` that the schema cannot satisfy, as messages. */
function missingRefs(sql: string, schema: Map<string, Set<string>>, file: string): string[] {
  const refs = references(sql)
  const missing: string[] = []
  for (const ref of refs.tableCols) {
    const [t, c] = ref.split(".")
    const set = schema.get(t)
    // An unknown "table" here is usually a function-local alias this list
    // has not met; a known table with an unknown column is the real bug.
    if (set && !set.has(c)) missing.push(`${ref} (column does not exist as of ${file})`)
  }
  for (const t of refs.tables) {
    if (!schema.has(t)) missing.push(`${t} (table does not exist as of ${file})`)
  }
  return missing
}

describe("organizations migrations reference only tables and columns that exist when they run", () => {
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
  const orgs = all.filter((f) => /^\d+_orgs[_-].*\.sql$/.test(f))

  it("finds the organizations migrations it guards", () => {
    expect(orgs.length, "no NNN_orgs_*.sql files found — the glob or the naming convention moved").toBeGreaterThan(0)
  })

  for (const file of orgs) {
    it(`${file} names nothing that does not exist yet`, () => {
      const upTo = all.slice(0, all.indexOf(file) + 1)
      const missing = missingRefs(readFileSync(join(MIGRATIONS_DIR, file), "utf8"), schemaAfter(upTo), file)
      expect(
        missing,
        `a reference that resolves at first execution, not at apply — it would pass CI and fail in production:\n  ${missing.join("\n  ")}`,
      ).toEqual([])
    })
  }

  // Acceptance tests for the guard itself, through the SAME function the
  // per-file checks use — so a regression in the detection logic fails here.
  it("catches a trigger body naming a column that has never existed", () => {
    // An earlier draft of the re-parent trigger referenced assets.project_id.
    const missing = missingRefs(`
      CREATE OR REPLACE FUNCTION reparent_workspace_content() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE assets SET user_id = o.owner_user_id
          FROM organizations o, workspaces w, projects p
          WHERE assets.project_id = p.id AND p.workspace_id = w.id AND w.org_id = o.id AND assets.user_id = OLD.id;
        RETURN OLD;
      END $$;`, schemaAfter(all), "probe.sql")
    expect(missing.some((m) => m.startsWith("assets.project_id "))).toBe(true)
  })

  it("catches an upsert into a table a later migration creates", () => {
    const missing = missingRefs(`
      INSERT INTO workflow_contributors (workflow_id, user_id) VALUES (NEW.id, v_uid)
        ON CONFLICT (workflow_id, user_id) DO UPDATE SET last_edit_count = excluded.last_edit_count + 1;`,
      schemaAfter(all), "probe.sql")
    expect(missing.some((m) => m.startsWith("workflow_contributors "))).toBe(true)
  })
})
