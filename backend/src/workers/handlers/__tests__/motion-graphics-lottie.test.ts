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
  const uploadBufferToR2 = vi.fn().mockResolvedValue("https://cdn.example.com/lottie/job-1.json")
  return { llmComplete, commitJobCredits, shouldSaveJobResult, markJobCompleted, setJobProgress, supabaseFrom, uploadBufferToR2 }
})

vi.mock("../../../lib/llm-client.js", () => ({ llmComplete: mocks.llmComplete }))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.commitJobCredits,
  shouldSaveJobResult: mocks.shouldSaveJobResult,
  markJobCompleted: mocks.markJobCompleted,
  setJobProgress: mocks.setJobProgress,
}))
vi.mock("../../../lib/storage.js", () => ({ uploadBufferToR2: mocks.uploadBufferToR2 }))
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

// A VALID Lottie graphic WITH a root slot manifest + a `{"sid"}` reference node
// (a slotted fill color). The validator hoists `slots` out of the document and
// leaves the `{"sid":"primaryColor"}` reference inside `lottie`; the handler must
// bake it (applySlots) before upload so the exported asset has NO unresolved
// refs and the fill color equals the slot default.
const SLOT_DEFAULT_COLOR = [1, 0, 0, 1]
const VALID_LOTTIE_WITH_SLOTS = JSON.stringify({
  v: "5.7.0",
  fr: 30,
  ip: 0,
  op: 150,
  w: 1920,
  h: 1080,
  slots: { primaryColor: { p: { a: 0, k: SLOT_DEFAULT_COLOR } } },
  layers: [
    {
      ty: 4,
      ip: 0,
      op: 150,
      ks: {},
      shapes: [
        {
          ty: "gr",
          it: [
            { ty: "rc", d: 1, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 }, s: { a: 0, k: [100, 100] } },
            { ty: "fl", c: { sid: "primaryColor" }, o: { a: 0, k: 100 } },
            { ty: "tr", p: { a: 0, k: [960, 540] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    },
  ],
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
  mocks.uploadBufferToR2.mockResolvedValue("https://cdn.example.com/lottie/job-1.json")
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

    // The authored Lottie JSON is persisted to R2 under the deterministic key
    // with the JSON content type, tracked against the job's user (Phase 4).
    expect(mocks.uploadBufferToR2).toHaveBeenCalledTimes(1)
    const [buffer, key, contentType, trackUserId] = mocks.uploadBufferToR2.mock.calls[0]
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(key).toBe("lottie/job-1.json")
    expect(contentType).toBe("application/json")
    expect(trackUserId).toBe("user-1")

    // Job completed with the assembled plan (planType from the real validator)
    // plus the R2 lottieUrl on output_data (the `lottie` source-handle output).
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    const [jobId, patch] = mocks.markJobCompleted.mock.calls[0]
    expect(jobId).toBe("job-1")
    expect(patch.output_data.motionPlan.planType).toBe("lottie-graphic")
    expect(patch.output_data.lottieUrl).toBe("https://cdn.example.com/lottie/job-1.json")
    expect(patch.provider_cost).toBe(0.01)

    // Credits committed with (usageLogId, jobId, providerCost).
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", 0.01)
  })

  it("bakes slots into the uploaded JSON: no unresolved sid refs, slotted props equal slot defaults", async () => {
    mocks.llmComplete.mockResolvedValue({
      text: VALID_LOTTIE_WITH_SLOTS,
      usage: { inputTokens: 100, outputTokens: 500 },
      providerCost: 0.01,
    })

    await handler(makeJob() as never, makeCtx())

    expect(mocks.uploadBufferToR2).toHaveBeenCalledTimes(1)
    const [buffer] = mocks.uploadBufferToR2.mock.calls[0]
    const serialized = (buffer as Buffer).toString("utf-8")

    // The baked, exported document carries NO unresolved slot references.
    expect(serialized).not.toContain('"sid"')

    // The slotted fill color resolved to the slot's default value.
    const baked = JSON.parse(serialized) as {
      layers: Array<{ shapes: Array<{ it: Array<Record<string, unknown>> }> }>
    }
    const fill = baked.layers[0].shapes[0].it.find((node) => node.ty === "fl") as
      | { c?: { a?: number; k?: number[] } }
      | undefined
    expect(fill?.c?.k).toEqual(SLOT_DEFAULT_COLOR)
    expect(fill?.c).not.toHaveProperty("sid")

    // The delivered plan still carries the (unbaked) lottie + extracted slots —
    // baking is for the exported R2 asset only, not the in-memory plan.
    const patch = mocks.markJobCompleted.mock.calls[0][1]
    expect(patch.output_data.motionPlan.slots.primaryColor).toBeDefined()
  })

  it("upload failure: job still completes WITHOUT lottieUrl (the plan is additive)", async () => {
    mocks.uploadBufferToR2.mockRejectedValueOnce(new Error("R2 unavailable"))

    await expect(handler(makeJob() as never, makeCtx())).resolves.toBeUndefined()

    // The plan is delivered + credits committed despite the upload failure.
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    const patch = mocks.markJobCompleted.mock.calls[0][1]
    expect(patch.output_data.motionPlan.planType).toBe("lottie-graphic")
    expect("lottieUrl" in patch.output_data).toBe(false)
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", 0.01)
  })

  it("cancellation skips the upload entirely (shouldSaveJobResult=false)", async () => {
    mocks.shouldSaveJobResult.mockResolvedValueOnce(false)

    await expect(handler(makeJob() as never, makeCtx())).resolves.toBeUndefined()

    expect(mocks.uploadBufferToR2).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
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
