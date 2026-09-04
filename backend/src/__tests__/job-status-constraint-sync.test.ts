/**
 * Guard: `JOB_STATUSES` (TypeScript) and the `jobs.status` CHECK constraint
 * (Postgres) must name EXACTLY the same set.
 *
 * WHY. Two failure directions, both silent in CI because every unit test mocks
 * Supabase and no test exercises a real constraint:
 *
 *   • TS ⊃ DB — `pending_review` in `JOB_STATUSES` with the CHECK un-widened
 *     means every hold write (`markJobHeld`'s CAS) throws a check_violation
 *     (SQLSTATE 23514) in production. The route returns a generic 500 and the
 *     job's credits stay reserved with nothing holding them.
 *   • DB ⊃ TS — a status the database can hold that the code does not know.
 *     `routes/jobs.ts:29,56` validate RESPONSES with `z.enum(JOB_STATUSES)`, so
 *     a real row fails response validation on `GET /v1/jobs/:id`.
 *
 * Set equality, not a subset, catches both. This is the same class of drift the
 * `workflow_executions.trigger_type` constraint suffered three times
 * (`trigger-type-constraint-sync.test.ts`) — with one adaptation: that
 * constraint is always (re)declared with `ADD CONSTRAINT`, whereas
 * `001_initial_schema.sql:109` declares this one INLINE on the column and gives
 * it no name at all (Postgres auto-names it `jobs_status_check`). So the parser
 * tries the `ADD CONSTRAINT` form first and falls back to the inline form,
 * reporting which one won.
 *
 * The inline fallback is SCOPED to the `CREATE TABLE … public.jobs (…)` block
 * on purpose: `001_initial_schema.sql` declares two other inline
 * `CHECK (status IN (…))` constraints — `subscriptions` (:193) and
 * `credit_transactions` (:208, whose set is literally
 * `('pending','completed','failed')`. An unscoped regex reads the wrong table
 * and the guard passes while the schema is wrong.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { JOB_STATUSES } from "../lib/job-status.js"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations")

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()

/** `ALTER TABLE [public.]jobs ADD CONSTRAINT <name> CHECK ( status IN ( … ) )`,
 *  multi-line tolerant (`\s` matches newlines) — 377 wraps the CHECK body and
 *  puts `NOT VALID` after the closing paren. */
const ADD_CONSTRAINT_FORM =
  /ALTER\s+TABLE\s+(?:public\.)?jobs\s+ADD\s+CONSTRAINT\s+(\w+)\s+CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i

/** The `CREATE TABLE … jobs (` header — used only to bound the inline search. */
const JOBS_TABLE_HEADER = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?jobs\s*\(/i

/** `status TEXT … CHECK (status IN ( … ))`, searched ONLY inside that block. */
const INLINE_FORM = /status\s+TEXT[\s\S]*?CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i

function quotedValues(list: string): Set<string> {
  return new Set([...list.matchAll(/'([a-z0-9_]+)'/gi)].map((m) => m[1]))
}

interface Declaration {
  values: Set<string>
  file: string
  form: "ADD CONSTRAINT" | "inline column CHECK"
  name: string | null
  sql: string
}

/**
 * The LAST migration (filename order = apply order) that declares the
 * `jobs.status` CHECK wins — that is the constraint currently deployed.
 */
function deployedStatusCheck(): Declaration {
  let winner: Declaration | undefined

  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")

    const added = sql.match(ADD_CONSTRAINT_FORM)
    if (added) {
      winner = { values: quotedValues(added[2]), file, form: "ADD CONSTRAINT", name: added[1], sql }
      continue
    }

    const header = sql.match(JOBS_TABLE_HEADER)
    if (!header) continue
    // Bound the search to this CREATE TABLE statement so the subscriptions /
    // credit_transactions inline CHECKs in the same file cannot be read.
    const bodyStart = header.index! + header[0].length
    const bodyEnd = sql.indexOf("\n);", bodyStart)
    const body = sql.slice(bodyStart, bodyEnd === -1 ? sql.length : bodyEnd)
    const inline = body.match(INLINE_FORM)
    if (inline) {
      winner = { values: quotedValues(inline[1]), file, form: "inline column CHECK", name: null, sql }
    }
  }

  if (!winner) {
    throw new Error(
      "No migration declares the jobs.status CHECK in either supported form " +
        "(ALTER TABLE jobs ADD CONSTRAINT … CHECK (status IN (…)), or an inline " +
        "status TEXT … CHECK (status IN (…)) inside CREATE TABLE jobs).",
    )
  }
  return winner
}

