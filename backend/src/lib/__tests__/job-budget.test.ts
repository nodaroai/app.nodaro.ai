// Podcast Track 0.11 — budget-aware caps. The decided rule: a node that
// declares a budget (apply-edl today) gets node/poll timeouts = its budget,
// and the workflow cap grows by the same excess; everything that declares
// nothing keeps today's 90/120-minute limits EXACTLY. These cases pin the
// arithmetic of that rule and the byte-identical default; the wiring into each
// clock is pinned where the clock lives (node-executor, orchestrator, sweeps).
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import {
  BUDGETED_JOB_NAMES,
  STALE_EXECUTION_THRESHOLD_MS,
  addBudgetExcess,
  budgetExcessMs,
  declaredJobBudgetMs,
  nodeCeilings,
  staleExecutionThresholdMs,
  workflowCapMs,
} from "../job-budget.js"
import { applyEdlRenderBudgetMs } from "../../providers/video/apply-edl-budget.js"
import { audioSyncRenderBudgetMs } from "../../providers/audio/audio-sync-budget.js"
import { NODE_TIMEOUT_MS, POLL_ABSOLUTE_TIMEOUT_MS, WORKFLOW_TIMEOUT_MS } from "../../services/workflow-engine/types.js"

const MIN = 60_000

/** `n` one-minute hard cuts on source A — an n-minute edit. */
function cuts(n: number): Edl {
  const segments: EdlSegment[] = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, inMs: i * MIN, outMs: (i + 1) * MIN, video: "A",
  })) as EdlSegment[]
  return { version: 1, clock: "master", sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }], segments } as unknown as Edl
}

describe("declaredJobBudgetMs — the one per-job budget both readers call", () => {
  it("apply-edl: the render budget of the payload's own EDL, for its own output", () => {
    const edl = cuts(180)
    expect(declaredJobBudgetMs("apply-edl", { edl, output: "video" })).toBe(applyEdlRenderBudgetMs(edl, { output: "video" }))
    expect(declaredJobBudgetMs("apply-edl", { edl, output: "audio" })).toBe(applyEdlRenderBudgetMs(edl, { output: "audio" }))
    // The two outputs genuinely differ, so the output coercion is load-bearing.
    expect(applyEdlRenderBudgetMs(edl, { output: "audio" })).not.toBe(applyEdlRenderBudgetMs(edl, { output: "video" }))
  })

  it("apply-edl: a missing or unknown output is a VIDEO render (the executor's own default)", () => {
    const edl = cuts(60)
    const video = applyEdlRenderBudgetMs(edl, { output: "video" })
    expect(declaredJobBudgetMs("apply-edl", { edl })).toBe(video)
    expect(declaredJobBudgetMs("apply-edl", { edl, output: "mp3" })).toBe(video)
  })

  it("reads a jobs row's input_data the way it reads the payload (the payload spread + type/node_id)", () => {
    const edl = cuts(120)
    const payload = { jobId: "j", edl, output: "video", quality: "final", usageLogId: "u" }
    const inputData = { ...payload, type: "apply-edl", node_id: "n1" }
    expect(declaredJobBudgetMs("apply-edl", inputData)).toBe(declaredJobBudgetMs("apply-edl", payload))
  })

  it("declares nothing for a payload it cannot read, and for any job name not registered", () => {
    expect(declaredJobBudgetMs("apply-edl", {})).toBeUndefined()
    expect(declaredJobBudgetMs("apply-edl", null)).toBeUndefined()
    expect(declaredJobBudgetMs("apply-edl", "edl")).toBeUndefined()
    expect(declaredJobBudgetMs("apply-edl", { edl: { segments: [] } })).toBeUndefined()
    expect(declaredJobBudgetMs("combine-videos", { edl: cuts(10) })).toBeUndefined()
    // Prototype keys are not registrations.
    expect(declaredJobBudgetMs("constructor", { edl: cuts(10) })).toBeUndefined()
    expect(declaredJobBudgetMs("__proto__", { edl: cuts(10) })).toBeUndefined()
  })

  it("never throws: a payload that trips the budget function reads as no budget", () => {
    // Every ingress normalizes the EDL today, but a row reader (the
    // orchestrator's resume in cancelInFlightChildJobs) calls this with no
    // try/catch of its own — one odd row must not abort the resume.
    const ok = cuts(1).segments[0]
    const src = cuts(1).sources[0]
    expect(() => declaredJobBudgetMs("apply-edl", { edl: { sources: [null], segments: [null] } })).not.toThrow()
    expect(declaredJobBudgetMs("apply-edl", { edl: { sources: [null], segments: [null] } })).toBeUndefined()
    expect(declaredJobBudgetMs("apply-edl", { edl: { version: 1, clock: "master", sources: [src], segments: [ok, null] } })).toBeUndefined()
  })

  it("audio-sync: the budget of its source COUNT, off the payload or a jobs row's input_data alike", () => {
    const sources = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, url: `https://f.test/${i}.m4a` }))
    expect(declaredJobBudgetMs("audio-sync", { sources: sources(2) })).toBe(audioSyncRenderBudgetMs(2))
    expect(declaredJobBudgetMs("audio-sync", { sources: sources(6), reference: "n3" })).toBe(audioSyncRenderBudgetMs(6))
    const payload = { jobId: "j", sources: sources(4), usageLogId: "u" }
    expect(declaredJobBudgetMs("audio-sync", { ...payload, type: "audio-sync", node_id: "n" })).toBe(declaredJobBudgetMs("audio-sync", payload))
    // More sources can only lengthen it, and every size is past the default node ceiling.
    expect(audioSyncRenderBudgetMs(3)).toBeGreaterThan(audioSyncRenderBudgetMs(2))
    expect(audioSyncRenderBudgetMs(2)).toBeGreaterThan(NODE_TIMEOUT_MS)
  })

  it("audio-sync: declares nothing for a payload it cannot read (fewer than two sources, no array)", () => {
    expect(declaredJobBudgetMs("audio-sync", {})).toBeUndefined()
    expect(declaredJobBudgetMs("audio-sync", null)).toBeUndefined()
    expect(declaredJobBudgetMs("audio-sync", { sources: [{ id: "a", url: "https://f.test/a.wav" }] })).toBeUndefined()
    expect(declaredJobBudgetMs("audio-sync", { sources: "a,b" })).toBeUndefined()
  })

  it("registers exactly apply-edl and audio-sync today", () => {
    expect([...BUDGETED_JOB_NAMES]).toEqual(["apply-edl", "audio-sync"])
  })
})

