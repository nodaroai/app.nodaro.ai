// @test-watches backend/src/**/*.ts
/**
 * Every row inserted into `workflow_executions` names the install that created it (`runtime_env`).
 *
 * Staging and production share one database, but each has its own orchestration queue, so a
 * sweep may judge only the runs its own install holds (lib/runtime-env.ts). A claimed run
 * carries the claiming install's name. A run that never started was claimed by nobody: without
 * a stamp at insert, no install could tell it was its own, and the never-started sweep
 * (lib/reconcile/never-started-executions.ts) could settle it only on production. So every
 * insert row names `runtime_env` once, as an unconditional top-level key written in place
 * as `runtime_env: getRuntimeEnv()` (never a literal or another value, which would hand the
 * run to an install that does not hold its job), and no spread in the row sets it again.
 *
 * Rows are read with the same AST walk as `workflow-execution-inserts.test.ts` (which lists
 * every insert); a row that walk cannot see into fails there. A column builder's output is
 * opaque to this walk, so that file also holds every builder to never write `runtime_env`.
 */
import { describe, expect, it } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, parseText } from "./source-scan.js"
import { EXECUTIONS_TABLE, executionWrites, unwrap } from "./execution-row-ast.js"

interface Scan {
  readonly findings: string[]
  /** How many insert rows were checked (the guard is wired to something). */
  rows: number
}

/** `getRuntimeEnv()`, called with no argument: the name of the install this process belongs to. */
function isInstallStamp(value: ts.Expression): boolean {
  const at = unwrap(value)
  return ts.isCallExpression(at) && ts.isIdentifier(at.expression) && at.expression.text === "getRuntimeEnv" && at.arguments.length === 0
}

function scanFile(sf: ts.SourceFile, rel: string, scan: Scan): void {
  // Column builders only decide whether a spread is "blind"; the stamp must be a direct key either way.
  const { writes } = executionWrites(sf, new Set())
  for (const write of writes.filter((w) => w.kind === "insert")) {
    for (const shape of write.shapes) {
      scan.rows++
      const stamps = shape.direct.get("runtime_env") ?? []
      if (stamps.length !== 1 || shape.spread.has("runtime_env")) {
        scan.findings.push(
          `${rel}:${write.line} ${write.via}: a row that does not name the install that created it once — write runtime_env: getRuntimeEnv() (lib/runtime-env.ts) as a top-level key of the row, and set it in no spread`,
        )
      } else if (!isInstallStamp(stamps[0]!)) {
        scan.findings.push(
          `${rel}:${write.line} ${write.via}: runtime_env is ${stamps[0]!.getText(sf)} — write runtime_env: getRuntimeEnv() (lib/runtime-env.ts): only the install that created the run holds its queue job`,
        )
      }
    }
  }
}

describe("every workflow_executions insert names the install that created the run", { timeout: SCAN_TIMEOUT_MS }, () => {
  const scan: Scan = { findings: [], rows: 0 }
  eachSourceFile([EXECUTIONS_TABLE, "insertWithIdempotencyKey"], (sf, rel) => scanFile(sf, rel, scan))

  it("finds the inserts (the guard is wired to something)", () => {
    expect(scan.rows).toBeGreaterThanOrEqual(13)
  })

  it("stamps runtime_env in every insert row", () => {
    expect(scan.findings, "each finding names the row to stamp").toEqual([])
  })
})

describe("the install-stamp guard matches the shapes it exists for (self-test)", () => {
  const run = (source: string) => {
    const scan: Scan = { findings: [], rows: 0 }
    scanFile(parseText("x.ts", source), "x.ts", scan)
    return scan
  }

  it.each([
    ["a row with no stamp", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: "webhook" })`, 1],
    ["a stamp only in a conditional spread", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: "webhook", ...(x ? { runtime_env: getRuntimeEnv() } : {}) })`, 1],
    ["a stamp a spread can override", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: "webhook", runtime_env: getRuntimeEnv(), ...(x ? { runtime_env: other } : {}) })`, 1],
    ["one row of two with no stamp", `supabase.from("workflow_executions").insert([{ user_id: u, runtime_env: getRuntimeEnv() }, { user_id: u }])`, 1],
    ["a helper insert with no stamp", `insertWithIdempotencyKey("workflow_executions", { user_id: u, trigger_type: "manual" }, key)`, 1],
  ] as Array<[string, string, number]>)("%s", (_name, source, expected) => {
    const found = run(source).findings
    expect(found).toHaveLength(expected)
    expect(found[0]).toContain("does not name the install")
  })

  it.each([
    ["a literal install name", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: "webhook", runtime_env: "production" })`],
    ["a value from elsewhere", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: "webhook", runtime_env: body.env })`],
    ["the lookup given another install", `supabase.from("workflow_executions").insert({ user_id: u, trigger_type: "webhook", runtime_env: getRuntimeEnv(other) })`],
    ["a null stamp", `insertWithIdempotencyKey("workflow_executions", { user_id: u, trigger_type: "manual", runtime_env: null }, key)`],
  ] as Array<[string, string]>)("a stamp that is not this install's own name: %s", (_name, source) => {
    const found = run(source).findings
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("write runtime_env: getRuntimeEnv()")
  })

  it("passes the shapes the platform writes, and ignores updates", () => {
    const scan = run(`
      supabase.from("workflow_executions").insert({ workflow_id: w, user_id: u, status: "pending", trigger_type: "webhook", runtime_env: getRuntimeEnv(), ...billingPairColumns(ctx) })
      insertWithIdempotencyKey("workflow_executions", { user_id: u, trigger_type: "manual", runtime_env: getRuntimeEnv() }, key)
      const row = { user_id: u, trigger_type: "schedule", runtime_env: getRuntimeEnv() }
      void supabase.from("workflow_executions").insert(row)
      supabase.from("workflow_executions").insert(items.map((i) => ({ user_id: i, trigger_type: "telegram", runtime_env: getRuntimeEnv() })))
      supabase.from("workflow_executions").update({ status: "failed" }).eq("id", id)
    `)
    expect(scan.findings).toEqual([])
    expect(scan.rows).toBe(4)
  })
})
