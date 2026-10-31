// @test-watches backend/src/**/*.ts
/**
 * WITHDRAW CENSUS — every cancel reaches the concurrency lanes.
 *
 * A job (or a run) waiting for a slot stands in its line until something takes
 * it out. A cancel that flips its row without withdrawing it leaves a GHOST at
 * the head: every job behind it waits for a slot that is reserved for a row
 * that will never run, until the waiter TTL drops it (25 minutes).
 *
 * So every non-test file that writes `status: "cancelled"` on `jobs`,
 * `workflow_executions` or `pipelines` must reach a withdraw — call
 * `withdrawFromLane(` itself, or the removal funnel that does
 * (`tryRemoveFromQueue(`, which withdraws the job it is handed) — or be listed
 * here WITH the reason it cannot strand a waiter. `markJobFailed` does NOT
 * count: it withdraws only the row it fails itself, never a row the same file
 * cancels. A stale entry fails, so a file that starts withdrawing (or stops
 * writing) leaves no permanent hole behind it.
 *
 * File-keyed, like the result-gate totality guard: a file that already
 * withdraws can add a second cancel write unseen. Not matched at all: a status
 * held in a variable (`{ status: targetStatus }`) or built far from its write.
 * The waiter TTL and the head reconcile are the backstop for both.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..", "..")

const TABLES = new Set(["jobs", "workflow_executions", "pipelines"])
/** Calls that withdraw the row a cancel writes: the withdraw itself, and the removal funnel that runs it. */
const FUNNEL = /withdrawFromLane\(|tryRemoveFromQueue\(/

/** Cancel writers that cannot strand a waiter, and why. */
const ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ["routes/app-run-resume.ts", "cancels a run it inserted moments before, before it was ever enqueued (another tab moved the run on): it never entered a line"],
  ["routes/character-training.ts", "LoRA training is deliberately not limited — it never waits in a lane — and the row is already at the provider"],
  ["routes/characters.ts", "LoRA training (a character's deletion stops it): never waits in a lane, and the row is already at the provider"],
  ["scripts/cleanup-stuck-pipelines.ts", "operator script for pipelines stuck mid-run, never a waiting one; anything it could leave behind is dropped within the waiter TTL"],
  ["lib/job-policy-gate.ts", "withdrawHeldJob cancels a `pending_review` row only: a job held for review has finished running and never waits in a lane"],
  ["lib/reconcile/replicate.ts", "LoRA training the provider cancelled: training is deliberately not limited and the row is already at the provider"],
  ["routes/replicate-training-webhook.ts", "LoRA training the provider reports cancelled: training is deliberately not limited and the row is already at the provider"],
  ["workers/orchestrator-cancel.ts", "the orchestrator ending a run it is executing: the run holds its slot (its worker releases it), it is not waiting"],
])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "test") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(p))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !e.name.endsWith(".test.ts")) out.push(p)
  }
  return out
}

function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

interface Hit { file: string; line: number; table: string; withdraws: boolean }

/**
 * A `status: "cancelled"` (or the ternary form) inside an update of one of the
 * three tables: a `.from("<table>")…update(` chain, or the execution writer
 * `updateExecutionWithRetry(`. The backward window is bounded so a `.from`
 * earlier in the file cannot be mistaken for this statement's table.
 */
function cancelWrites(): Hit[] {
  const LIT = /status:\s*["']cancelled["']|\?\s*["']cancelled["']\s*:/g
  const hits: Hit[] = []
  for (const abs of tsFiles(SRC)) {
    const file = abs.slice(SRC.length + 1).split("\\").join("/")
    const src = blankComments(readFileSync(abs, "utf8"))
    const withdraws = FUNNEL.test(src)
    for (const m of src.matchAll(LIT)) {
      const win = src.slice(Math.max(0, m.index - 600), m.index)
      const writers = [...win.matchAll(/\.from\(\s*["']([a-z_]+)["']|updateExecutionWithRetry\(/g)]
      const last = writers[writers.length - 1]
      if (!last) continue
      const table = last[1] ?? "workflow_executions"
      if (!TABLES.has(table)) continue
      if (last[1] && !/\.update\s*\(/.test(win.slice(last.index! + last[0].length))) continue
      hits.push({ file, line: src.slice(0, m.index).split("\n").length, table, withdraws })
    }
  }
  return hits
}

describe("every cancel of a job, a run or a pipeline reaches a withdraw", () => {
  const hits = cancelWrites()

  it("scans the real write population", () => {
    expect(hits.length).toBeGreaterThan(10)
    for (const table of TABLES) expect(hits.some((h) => h.table === table), `no cancel write found on ${table}`).toBe(true)
  })

  it("no cancel writer skips the withdraw unless it is listed with a reason", () => {
    const offenders = hits.filter((h) => !h.withdraws && !ALLOWLIST.has(h.file)).map((h) => `  • ${h.file}:${h.line} (${h.table})`)
    expect(
      offenders,
      `These write status:"cancelled" without reaching a concurrency-lane withdraw, so a job or run ` +
        `cancelled while it waits for a slot stays at the head of its line and blocks it (a ghost) ` +
        `until the waiter TTL drops it.\n\nCall withdrawFromLane(id) from lib/concurrency-lanes/withdraw.js ` +
        `right after the write that won (or go through tryRemoveFromQueue; markJobFailed does not count — ` +
        `it withdraws only the row it fails). If the ` +
        `row can never be waiting, add the file to ALLOWLIST *with the reason*.\n\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("has no stale allowlist entry", () => {
    const stale = [...ALLOWLIST.keys()].filter((f) => !hits.some((h) => h.file === f && !h.withdraws))
    expect(stale, `Listed files that no longer write status:"cancelled" without a withdraw — delete them:\n${stale.join("\n")}`).toEqual([])
  })
})

describe("anti-vacuity — what the census accepts really withdraws", () => {
  const read = (rel: string) => blankComments(readFileSync(join(SRC, rel), "utf8"))

  it("withdrawFromLane asks the gate to withdraw", () => {
    expect(read("lib/concurrency-lanes/withdraw.ts")).toMatch(/\.withdraw\(jobId\)/)
  })

  it("tryRemoveFromQueue, the one funnel it accepts, withdraws the job it is handed", () => {
    expect(read("lib/queue.ts")).toMatch(/withdrawFromLane\(jobId\)/)
  })

  it("markJobFailed withdraws the row it fails (a failure path, not a cancel funnel)", () => {
    expect(read("lib/job-failure.ts")).toMatch(/withdrawFromLane\(jobId\)/)
  })
})
