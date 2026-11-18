// @test-watches backend/src/**/*.ts
// @test-units-by-name names no node type: it scans the billing sources for the settle that can exceed a hold
/**
 * TOTALITY for covered steps (lib/covered-step.ts): a step a podcast pack
 * paid for holds 0 credits, and the only settle that can charge more than a
 * hold is the metered one (`commit_credits_metered`, migration 551). So:
 *
 * - that RPC is called from exactly one function, `settleCommitMetered`, and
 *   that function reads the covered mark before it;
 * - the orchestrator reads a run's cover from its wrapper job at pickup and
 *   the worker lane reserves under it — a new reserve call in the step runner
 *   must pass the cover too.
 *
 * Every other settle commits through `commit_credits`, which never charges
 * above the hold (0 for a covered step).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "../../..")

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules" && entry.name !== "_generated") out.push(...sources(path))
    } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

describe("covered steps cannot be charged above their 0 hold", () => {
  it("commit_credits_metered is called from one function only, which reads the mark first", () => {
    const callers = sources(SRC)
      .filter((f) => /rpc\(\s*"commit_credits_metered"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f))
    // The schema probe calls it with a negative actual the function refuses before reading any row:
    // an existence check that settles nothing (lib/llm-metered-schema-probe.ts).
    expect(callers).toEqual(["ee/billing/credits.ts", "lib/llm-metered-schema-probe.ts"])
    expect(read("lib/llm-metered-schema-probe.ts")).toMatch(/p_actual_credits: -1/)
    const credits = read("ee/billing/credits.ts")
    const start = credits.indexOf("private static async settleCommitMetered(")
    expect(start).toBeGreaterThan(-1)
    const body = credits.slice(start, credits.indexOf("\n  }\n", start))
    expect(body.indexOf("coveredMarkOf(")).toBeGreaterThan(-1)
    expect(body.indexOf("coveredMarkOf(")).toBeLessThan(body.indexOf('rpc("commit_credits_metered"'))
    expect(credits.match(/rpc\(\s*"commit_credits_metered"/g)).toHaveLength(1)
  })

  it("the step runner's every reservation passes the run's cover", () => {
    const executor = read("services/workflow-engine/node-executor.ts")
    const reserves = executor.split("CreditsService.reserveCredits(").length - 1
    const covered = executor.split("covered: ctx.coveredBy").length - 1
    expect(reserves).toBeGreaterThan(0)
    expect(covered).toBe(reserves)
  })

  it("the run reads its cover from its wrapper job at pickup", () => {
    expect(read("workers/orchestrator-worker.ts")).toMatch(/ctx\.coveredBy = cover\.packId/)
    expect(read("workers/orchestrator-worker.ts")).toMatch(/wrapperCoverOf\(job\.data\.wrapperJobId, userId\)/)
  })
})
