// A handler whose own credit reservation is refused partway (a plugin's child
// job answered 402) throws with a duck-typed `failureHint: { kind: "credits",
// code }`. On the final attempt the worker writes it to `jobs.error_hint` —
// read off the error or its `cause` chain, malformed ones ignored — and the
// refund is exactly what any plain failure gets.
//
// Scaffold copied from video-worker-safety-block.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock().
// Mirrors the scaffold in video-worker.test.ts; the one addition is that the
// mocked KieError here carries `contentPolicyClass` (that suite never needed
// it) and the mocked `bullmq` module exports a real `UnrecoverableError`
// class (the worker's safety-block branch throws it).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockHasCreditsRef = { value: true }
  const mockRefundJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockCreateAssetFromJob = vi.fn().mockResolvedValue(undefined)
  // Default: treat every attempt as final. The safety-block path never
  // consults this (it derives finality from the policy's own maxAttempts),
  // but the non-policy-error test overrides it to exercise the retry path.
  const mockIsFinalJobAttempt = vi.fn().mockReturnValue(true)
  const mockIsPromptBlocked = vi.fn().mockReturnValue(false)
  const mockInitProviders = vi.fn()
  const mockTryInlineReconcile = vi.fn().mockResolvedValue(undefined)

  const mockHandler = vi.fn().mockResolvedValue(undefined)
  // A private plugin's handler, served under its own key ("cast-swap") from
  // the loadPrivatePlugins mock below — the path a real Cast Swap run takes.
  const mockPluginHandler = vi.fn().mockResolvedValue(undefined)

  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockCasSelect = vi.fn().mockResolvedValue({ data: [{ id: "job-1" }], error: null })
  const mockIn = vi.fn().mockReturnValue({ select: mockCasSelect })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle, in: mockIn })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    update: mockUpdate,
  })

  let capturedProcessor: ((job: unknown, token?: string) => Promise<void>) | null = null

  return {
    mockHasCreditsRef,
    mockRefundJobCredits,
    mockCreateAssetFromJob,
    mockIsFinalJobAttempt,
    mockIsPromptBlocked,
    mockInitProviders,
    mockTryInlineReconcile,
    mockHandler,
    mockPluginHandler,
    mockFrom,
    mockSingle,
    mockEq,
    mockIn,
    mockCasSelect,
    mockSelect,
    mockUpdate,
    getCapturedProcessor: () => capturedProcessor,
    setCapturedProcessor: (p: ((job: unknown, token?: string) => Promise<void>) | null) => { capturedProcessor = p },
  }
})

// BullMQ mock — must be a class (called with `new`). UnrecoverableError must
// be a REAL class so `instanceof` assertions below work.
vi.mock("bullmq", () => {
  class MockWorker {
    on = vi.fn()
    close = vi.fn()
    constructor(_queue: string, processor: (job: unknown, token?: string) => Promise<void>) {
      mocks.setCapturedProcessor(processor)
    }
  }
  class DelayedError extends Error {
    constructor(message = "Delayed") { super(message); this.name = "DelayedError" }
  }
  class UnrecoverableError extends Error {
    constructor(message?: string) { super(message); this.name = "UnrecoverableError" }
  }
  return { Worker: MockWorker, DelayedError, UnrecoverableError }
})

vi.mock("ioredis", () => {
  class FakeRedis {}
  return { default: FakeRedis }
})

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", EDITION: "cloud" },
  hasCredits: () => mocks.mockHasCreditsRef.value,
  isCloud: () => mocks.mockHasCreditsRef.value,
  isCommunity: () => false,
  isBusiness: () => false,
}))

// Quiet stop (lib/access-blocks.ts): nobody is stopped here; the module reads config at check time.
vi.mock("@/lib/access-blocks.js", () => ({
  isUserQuietStopped: async () => false,
  QUIET_STOP_RECHECK_MS: 600_000,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/providers/index.js", () => ({
  initProviders: mocks.mockInitProviders,
  watchProviderCredentials: vi.fn(),
}))

vi.mock("@/config/content-filter.js", () => ({
  isPromptBlocked: mocks.mockIsPromptBlocked,
}))

