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
 * A job's PUBLIC charge is also a run's: it includes the job's steps (child
 * jobs, `parent_job_id`, each billed on its own usage log). `runCreditsFor`
 * (lib/job-credit-status.ts) is the one loader that reads both the steps and
 * the side holds, and `creditsChargedOf` takes only what it returns (a branded
 * type, so tsc refuses anything else). The last two cases hold every caller to
 * it and every other direct reader of a job's usage log to a stated reason.
 *
 * ITS REAL SCOPE (what it can and cannot see): a `credits_actual` named inside
 * a column-list string literal in backend source (comments stripped), every
 * caller of `creditsChargedOf` and every caller of `creditStatusMapFor`. It does NOT see a step's charge read another way
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
  "services/workflow-engine/node-executor.ts": "a run step's creditsUsed (poll, cancel-race adoption, fan-out reuse, a UGC child's jobCharge) — the execution total, the app-run total and the creator fee base sum it; through runCreditsFor, so its job's steps (child jobs) count too",
  "routes/jobs.ts": "the public per-job credits_charged (GET /v1/jobs, /v1/jobs/:id), through runCreditsFor",
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

/** Readers whose figure is a workflow total (execution, app run, creator fee base): they must also add the job's steps (child jobs), through runCreditsFor. */
const RUN_STEP_TOTAL_READERS = ["services/workflow-engine/node-executor.ts"]

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

/** The side-hold helpers, or the run loader that adds them (and the steps). */
const usesSideHelper = (source: string) => /\b(sideHoldChargesFor|withSideHoldCharge|runCreditsFor)\(/.test(source)
const usesRunLoader = (source: string) => /\brunCreditsFor\(/.test(stripComments(source))

/**
 * Callers of `creditStatusMapFor` — a job's OWN usage log, without its steps or
 * side holds — each with why that is the figure it needs. A public charge never
 * comes from here: it comes from `runCreditsFor`.
 */
const OWN_USAGE_LOG_READERS: Record<string, string> = {
  "lib/job-credit-status.ts": "the run loader itself",
  "routes/jobs.ts": "credit_status only (POST /v1/jobs/status and GET /v1/jobs/:id/status): the job's own hold's lifecycle, never a charge",
  "ee/routes/admin-credit-audit.ts": "admin per-task pricing audit of each job's OWN charge against its OWN provider cost",
}

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

  it("creditsChargedOf (the public charge) is read only off the run loader (steps and side holds included)", () => {
    const callers = files.filter((x) => /\bcreditsChargedOf\(/.test(stripComments(x.source)) && x.rel !== "lib/job-credit-status.ts")
    expect(callers.length).toBeGreaterThan(0)
    for (const f of callers) {
      expect(usesRunLoader(f.source), `${f.rel} calls creditsChargedOf without runCreditsFor`).toBe(true)
    }
  })

  it("every public credits_charged / creditsCharged a job route sets comes from the run loader", () => {
    // A key spelled in an object literal from a call (`credits_charged: x(...)`)
    // or spread from publicCreditFieldsOf: either way the file must load runs.
    const setters = files.filter((x) => /\b(credits_charged|creditsCharged)\s*:\s*creditsChargedOf\(|\.\.\.publicCreditFieldsOf\(/.test(stripComments(x.source)))
    expect(setters.length).toBeGreaterThan(0)
    for (const f of setters) expect(usesRunLoader(f.source), `${f.rel} sets a public charge without runCreditsFor`).toBe(true)
  })

  it("a workflow node's charge adds its job's steps (child jobs) through the run loader", () => {
    for (const rel of RUN_STEP_TOTAL_READERS) {
      const file = files.find((f) => f.rel === rel)
      expect(file, rel).toBeDefined()
      expect(usesRunLoader(file!.source), `${rel} must read node charges through runCreditsFor`).toBe(true)
      // No bare side-hold read left beside it: the loader adds them.
      expect(/\bsideHoldChargesFor\(/.test(stripComments(file!.source)), `${rel} reads side holds outside runCreditsFor`).toBe(false)
    }
  })

  it("every reader of a job's own usage log (creditStatusMapFor) is classified", () => {
    const readers = files.filter((x) => /\bcreditStatusMapFor\(/.test(stripComments(x.source))).map((x) => x.rel).sort()
    expect(
      readers,
      "A new reader of a job's own usage log: if it shows what a job or run was charged, use runCreditsFor + creditsChargedOf (steps and side holds included); otherwise list it in OWN_USAGE_LOG_READERS with why.",
    ).toEqual(Object.keys(OWN_USAGE_LOG_READERS).sort())
  })
})