describe("jobs.status: TypeScript vocabulary ⇔ the deployed CHECK constraint", () => {
  const deployed = deployedStatusCheck()

  it(`derives a non-empty set from the newest declaration (${deployed.file}, ${deployed.form})`, () => {
    expect(deployed.values.size).toBeGreaterThan(0)
  })

  it("the CHECK admits exactly JOB_STATUSES — no more, no less", () => {
    const inDbNotInTs = [...deployed.values].filter((v) => !(JOB_STATUSES as readonly string[]).includes(v))
    const inTsNotInDb = [...JOB_STATUSES].filter((v) => !deployed.values.has(v))

    expect(
      { inTsNotInDb, inDbNotInTs },
      `jobs.status has drifted between code and schema. The deployed constraint is ` +
        `declared in ${deployed.file} (${deployed.form}${deployed.name ? `, "${deployed.name}"` : ""}) ` +
        `as {${[...deployed.values].sort().join(", ")}}; JOB_STATUSES is ` +
        `{${[...JOB_STATUSES].sort().join(", ")}}.\n\n` +
        `  • inTsNotInDb — Postgres REJECTS these with a check_violation (23514) at ` +
        `runtime; the write throws and the route answers a generic 500. Add a ` +
        `widening migration.\n` +
        `  • inDbNotInTs — a real row's status fails z.enum(JOB_STATUSES) response ` +
        `validation in routes/jobs.ts:29,56 (a 500 on GET /v1/jobs/:id). Add the ` +
        `literal to JOB_STATUSES and place it in IN_FLIGHT or TERMINAL.`,
    ).toEqual({ inTsNotInDb: [], inDbNotInTs: [] })
  })

  it("rejects a status outside the vocabulary (the CHECK is a real allow-list)", () => {
    // The point of a CHECK: 'bogus' must not be insertable. This is the static
    // half of the rehearsal assertion ("INSERT status='bogus' is rejected") —
    // the constraint enumerates values rather than being a no-op predicate.
    expect(deployed.values.has("bogus")).toBe(false)
    expect(deployed.values.has("running")).toBe(false)
    expect(deployed.values.size).toBe(JOB_STATUSES.length)
  })

  /**
   * The widening is split across two migrations ON PURPOSE (spec §12): the
   * `ADD CONSTRAINT … NOT VALID` in 377 takes ACCESS EXCLUSIVE on `jobs` for an
   * instant and does NOT scan; the `VALIDATE CONSTRAINT` in 378 scans under
   * SHARE UPDATE EXCLUSIVE. Both runners are per-FILE transactional
   * (`supabase db push`, `backend/scripts/run-migrations.mjs:110-116`), so
   * folding them into one file would hold the exclusive lock through the whole
   * scan of the busiest table in the schema. Assert the split survives.
   */
  it("a re-declared CHECK is added NOT VALID and VALIDATEd in a LATER migration", () => {
    if (deployed.form !== "ADD CONSTRAINT") return // still the 001 inline form

    const addStmt = deployed.sql.slice(deployed.sql.search(ADD_CONSTRAINT_FORM))
    expect(
      /NOT\s+VALID/i.test(addStmt.slice(0, 600)),
      `${deployed.file} adds ${deployed.name} without NOT VALID — the ADD then scans ` +
        `every row of jobs while holding ACCESS EXCLUSIVE.`,
    ).toBe(true)

    const validateRe = new RegExp(
      `VALIDATE\\s+CONSTRAINT\\s+${deployed.name!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    )
    const later = MIGRATION_FILES.filter((f) => f > deployed.file).filter((f) =>
      validateRe.test(readFileSync(join(MIGRATIONS_DIR, f), "utf8")),
    )
    expect(
      later,
      `No migration after ${deployed.file} runs "ALTER TABLE public.jobs VALIDATE ` +
        `CONSTRAINT ${deployed.name}". A NOT VALID constraint is enforced for new ` +
        `writes but never proves the existing rows, and pg_dump carries the NOT ` +
        `VALID flag forward forever.`,
    ).not.toEqual([])
    expect(validateRe.test(deployed.sql)).toBe(false)
  })
})