vi.mock("../shared.js", () => ({
  refundJobCredits: mocks.mockRefundJobCredits,
  settleCancelledMeteredJob: vi.fn(async () => false),
  settleDiscardedCancelledMeteredHold: vi.fn(async () => {}),
  createAssetFromJob: mocks.mockCreateAssetFromJob,
  isFinalJobAttempt: mocks.mockIsFinalJobAttempt,
  LLM_PRODUCT_JOB_TYPES: new Set(["llm-structured", "generate-3d-scene", "edit-3d-scene"]),
}))

vi.mock("../inline-reconcile.js", () => ({
  tryInlineReconcile: mocks.mockTryInlineReconcile,
}))

vi.mock("../handlers/image-ai.js", () => ({
  imageAIHandlers: { "generate-image": mocks.mockHandler },
}))
vi.mock("../handlers/video-ai.js", () => ({
  videoAIHandlers: {
    "image-to-video": mocks.mockHandler,
    "text-to-video": mocks.mockHandler,
  },
}))
vi.mock("../handlers/ffmpeg.js", () => ({
  ffmpegHandlers: { "combine-videos": mocks.mockHandler },
}))
vi.mock("../handlers/audio-ai.js", () => ({
  audioAIHandlers: {},
}))
vi.mock("../handlers/suno.js", () => ({
  sunoHandlers: {},
}))
vi.mock("../handlers/entity.js", () => ({
  entityHandlers: {},
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  loadPrivatePlugins: vi.fn().mockResolvedValue({ handlers: { "cast-swap": mocks.mockPluginHandler }, loaded: [], engines: {} }),
}))

// Mock KieError — must be a real class for `instanceof` checks, and MUST
// carry `contentPolicyClass` (the real client.ts shape) so
// `lib/safety-block.ts`'s duck-typed classifier recognizes it. NOTE:
// safety-block.ts imports KieError type-only, so it never executes this
// module — this mock only matters for video-worker.ts's own
// `err instanceof KieError` logging check.
vi.mock("@/providers/kie/client.js", () => {
  class KieError extends Error {
    public readonly internalDetails: string
    public readonly context: string
    public readonly contentPolicyClass: "copyright" | "likeness" | "safety" | null
    constructor(
      sanitizedMessage: string,
      internalDetails: string,
      context: string,
      _isUpstreamFailure = false,
      _contentPolicy = false,
      contentPolicyClass: "copyright" | "likeness" | "safety" | null = null,
    ) {
      super(sanitizedMessage)
      this.name = "KieError"
      this.internalDetails = internalDetails
      this.context = context
      this.contentPolicyClass = contentPolicyClass
    }
  }
  return { KieError }
})

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { createVideoWorker } from "../video-worker.js"
import { KieError } from "../../providers/kie/client.js"
import { UnrecoverableError } from "bullmq"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobRecord(overrides: Record<string, unknown> = {}) {
  return {
    usage_log_id: "usage-1",
    user_id: "user-1",
    should_watermark: false,
    profiles: { public_outputs: true },
    ...overrides,
  }
}

function makeBullJob(name: string, data: Record<string, unknown> = {}, attemptsMade = 0) {
  return {
    name,
    data: { jobId: "job-1", ...data },
    id: "bull-1",
    attemptsMade,
    updateProgress: vi.fn(),
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
  }
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function refused(failureHint: unknown): Error {
  return Object.assign(new Error("You don't have enough credits to finish this run. Top up and try again."), { failureHint })
}

function failedUpdate(): Record<string, unknown> | undefined {
  return mocks.mockUpdate.mock.calls.map((c) => c[0] as Record<string, unknown>).find((c) => c.status === "failed")
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockHasCreditsRef.value = true
  mocks.mockIsFinalJobAttempt.mockReturnValue(true)
  mocks.mockSingle.mockResolvedValue({ data: mockJobRecord(), error: null })
})

