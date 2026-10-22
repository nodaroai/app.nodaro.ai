// @test-watches backend/src/**/*.ts
/**
 * R38: a synchronous metered LLM job's terminal `completed` write never
 * overwrites a `cancelled` row.
 *
 * A cancel that ran while the route's call was in flight keeps the hold (R36:
 * billed-unknown) and leaves the row cancelled; the route's settle then
 * charges the call (the charge stands — D10), and its completion used to be
 * an unconditional `.eq("id")` write that turned the row back into
 * `completed`. `completeSettledSyncJob` is a CAS on the live statuses.
 *
 * The guard below holds every file that settles a metered LLM job to it: the
 * raw `status: "completed"` writes left in those files are their ROLLBACK
 * (tier) branches, pinned by count — a new one fails until it is reviewed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const h = vi.hoisted(() => ({
  row: { id: "job-1", user_id: "user-1", status: "pending" } as Record<string, unknown>,
  settle: vi.fn(async (..._a: unknown[]) => ({ outcome: "charged", charged: 12, shortfall: 0 }) as { outcome: string; charged?: number; shortfall?: number }),
}))

/** One jobs row behind eq / in filters; select / update / maybeSingle. */
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      const filters: Array<(r: Record<string, unknown>) => boolean> = []
      let patch: Record<string, unknown> | null = null
      const run = async () => {
        if (!patch) return { data: { ...h.row }, error: null }
        const hit = filters.every((f) => f(h.row))
        if (hit) Object.assign(h.row, patch)
        return { data: hit ? [{ id: h.row.id }] : [], error: null }
      }
      const b: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => { patch = p; return b },
        select: () => b,
        eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b },
        in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return b },
        maybeSingle: run,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      }
      return b
    },
  },
}))
vi.mock("../llm-billing.js", () => ({ settleLlmJob: h.settle }))
// A spend is only handed through (its once-per-job key): a bare object stands for it.
const spend = () => ({}) as unknown as LlmSpend
vi.mock("../job-failure.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../job-failure.js")>()),
  markJobFailed: vi.fn(async () => true),
}))

import { completeSettledSyncJob } from "../metered-sync-completion.js"
import { finishMeteredSyncLlmJob } from "../meter-sync-llm.js"
import type { LlmReserveResult, LlmSpend } from "../llm-billing.js"

beforeEach(() => {
  vi.clearAllMocks()
  h.row = { id: "job-1", user_id: "user-1", status: "pending" }
  h.settle.mockResolvedValue({ outcome: "charged", charged: 12, shortfall: 0 })
})

describe("completeSettledSyncJob", () => {
  it("completes a live row", async () => {
    expect(await completeSettledSyncJob("job-1")).toBe(true)
    expect(h.row.status).toBe("completed")
  })
  it("never overwrites a cancelled row", async () => {
    h.row.status = "cancelled"
    expect(await completeSettledSyncJob("job-1")).toBe(false)
    expect(h.row.status).toBe("cancelled")
  })
  it("never flips a row the sweep already failed", async () => {
    h.row.status = "failed"
    expect(await completeSettledSyncJob("job-1")).toBe(false)
    expect(h.row.status).toBe("failed")
  })
  it("is scoped to the owner when the route scopes its writes", async () => {
    expect(await completeSettledSyncJob("job-1", { userId: "someone-else" })).toBe(false)
    expect(h.row.status).toBe("pending")
    expect(await completeSettledSyncJob("job-1", { userId: "user-1" })).toBe(true)
  })
})

describe("finishMeteredSyncLlmJob on a row cancelled while the call ran", () => {
  const reserve = { metered: true, chargeId: "image-critic:claude-sonnet-5.5", holdCredits: 10, reservation: { usageLogId: "log-1" } } as unknown as LlmReserveResult
  it("the charge still commits (the settle runs), and the row stays cancelled", async () => {
    h.row.status = "cancelled"
    const finished = await finishMeteredSyncLlmJob("job-1", reserve, spend(), { status: "completed", outputData: { score: 1 } })
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect(finished.settled).toMatchObject({ outcome: "charged", charged: 12 })
    expect(h.row.status).toBe("cancelled")
  })
  it("a live row completes as before", async () => {
    await finishMeteredSyncLlmJob("job-1", reserve, spend(), { status: "completed", outputData: { score: 1 } })
    expect(h.row.status).toBe("completed")
  })
})