describe("nodeCeilings — node/poll timeouts = the budget", () => {
  it("no budget: EXACTLY today's constants (byte-identical)", () => {
    expect(nodeCeilings()).toEqual({ processingMs: NODE_TIMEOUT_MS, pollAbsoluteMs: POLL_ABSOLUTE_TIMEOUT_MS, excessMs: 0 })
    expect(nodeCeilings(undefined)).toEqual(nodeCeilings())
    expect(NODE_TIMEOUT_MS).toBe(90 * MIN)
    expect(POLL_ABSOLUTE_TIMEOUT_MS).toBe(90 * MIN)
  })

  it("a budget at or under the default never SHRINKS a clock", () => {
    for (const b of [1, 20 * MIN, NODE_TIMEOUT_MS]) expect(nodeCeilings(b)).toEqual(nodeCeilings())
    for (const b of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(nodeCeilings(b)).toEqual(nodeCeilings())
  })

  it("a long budget: processing = the budget, poll = the default poll + the same excess", () => {
    const budget = 5 * 60 * MIN
    const c = nodeCeilings(budget)
    expect(c.excessMs).toBe(budget - NODE_TIMEOUT_MS)
    expect(c.processingMs).toBe(budget)
    expect(c.pollAbsoluteMs).toBe(POLL_ABSOLUTE_TIMEOUT_MS + budget - NODE_TIMEOUT_MS)
  })

  it("budgetExcessMs = max(0, budget − NODE_TIMEOUT_MS)", () => {
    expect(budgetExcessMs(undefined)).toBe(0)
    expect(budgetExcessMs(NODE_TIMEOUT_MS)).toBe(0)
    expect(budgetExcessMs(NODE_TIMEOUT_MS + 1)).toBe(1)
  })
})

describe("the workflow cap and the stale backstop grow by the summed excess", () => {
  it("nothing budgeted: 120 minutes and 4 hours, exactly", () => {
    expect(workflowCapMs(undefined)).toBe(WORKFLOW_TIMEOUT_MS)
    expect(workflowCapMs(0)).toBe(WORKFLOW_TIMEOUT_MS)
    expect(WORKFLOW_TIMEOUT_MS).toBe(120 * MIN)
    expect(staleExecutionThresholdMs(undefined)).toBe(STALE_EXECUTION_THRESHOLD_MS)
    expect(STALE_EXECUTION_THRESHOLD_MS).toBe(4 * 60 * MIN)
  })

  it("a run's excess is added on top of both", () => {
    expect(workflowCapMs(3 * 60 * MIN)).toBe(WORKFLOW_TIMEOUT_MS + 3 * 60 * MIN)
    expect(staleExecutionThresholdMs(3 * 60 * MIN)).toBe(STALE_EXECUTION_THRESHOLD_MS + 3 * 60 * MIN)
    expect(workflowCapMs(-1)).toBe(WORKFLOW_TIMEOUT_MS)
  })

  it("addBudgetExcess SUMS dispatches and leaves an unbudgeted context untouched", () => {
    const ctx: { budgetExcessMs?: number } = {}
    addBudgetExcess(ctx, 0)
    expect("budgetExcessMs" in ctx).toBe(false)
    addBudgetExcess(ctx, 30 * MIN)
    addBudgetExcess(ctx, 45 * MIN)
    expect(ctx.budgetExcessMs).toBe(75 * MIN)
    addBudgetExcess(ctx, Number.NaN)
    addBudgetExcess(ctx, -10)
    expect(ctx.budgetExcessMs).toBe(75 * MIN)
  })
})