describe("video worker — credits failure hint", () => {
  let processor: (job: unknown, token?: string) => Promise<void>

  beforeEach(() => {
    createVideoWorker()
    processor = mocks.getCapturedProcessor()!
    expect(processor).toBeDefined()
  })

  it("writes the hint from the thrown error, keeps the handler's message and refunds once", async () => {
    const err = refused({ kind: "credits", code: "insufficient_credits" })
    mocks.mockHandler.mockRejectedValueOnce(err)

    const rejection = await processor(makeBullJob("text-to-video", { provider: "seedance-2" })).catch((e) => e)

    // A plain failure: rethrown as itself, not as UnrecoverableError.
    expect(rejection).toBe(err)
    expect(rejection).not.toBeInstanceOf(UnrecoverableError)
    expect(failedUpdate()).toEqual(expect.objectContaining({
      status: "failed",
      error_message: "You don't have enough credits to finish this run. Top up and try again.",
      error_hint: { kind: "credits", code: "insufficient_credits" },
    }))
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", err, { chargeBilledRefusal: false })
  })

  it("a plugin-supplied handler (cast-swap) that throws a credits hint gets it written, and is refunded once", async () => {
    const err = refused({ kind: "credits", code: "instance_cap_reached" })
    mocks.mockPluginHandler.mockRejectedValueOnce(err)

    const rejection = await processor(makeBullJob("cast-swap", { trendRun: true })).catch((e) => e)

    expect(mocks.mockPluginHandler).toHaveBeenCalledTimes(1)
    expect(mocks.mockHandler).not.toHaveBeenCalled()
    expect(rejection).toBe(err)
    expect(failedUpdate()).toEqual(expect.objectContaining({
      status: "failed",
      error_hint: { kind: "credits", code: "instance_cap_reached" },
    }))
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", err, { chargeBilledRefusal: false })
  })

  it("reads the hint off the cause chain", async () => {
    const err = new Error("cast-swap failed", { cause: refused({ kind: "credits", code: "free_video_limit" }) })
    mocks.mockHandler.mockRejectedValueOnce(err)

    await processor(makeBullJob("text-to-video", { provider: "seedance-2" })).catch(() => {})

    expect(failedUpdate()?.error_hint).toEqual({ kind: "credits", code: "free_video_limit" })
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
  })

  it("copies only kind and code into the column", async () => {
    mocks.mockHandler.mockRejectedValueOnce(refused({ kind: "credits", code: "budget_exceeded", balance: 3, url: "https://x" }))

    await processor(makeBullJob("text-to-video", { provider: "seedance-2" })).catch(() => {})

    expect(failedUpdate()?.error_hint).toEqual({ kind: "credits", code: "budget_exceeded" })
  })

  it.each([
    ["another kind", { kind: "quota", code: "insufficient_credits" }],
    ["a non-string code", { kind: "credits", code: 402 }],
    ["free text as the code", { kind: "credits", code: "Not enough credits: 3 left" }],
    ["a 65-character code", { kind: "credits", code: "a".repeat(65) }],
    ["no hint object", "credits"],
  ])("ignores a malformed hint (%s): no error_hint, refund unchanged", async (_label, failureHint) => {
    mocks.mockHandler.mockRejectedValueOnce(refused(failureHint))

    await processor(makeBullJob("text-to-video", { provider: "seedance-2" })).catch(() => {})

    const update = failedUpdate()
    expect(update).toBeDefined()
    expect(update).not.toHaveProperty("error_hint")
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
  })

  it("on a non-final attempt: nothing written, nothing refunded, the error rethrown for BullMQ's retry", async () => {
    mocks.mockIsFinalJobAttempt.mockReturnValue(false)
    const err = refused({ kind: "credits", code: "insufficient_credits" })
    mocks.mockHandler.mockRejectedValueOnce(err)

    await expect(processor(makeBullJob("text-to-video", { provider: "seedance-2" }))).rejects.toBe(err)

    expect(failedUpdate()).toBeUndefined()
    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
  })

  it("a content-policy block keeps its own hint even if a credits hint rides along", async () => {
    const block = new KieError("Blocked for copyright.", "detail", "generate-image", true, true, "copyright")
    Object.assign(block, { failureHint: { kind: "credits", code: "insufficient_credits" } })
    mocks.mockHandler.mockRejectedValueOnce(block)

    await processor(makeBullJob("generate-image", { provider: "gpt-image-2" })).catch(() => {})

    expect(failedUpdate()?.error_hint).toEqual({ kind: "safety-block", class: "copyright", retried: false })
  })
})
