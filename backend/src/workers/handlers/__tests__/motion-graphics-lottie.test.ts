import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock setup — mirrors handlers/__tests__/entity.test.ts:
//   * hoisted mock fns for the worker-shared lifecycle helpers + llmComplete
//   * vi.mock of ../../shared.js (relative, as entity.test.ts does) and
//     ../../../lib/llm-client.js
//   * the REAL validator + REAL extractJsonFromAIResponse run — the mocked
//     llmComplete only supplies the response *text* (realistic Lottie JSON), so
//     validation/auto-fix/reject logic is exercised end-to-end.
//   * a supabase mock whose `from` we assert is NEVER called — the handler must
//     never touch the jobs row directly (no provider_kind write; the worker's
//     generic "pre-task" pickup is the stale-sweep contract).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const llmComplete = vi.fn()
  const commitJobCredits = vi.fn().mockResolvedValue(undefined)
  const shouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const markJobCompleted = vi.fn().mockResolvedValue(true)
  const setJobProgress = vi.fn().mockResolvedValue(undefined)
  const supabaseFrom = vi.fn()
  return { llmComplete, commitJobCredits, shouldSaveJobResult, markJobCompleted, setJobProgress, supabaseFrom }
})

vi.mock("../../../lib/llm-client.js", () => ({ llmComplete: mocks.llmComplete }))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.commitJobCredits,
  shouldSaveJobResult: mocks.shouldSaveJobResult,
  markJobCompleted: mocks.markJobCompleted,
  setJobProgress: mocks.setJobProgress,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.supabaseFrom } }))

import { motionGraphicsLottieHandlers } from "../motion-graphics-lottie.js"

const handler = motionGraphicsLottieHandlers["motion-graphics-lottie"]

// A minimal VALID Lottie graphic document (one shape layer, no image assets).
const VALID_LOTTIE = JSON.stringify({
  v: "5.7.0",
  fr: 30,
  ip: 0,
  op: 150,
  w: 1920,
  h: 1080,
  layers: [{ ty: 4, ip: 0, op: 150, ks: {}, shapes: [] }],
})

// A REJECTED Lottie document — same as VALID but with an image asset (rule #8).
const REJECTED_LOTTIE = JSON.stringify({
  v: "5.7.0",
  fr: 30,
  ip: 0,
  op: 150,
  w: 1920,
  h: 1080,
  layers: [{ ty: 4, ip: 0, op: 150, ks: {}, shapes: [] }],
  assets: [{ id: "img_0", p: "x.png" }],
})

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "motion-graphics-lottie",
    id: "bull-1",
    data: {
      jobId: "job-1",
      prompt: "confetti burst",
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 150,
      backgroundColor: "#00000000",
      ...data,
    },
    updateProgress: vi.fn(),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.shouldSaveJobResult.mockResolvedValue(true)
  mocks.markJobCompleted.mockResolvedValue(true)
  mocks.llmComplete.mockResolvedValue({ text: VALID_LOTTIE, usage: { inputTokens: 100, outputTokens: 500 }, providerCost: 0.01 })
})

describe("motion-graphics-lottie handler", () => {
  it("success: single llmComplete call, completes with a lottie-graphic plan + provider_cost", async () => {
    await handler(makeJob() as never, makeCtx())

    // Exactly one LLM call, with the Lottie params.
    expect(mocks.llmComplete).toHaveBeenCalledTimes(1)
    const call = mocks.llmComplete.mock.calls[0][0]
    expect(call.maxTokens).toBe(8192)
    expect(call.timeoutMs).toBe(240_000)
    expect(call.system).toContain("Lottie")

    // Job completed with the assembled plan (planType from the real validator).
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    const [jobId, patch] = mocks.markJobCompleted.mock.calls[0]
    expect(jobId).toBe("job-1")
    expect(patch.output_data.motionPlan.planType).toBe("lottie-graphic")
    expect(patch.provider_cost).toBe(0.01)

    // Credits committed with (usageLogId, jobId, providerCost).
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", 0.01)
  })

  it("invalid JSON then valid on retry: two llmComplete calls; second includes prior response + feedback; cost summed", async () => {
    mocks.llmComplete
      .mockResolvedValueOnce({ text: "this is not json at all", usage: { inputTokens: 50, outputTokens: 10 }, providerCost: 0.002 })
      .mockResolvedValueOnce({ text: VALID_LOTTIE, usage: { inputTokens: 120, outputTokens: 600 }, providerCost: 0.008 })

    await handler(makeJob() as never, makeCtx())

    expect(mocks.llmComplete).toHaveBeenCalledTimes(2)
    // Second call is the bounded retry: [user(original), assistant(first text), user(feedback)].
    const secondMessages = mocks.llmComplete.mock.calls[1][0].messages
    expect(secondMessages).toHaveLength(3)
    expect(secondMessages[0].role).toBe("user")
    expect(secondMessages[1].role).toBe("assistant")
    expect(secondMessages[1].content).toBe("this is not json at all")
    expect(secondMessages[2].role).toBe("user")
    expect(secondMessages[2].content).toMatch(/failed validation/i)

    // Job completes, provider_cost = sum of both calls.
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.markJobCompleted.mock.calls[0][1].provider_cost).toBeCloseTo(0.01, 10)
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", expect.closeTo(0.01, 10))
  })

  it("rejected twice (image assets both times): handler THROWS, markJobCompleted NOT called", async () => {
    mocks.llmComplete.mockResolvedValue({ text: REJECTED_LOTTIE, usage: { inputTokens: 80, outputTokens: 300 }, providerCost: 0.005 })

    await expect(handler(makeJob() as never, makeCtx())).rejects.toThrow(/validation failed/i)

    expect(mocks.llmComplete).toHaveBeenCalledTimes(2) // first + one bounded retry
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
  })

  it("cancellation: shouldSaveJobResult=false => markJobCompleted + commitJobCredits NOT called, no throw", async () => {
    mocks.shouldSaveJobResult.mockResolvedValueOnce(false)

    await expect(handler(makeJob() as never, makeCtx())).resolves.toBeUndefined()

    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
  })

  it("lost CAS: markJobCompleted=false => commitJobCredits NOT called", async () => {
    mocks.markJobCompleted.mockResolvedValueOnce(false)

    await handler(makeJob() as never, makeCtx())

    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
  })

  it("previousSids: first user message names the stable slot", async () => {
    await handler(makeJob({ previousSids: ["primaryColor"] }) as never, makeCtx())

    const firstUserMessage = mocks.llmComplete.mock.calls[0][0].messages[0].content as string
    expect(firstUserMessage).toContain("primaryColor")
  })

  it("never writes provider_kind: the handler does not touch the jobs row (supabase.from never called)", async () => {
    await handler(makeJob() as never, makeCtx())

    // The worker's generic pre-task pickup owns provider_kind/stale-sweep; the
    // handler must never issue its own jobs.update.
    expect(mocks.supabaseFrom).not.toHaveBeenCalled()
  })
})