// ── The guard ────────────────────────────────────────────────────────────────

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === "node_modules" || name === "__tests__") continue
    if (statSync(p).isDirectory()) sourceFiles(p, out)
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

/**
 * Raw `.update({ … status: "completed" … })` writes allowed in a file that settles a
 * metered LLM job — each one the route's ROLLBACK (tier) branch, byte-identical
 * by design (D6). Every metered-path completion goes through
 * `completeSettledSyncJob` (or a CAS funnel: `markJobCompleted`).
 */
const ROLLBACK_COMPLETIONS: Record<string, number> = {
  "routes/after-effects-ai.ts": 1,
  "routes/ai-writer.ts": 3, // non-streaming + the two streaming finals
  "routes/describe-to-picker.ts": 1,
  "routes/image-critic.ts": 1,
  "routes/image-to-text.ts": 1,
  "routes/llm-chat.ts": 2, // non-streaming + streaming
  "routes/llm-structured.ts": 1,
  "routes/llm-suggest-description.ts": 1,
  "routes/lottie-overlay-ai.ts": 1,
  "routes/motion-graphics-ai.ts": 1,
  "routes/prompt-helper.ts": 1,
  "routes/qa-check.ts": 1,
  "routes/reduce.ts": 1,
  "routes/scene-graph-ai.ts": 1,
  "routes/text-to-picker.ts": 1,
  "routes/three-d-title-ai.ts": 1,
}

/**
 * `.update({ … status: "completed" … })` writes in `source` — the key at ANY
 * position of the object literal (m6), the literal read to its matching brace.
 */
export function completedUpdateCount(source: string): number {
  let count = 0
  const re = /\.update\(\s*\{/g
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0
    let end = m.index + m[0].length - 1
    for (let i = end; i < source.length; i++) {
      if (source[i] === "{") depth++
      else if (source[i] === "}" && --depth === 0) {
        end = i
        break
      }
    }
    if (/\bstatus:\s*"completed"/.test(source.slice(m.index, end + 1))) count++
  }
  return count
}

describe("completedUpdateCount (the guard's scanner)", () => {
  it("finds the status key first, last or in the middle, across lines — and nothing else", () => {
    expect(completedUpdateCount(`x.update({ status: "completed", a: 1 })`)).toBe(1)
    expect(completedUpdateCount(`x.update({ a: 1, ...completedJobColumns(), status: "completed" })`)).toBe(1)
    expect(completedUpdateCount(`x.update({\n  output_data: { a: { b: 1 } },\n  status: "completed",\n})`)).toBe(1)
    expect(completedUpdateCount(`x.update({ status: "failed" }); y.update({ output_data: {} })`)).toBe(0)
  })
})

describe("guard: a metered settle's completion never overwrites a cancelled row", () => {
  it("every file that settles a metered LLM job keeps only its pinned rollback completions raw", () => {
    const found: Record<string, number> = {}
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8")
      if (!/\b(?:settleLlmJob|finishMeteredSyncLlmJob)\(/.test(source)) continue
      const raw = completedUpdateCount(source)
      if (raw > 0) found[relative(SRC, file).split("\\").join("/")] = raw
    }
    expect(
      found,
      "A metered LLM settle's terminal `completed` write must be `completeSettledSyncJob` (lib/metered-sync-completion.ts) — a CAS on the live statuses — never an unconditional `.eq(\"id\")` update: a cancel during the call keeps the hold and leaves the row `cancelled` (R38). A raw write on a ROLLBACK (tier) branch is pinned in ROLLBACK_COMPLETIONS with its count.",
    ).toEqual(ROLLBACK_COMPLETIONS)
  })
})
