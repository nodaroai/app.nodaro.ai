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
// `NOT NULL` as a column constraint, not the `IS NOT NULL` of a CHECK.
const NOT_NULL = /(?<!\bIS\s+)\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i

/** Split on the commas at paren depth 0 — a column list, or an ALTER's clauses. */
function topLevelParts(text: string): string[] {
  let depth = 0
  let current = ""
  const parts: string[] = []
  for (const ch of text) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      parts.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts
}

/** Each column the migrations leave on `table`, and whether it is NOT NULL. */
function migrationSchemaOf(table: string): Map<string, { notNull: boolean }> {
  const columns = new Map<string, { notNull: boolean }>()
  const name = `(?:public\\.)?"?${table}"?`
  const createRe = new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+${name}\\s*\\(`, "i")
  const alterRe = new RegExp(`ALTER TABLE\\s+(?:IF EXISTS\\s+)?(?:ONLY\\s+)?${name}\\s`, "i")

  for (const statement of migrationStatements()) {
    const create = createRe.exec(statement)
    if (create) {
      // The body ends at the paren that closes the column list.
      const body = statement.slice(create.index + create[0].length)
      let depth = 1
      let end = body.length
      for (let i = 0; i < body.length; i++) {
        if (body[i] === "(") depth++
        if (body[i] === ")") depth--
        if (depth === 0) {
          end = i
          break
        }
      }
      for (const part of topLevelParts(body.slice(0, end))) {
        const match = new RegExp(`^\\s*${IDENT}\\s+[a-zA-Z]`, "i").exec(part)
        if (match && !NOT_A_COLUMN.test(match[1]!)) {
          columns.set(match[1]!.toLowerCase(), { notNull: NOT_NULL.test(part) })
        }
      }
    }
    const alter = alterRe.exec(statement)
    if (alter) {
      // One ALTER can carry many clauses, across as many lines as it likes.
      for (const clause of topLevelParts(statement.slice(alter.index + alter[0].length))) {
        const add = new RegExp(`ADD COLUMN(?:\\s+IF NOT EXISTS)?\\s+${IDENT}`, "i").exec(clause)
        if (add) {
          columns.set(add[1]!.toLowerCase(), { notNull: NOT_NULL.test(clause.slice(add.index + add[0].length)) })
          continue
        }
        const drop = new RegExp(`DROP COLUMN(?:\\s+IF EXISTS)?\\s+${IDENT}`, "i").exec(clause)
        if (drop) {
          columns.delete(drop[1]!.toLowerCase())
          continue
        }
        const rename = new RegExp(`RENAME COLUMN\\s+${IDENT}\\s+TO\\s+${IDENT}`, "i").exec(clause)
        if (rename) {
          const from = rename[1]!.toLowerCase()
          const was = columns.get(from) ?? { notNull: false }
          columns.delete(from)
          columns.set(rename[2]!.toLowerCase(), was)
          continue
        }
        const nullability = new RegExp(`ALTER COLUMN\\s+${IDENT}\\s+(SET|DROP)\\s+NOT\\s+NULL`, "i").exec(clause)
        if (nullability) {
          const column = nullability[1]!.toLowerCase()
          if (columns.has(column)) columns.set(column, { notNull: nullability[2]!.toUpperCase() === "SET" })
        }
      }
    }
  }
  return columns
}

export function migrationColumnsOf(table: string): Set<string> {
  return new Set(migrationSchemaOf(table).keys())
}

/**
 * The columns of `table` the migrations leave NOT NULL (an inline `NOT NULL`
 * or `PRIMARY KEY`, then `ALTER COLUMN ... SET / DROP NOT NULL`). For tests
 * that pin a value the code WRITES: clearing a NOT NULL column to null fails
 * only against the real database.
 */
export function migrationNotNullColumnsOf(table: string): Set<string> {
  const notNull = new Set<string>()
  for (const [column, { notNull: required }] of migrationSchemaOf(table)) if (required) notNull.add(column)
  return notNull
}
