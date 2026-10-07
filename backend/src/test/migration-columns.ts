/**
 * The columns a table has after every migration in `supabase/migrations/` has
 * run — the only source of truth this repo has for the live schema.
 *
 * For tests that pin a column NAME the code sends to PostgREST. Every route
 * test mocks supabase, so a column that does not exist passes them all and
 * fails only against the real database (the admin expunge cleared
 * `app_runs.input_data` / `output_data`, which no migration ever created).
 *
 * A rough DDL reader, not a SQL parser: it follows `CREATE TABLE` bodies and
 * `ALTER TABLE ... ADD / DROP / RENAME COLUMN`, in file order. Callers should
 * self-check it (a known column present, a made-up one absent) so a parse that
 * silently finds nothing cannot pass.
 */
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations")

let statements: string[] | null = null

function migrationStatements(): string[] {
  if (statements) return statements
  const sql = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n")
    // Comments first, so a commented-out DROP COLUMN cannot read as real DDL.
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
  // Statements, roughly: split on every `;`. A function body falls apart into
  // fragments, none of which reads as table DDL; two statements on one line
  // stay apart, so one table's ADD COLUMN never lands on another.
  statements = sql.split(";")
  return statements
}

const IDENT = `"?([a-z_][a-z0-9_]*)"?`
const NOT_A_COLUMN = /^(constraint|primary|unique|foreign|check|like|exclude)$/i

export function migrationColumnsOf(table: string): Set<string> {
  const columns = new Set<string>()
  const name = `(?:public\\.)?"?${table}"?`
  const createRe = new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+${name}\\s*\\(`, "i")
  const alterRe = new RegExp(`ALTER TABLE\\s+(?:IF EXISTS\\s+)?(?:ONLY\\s+)?${name}\\s`, "i")

  for (const statement of migrationStatements()) {
    const create = createRe.exec(statement)
    if (create) {
      const body = statement.slice(create.index + create[0].length)
      let depth = 1
      let current = ""
      const parts: string[] = []
      for (const ch of body) {
        if (ch === "(") depth++
        if (ch === ")") depth--
        if (depth === 0) break
        if (ch === "," && depth === 1) {
          parts.push(current)
          current = ""
        } else {
          current += ch
        }
      }
      parts.push(current)
      for (const part of parts) {
        const match = new RegExp(`^\\s*${IDENT}\\s+[a-zA-Z]`, "i").exec(part)
        if (match && !NOT_A_COLUMN.test(match[1]!)) columns.add(match[1]!.toLowerCase())
      }
    }
    if (alterRe.test(statement)) {
      // One ALTER can carry many clauses, across as many lines as it likes.
      for (const m of statement.matchAll(new RegExp(`ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+${IDENT}`, "gi"))) {
        columns.add(m[1]!.toLowerCase())
      }
      for (const m of statement.matchAll(new RegExp(`DROP COLUMN(?:\\s+IF EXISTS)?\\s+${IDENT}`, "gi"))) {
        columns.delete(m[1]!.toLowerCase())
      }
      for (const m of statement.matchAll(new RegExp(`RENAME COLUMN\\s+${IDENT}\\s+TO\\s+${IDENT}`, "gi"))) {
        columns.delete(m[1]!.toLowerCase())
        columns.add(m[2]!.toLowerCase())
      }
    }
  }
  return columns
}
