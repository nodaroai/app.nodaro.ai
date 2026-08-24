/**
 * Every column the hydrator selects must actually exist on the table.
 *
 * This is not pedantry. `hydrateEntityNodes` is best-effort by design — a
 * failed lookup leaves the graph alone rather than killing the run — so ONE
 * column that a table does not have turns into a PostgREST 400, the catch
 * swallows it, and that kind silently never hydrates again. Which is exactly
 * the "run succeeds, credits spent, wrong picture, no error anywhere" bug the
 * hydrator exists to kill, re-minted with a green test suite in front of it.
 *
 * It happened on the first draft: `style_lock` was written as a scalar shared
 * by all four kinds, and `characters` is the one table that does not have it.
 * Every unit test passed, because every unit test mocks supabase.
 *
 * So the check reads the migrations — the only source of truth this repo has
 * for the live schema — rather than trusting a hand-kept list.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ENTITY_NODE_KINDS, ENTITY_TABLE, entityHydrationColumns } from "@nodaro/shared"

const MIGRATIONS = join(process.cwd(), "..", "supabase", "migrations")

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .join("\n")
  // Strip line comments so a commented-out DROP COLUMN can't read as real DDL.
  .replace(/^\s*--.*$/gm, "")

/** Statements, roughly: split on `;` at end of line. Good enough for DDL. */
const STATEMENTS = sql.split(/;\s*$/m)

/**
 * Columns that exist on `table` after every migration has run.
 *
 * Additive only — no migration in this repo drops one of these columns, and a
 * DROP would show up as this test failing, which is the right outcome.
 */
function columnsOf(table: string): Set<string> {
  const columns = new Set<string>()
  const createRe = new RegExp(`CREATE TABLE(?: IF NOT EXISTS)?\\s+(?:public\\.)?${table}\\s*\\(`, "i")
  const alterRe = new RegExp(`ALTER TABLE\\s+(?:IF EXISTS\\s+)?(?:ONLY\\s+)?(?:public\\.)?${table}\\s`, "i")

  for (const statement of STATEMENTS) {
    if (createRe.test(statement)) {
      const body = statement.slice(statement.search(createRe))
      for (const line of body.split("\n").slice(1)) {
        if (/^\s*\)/.test(line)) break
        const match = /^\s*"?([a-z_][a-z0-9_]*)"?\s+[a-zA-Z]/.exec(line)
        if (match && !/^(constraint|primary|unique|foreign|check|like|exclude)$/i.test(match[1]!)) {
          columns.add(match[1]!)
        }
      }
    }
    if (alterRe.test(statement)) {
      // One ALTER can add many columns, across as many lines as it likes.
      const add = /ADD COLUMN(?: IF NOT EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?/gi
      let match: RegExpExecArray | null
      while ((match = add.exec(statement))) columns.add(match[1]!)
    }
  }
  return columns
}

describe("entity hydration selects only columns that exist", () => {
  it("the migration scan itself works", () => {
    // A parser that silently found nothing would pass every case below.
    const characters = columnsOf("characters")
    expect(characters.has("id")).toBe(true)
    expect(characters.has("source_image_url")).toBe(true)
    expect(characters.has("body_angles")).toBe(true)
    expect(characters.has("no_such_column_anywhere")).toBe(false)
    // And the specific asymmetry that caused this test to exist.
    expect(characters.has("style_lock")).toBe(false)
    expect(columnsOf("objects").has("style_lock")).toBe(true)
  })

  it.each(ENTITY_NODE_KINDS)("%s", (kind) => {
    const existing = columnsOf(ENTITY_TABLE[kind])
    expect(existing.size, `no CREATE TABLE found for ${ENTITY_TABLE[kind]}`).toBeGreaterThan(5)
    const missing = entityHydrationColumns(kind).filter((column) => !existing.has(column))
    expect(missing, `${ENTITY_TABLE[kind]} has no ${missing.join(", ")}`).toEqual([])
  })

  it.each(ENTITY_NODE_KINDS)("%s is also filtered by columns that exist", (kind) => {
    // The hydrator filters on these two beyond what it selects; a missing one
    // fails the same silent way.
    const existing = columnsOf(ENTITY_TABLE[kind])
    expect(existing.has("user_id")).toBe(true)
    expect(existing.has("deleted_at")).toBe(true)
  })
})
