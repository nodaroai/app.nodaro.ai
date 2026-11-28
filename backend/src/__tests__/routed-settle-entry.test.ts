// @test-watches backend/src/**/*.ts
/**
 * A routed video job's hold is charged by ONE function
 * (ee/billing/video-route-settlement.ts `settleRoutedJob`; a plugin's routed run
 * by `settleRoutedRunJob` beside it), which reads every figure from the job's
 * own decision and route ledger. This guard keeps it that way:
 *
 *  1. Every file that calls the raw charge primitive (`.commitCredits(`) is
 *     listed with its exact count and why it cannot charge a routed job's hold
 *     outside the entry — a new call anywhere, even inside a listed file, fails
 *     until it is decided (and, if it can reach a routed video job, routed
 *     through the entry first).
 *  2. The worker funnels that CAN reach a routed job's hold hand it to the
 *     entry before any commit of their own.
 *  3. The entry takes no caller figure: no cost, no add-on, no measured base.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "..")

const NOT_VIDEO = "settles LLM / text / audio / scrape holds only: never a routable video price id"

/** Every caller of the raw charge primitive, with its count and why it is not a routed bypass. */
const COMMIT_SITES: Record<string, { count: number; why: string }> = {
  "ee/billing/video-route-receipt.ts": { count: 1, why: "The common confirmed charge for routed jobs and composite runs" },
  "workers/shared.ts": { count: 8, why: "commitJobCredits and refundLoopTrimAddon hand a routed log to the entry first (asserted below); the rest are its default branches, the covered-step 0, the billed-refusal commit of LLM jobs, and the surround add-on (not a routed lane)" },
  "ee/routes/credits.ts": { count: 1, why: "the internal commit route refuses a log of a job carrying a routing decision (409 settled_by_route)" },
  "lib/credits-job-lifecycle.ts": { count: 2, why: "use-case fees, pipeline merges and background scrapes: never a routable video price id" },
  "ee/billing/commit-at-charged-price.ts": { count: 3, why: "Suno / transcription runs priced at another id: never a routable video price id" },
  "ee/billing/llm-cancel-settle.ts": { count: 1, why: NOT_VIDEO },
  "ee/billing/llm-side-hold-impl.ts": { count: 1, why: NOT_VIDEO },
  "ee/billing/llm-billing-impl.ts": { count: 4, why: NOT_VIDEO },
  "ee/billing/llm-fixed-plus-calls-impl.ts": { count: 1, why: NOT_VIDEO },
  "lib/sync-llm-meter.ts": { count: 1, why: NOT_VIDEO },
  "routes/pipelines.ts": { count: 1, why: NOT_VIDEO },
  "routes/qa-check.ts": { count: 1, why: NOT_VIDEO },
  "routes/llm-suggest-description.ts": { count: 1, why: NOT_VIDEO },
  "routes/llm-chat.ts": { count: 2, why: NOT_VIDEO },
  "routes/ai-writer.ts": { count: 3, why: NOT_VIDEO },
  "routes/prompt-helper.ts": { count: 2, why: NOT_VIDEO },
  "routes/suno.ts": { count: 1, why: NOT_VIDEO },
  "routes/scene-graph-ai.ts": { count: 1, why: NOT_VIDEO },
  "routes/social-publish.ts": { count: 1, why: NOT_VIDEO },
  "routes/after-effects-ai.ts": { count: 1, why: NOT_VIDEO },
  "routes/motion-graphics-ai.ts": { count: 1, why: NOT_VIDEO },
  "routes/image-to-text.ts": { count: 1, why: NOT_VIDEO },
  "routes/three-d-title-ai.ts": { count: 1, why: NOT_VIDEO },
  "routes/lottie-overlay-ai.ts": { count: 1, why: NOT_VIDEO },
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue
      sourceFiles(p, out)
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) {
      out.push(p)
    }
  }
  return out
}

/** The body of `export async function name(` up to the next top-level function. */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0)
  const next = src.indexOf("\nexport ", start + 10)
  return src.slice(start, next < 0 ? undefined : next)
}

describe("a routed job's hold is charged only by the one routed entry", () => {
  it("every raw commit site is listed with its exact count and why (held both ways)", () => {
    const found: Record<string, number> = {}
    for (const file of sourceFiles(SRC)) {
      const n = (readFileSync(file, "utf8").match(/\.commitCredits\(/g) ?? []).length
      if (n > 0) found[relative(SRC, file)] = n
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(COMMIT_SITES).map(([f, v]) => [f, v.count])))
  })

  it("the worker funnels that can reach a routed hold hand it to the entry before any commit of their own", () => {
    const shared = readFileSync(join(SRC, "workers/shared.ts"), "utf8")
    for (const fn of ["commitJobCredits", "refundLoopTrimAddon"]) {
      const body = bodyOf(shared, fn)
      const entry = body.indexOf("settleRoutedJob(")
      const commit = body.indexOf(".commitCredits(")
      expect(entry, `${fn} must call settleRoutedJob`).toBeGreaterThan(0)
      expect(entry, `${fn} must call settleRoutedJob before committing`).toBeLessThan(commit < 0 ? Number.POSITIVE_INFINITY : commit)
    }
  })

  it("the entry takes no caller figure (no cost, add-on or measured base)", () => {
    const src = readFileSync(join(SRC, "ee/billing/video-route-settlement.ts"), "utf8")
    const signature = src.slice(src.indexOf("export async function settleRoutedJob("), src.indexOf("): Promise<boolean>", src.indexOf("export async function settleRoutedJob(")))
    expect(signature).not.toMatch(/providerCost|extraNonProvider|meteredBase|credits/i)
  })
})
