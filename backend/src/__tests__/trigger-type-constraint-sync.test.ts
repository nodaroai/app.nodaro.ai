/**
 * Guard: every trigger_type value the backend INSERTs into workflow_executions
 * must be permitted by the `workflow_executions_trigger_type_check` DB
 * constraint.
 *
 * Why this exists — the constraint has silently drifted from the code THREE
 * times: migration 086 added 'app_run', 095 added 'mcp', 249 added 'api' +
 * 'telegram'. Each drift shipped a route whose INSERT Postgres rejects at
 * runtime with a check_violation (SQLSTATE 23514), returning a generic 500.
 * It is invisible to the rest of CI because unit tests mock Supabase, so the
 * CHECK constraint is never exercised. The public `POST /v1/api/run` route was
 * dead-on-arrival for months (it inserts trigger_type: "api") until this was
 * caught in production.
 *
 * This test derives the allowed set from the migration SQL — the single source
 * of truth for the deployed constraint — and asserts that every trigger_type /
 * triggerType string literal ASSIGNED in backend/src is within it. Add a new
 * trigger_type value in code without a widening migration → this fails at PR
 * time instead of at a customer's first API call.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations")
const BACKEND_SRC = join(__dirname, "..")

const CONSTRAINT = "workflow_executions_trigger_type_check"

/** Strip `//` line comments and block comments so documented examples of a
 *  `trigger_type: "…"` assignment inside a comment don't count as real code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1") // avoid eating "https://" in strings
}

/**
 * The latest migration (by sorted filename) that (re)defines the constraint
 * via `add constraint <name> check (trigger_type in (…))` wins — that is the
 * form of the currently-deployed constraint.
 */
function allowedTriggerTypesFromMigrations(): { values: Set<string>; file: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  const re = new RegExp(
    `add\\s+constraint\\s+${CONSTRAINT}\\s+check\\s*\\(\\s*trigger_type\\s+in\\s*\\(([^)]*)\\)`,
    "i",
  )

  let winner: { values: Set<string>; file: string } | undefined
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8")
    const m = sql.match(re)
    if (!m) continue
    const values = new Set([...m[1].matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]))
    winner = { values, file: f } // sorted ascending → last match is newest
  }

  if (!winner) {
    throw new Error(
      `No migration defines ${CONSTRAINT} via "add constraint … check (trigger_type in (…))".`,
    )
  }
  return winner
}

/** Recursively collect *.ts files under dir, skipping node_modules + test dirs. */
function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "__tests__") continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...tsFiles(p))
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

/**
 * Extract trigger_type/triggerType string literals ASSIGNED in object-literal
 * (`key: "value"`) form in backend code, mapped to the files that use them.
 *
 * The bare-colon match (negative lookbehind on `"` / word / `.`) deliberately
 * ignores `"trigger_type"` used as a quoted column name in `.select()` /
 * `.eq()` and `triggerType: row.trigger_type` re-mappings (no string literal
 * follows). Ternaries like `triggerType: mcpClient ? "mcp" : "manual"` are
 * captured because both literals sit on the same line.
 */
function assignedTriggerTypesInCode(): Map<string, string[]> {
  const keyRe = /(?<!["\w.])(?:trigger_type|triggerType)\s*:/g
  const found = new Map<string, string[]>()

  for (const file of tsFiles(BACKEND_SRC)) {
    const src = stripComments(readFileSync(file, "utf8"))
    for (const km of src.matchAll(keyRe)) {
      const start = km.index! + km[0].length
      const sameLine = src.slice(start, start + 160).split("\n")[0]
      for (const vm of sameLine.matchAll(/"([a-z][a-z0-9_]*)"/g)) {
        const rel = file.slice(REPO_ROOT.length + 1)
        found.set(vm[1], [...(found.get(vm[1]) ?? []), rel])
      }
    }
  }
  return found
}

describe("workflow_executions trigger_type: code ⊆ DB constraint", () => {
  const { values: allowed, file } = allowedTriggerTypesFromMigrations()

  it(`derives a non-empty allowed set from the latest constraint migration (${file})`, () => {
    expect(allowed.size).toBeGreaterThan(0)
  })

  it("every trigger_type literal inserted in backend/src is permitted by the constraint", () => {
    const used = assignedTriggerTypesInCode()
    const violations = [...used.entries()]
      .filter(([val]) => !allowed.has(val))
      .map(([val, files]) => `  • "${val}" (used in ${[...new Set(files)].join(", ")})`)

    expect(
      violations,
      `These trigger_type values are inserted by backend code but are NOT in the ` +
        `${CONSTRAINT} constraint (latest defined in ${file}: ` +
        `{${[...allowed].sort().join(", ")}}). Postgres rejects the INSERT with a ` +
        `check_violation (23514) at runtime — the route returns a generic 500. Add ` +
        `the value(s) to a new widening migration:\n${violations.join("\n")}`,
    ).toEqual([])
  })
})
