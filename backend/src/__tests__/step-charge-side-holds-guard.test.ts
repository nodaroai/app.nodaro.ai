// @test-watches backend/src/**/*.ts
/**
 * R53: a job's charge as a step of a run includes its settled metered SIDE
 * holds (migration 554 — a call the job made beside its own reservation, a UGC
 * clip's frame check), which never write the job's row. A reader that takes a
 * job's charge from `jobs.credits_actual` (or its usage log) alone silently
 * drops them — the run total, the app-run total, a monetized app's creator fee
 * base, the public `credits_charged`.
 *
 * Every backend source that SELECTS `credits_actual` (a column-list string
 * naming it) is classified here: a reader of a step's charge must reference
 * the side-hold helper (`lib/job-step-charge.ts`); anything else says why it
 * is not one. A new reader fails until it is classified — deliberately.
 *
 * ITS REAL SCOPE (what it can and cannot see): a `credits_actual` named inside
 * a column-list string literal in backend source (comments stripped), and every
 * caller of `creditsChargedOf`. It does NOT see a step's charge read another way
 * — a usage log's `credits_charged` looked up by the job, `jobs.credits` alone,
 * a column list built at run time, or SQL (an RPC, a view, a trigger such as
 * 537's app-run total, which sums executions the node executor already summed
 * with side holds). A reader of those kinds must be reviewed by hand.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")

/** Readers of a step's charge: each must add the job's settled side holds. */
const STEP_CHARGE_READERS: Record<string, string> = {
  "services/workflow-engine/node-executor.ts": "a run step's creditsUsed (poll, cancel-race adoption, fan-out reuse, a UGC child's jobCharge) — the execution total, the app-run total and the creator fee base sum it",
  "routes/jobs.ts": "the public per-job credits_charged (GET /v1/jobs, /v1/jobs/:id)",
  "lib/mcp/tools/diagnose.ts": "diagnose_run's per-step credits",
  "ee/lib/ugc-quote.ts": "the UGC quote's already-spent lines",
}

/** Sources that select `credits_actual` but are not a reader of a step's charge — each with why. */
const NOT_STEP_CHARGE_READERS: Record<string, string> = {
  "ee/billing/llm-billing-impl.ts": "the metered settle and sweep: read and write the job's OWN charge (a side hold has its own sink)",
  "ee/copilot/turn-runner.ts": "a Copilot turn's own job, which makes no side calls",
  "ee/pipelines/services/_poll.ts": "returns the row; its consumer (_run-worker-job.ts, checked below) adds the side holds",
  "ee/routes/admin-credit-audit.ts": "admin per-task pricing audit of each job's OWN charge against its OWN provider cost; side holds are audited per (feature, model) by the LLM mode (admin-credit-audit-llm.ts)",
  "services/workflow-engine/use-case-node.ts": "a use-case wrapper's credits_actual is its inner execution's total (finalize-wrapper), already summed by node-executor with side holds",
}

/** Consumers of a reader above that must add the side holds themselves. */
const SIDE_AWARE_CONSUMERS = ["ee/pipelines/services/_run-worker-job.ts", "lib/mcp/tools/jobs.ts", "lib/webhooks/event.ts"]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      walk(path, out)
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path)
  }
  return out
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

/** Column-list string literals naming `credits_actual` (a select), never a write's object key or a log line. */
function selectsCreditsActual(source: string): boolean {
  const code = stripComments(source)
  for (const m of code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*?\bcredits_actual\b(?:(?!\1)[^\\\n]|\\.)*?)\1/g)) {
    const lit = m[2]!
    if (lit.includes(").")) continue
    if (/[^,\s] +\S/.test(lit.replace(/\$\{[^}]*\}/g, "x"))) continue
    return true
  }
  return false
}

const usesSideHelper = (source: string) => /\b(sideHoldChargesFor|withSideHoldCharge)\(/.test(source)

describe("R53 — every reader of a job's charge adds its settled side holds", () => {
  const files = walk(SRC).map((f) => ({ rel: relative(SRC, f), source: readFileSync(f, "utf8") }))

  it("every source that selects credits_actual is classified", () => {
    const selecting = files.filter((f) => selectsCreditsActual(f.source)).map((f) => f.rel).sort()
    expect(
      selecting,
      "A new reader of jobs.credits_actual: if it is a step's charge in a run (a total, a fee base, a public charge), add the job's settled side holds through lib/job-step-charge.ts and list it in STEP_CHARGE_READERS; otherwise list it in NOT_STEP_CHARGE_READERS with why.",
    ).toEqual([...Object.keys(STEP_CHARGE_READERS), ...Object.keys(NOT_STEP_CHARGE_READERS)].sort())
  })

  it("each reader of a step's charge, and each consumer named, goes through the side-hold helper", () => {
    for (const rel of [...Object.keys(STEP_CHARGE_READERS), ...SIDE_AWARE_CONSUMERS]) {
      const file = files.find((f) => f.rel === rel)
      expect(file, rel).toBeDefined()
      expect(usesSideHelper(file!.source), `${rel} must add sideHoldChargesFor / withSideHoldCharge`).toBe(true)
    }
  })

  it("creditsChargedOf (the public charge) cannot be called without the side charges", () => {
    for (const f of files.filter((x) => /\bcreditsChargedOf\(/.test(stripComments(x.source)) && x.rel !== "lib/job-credit-status.ts")) {
      expect(usesSideHelper(f.source), `${f.rel} calls creditsChargedOf without sideHoldChargesFor`).toBe(true)
    }
  })
})
