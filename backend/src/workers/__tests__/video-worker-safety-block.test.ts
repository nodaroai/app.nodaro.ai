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
  createAssetFromJob: mocks.mockCreateAssetFromJob,
  isFinalJobAttempt: mocks.mockIsFinalJobAttempt,
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
  loadPrivatePlugins: vi.fn().mockResolvedValue({ handlers: {}, loaded: [], engines: {} }),
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

function safetyKieError(contentPolicyClass: "copyright" | "likeness" | "safety", message: string): KieError {
  return new KieError(message, "internal detail", "generate-image", true, true, contentPolicyClass)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockHasCreditsRef.value = true
  mocks.mockSingle.mockResolvedValue({ data: mockJobRecord(), error: null })
})

describe("video worker — safety-block handling", () => {
  let processor: (job: unknown, token?: string) => Promise<void>

  beforeEach(() => {
    createVideoWorker()
    processor = mocks.getCapturedProcessor()!
    expect(processor).toBeDefined()
  })

  it("(a) safety block on gpt-image-2 → ONE inline re-run of the same request; when it succeeds the job completes normally (no failed row, no refund, nothing rethrown)", async () => {
    const original = safetyKieError("safety", "Content policy violation: blocked")
    mocks.mockHandler.mockRejectedValueOnce(original).mockResolvedValueOnce(undefined)

    const job = makeBullJob("generate-image", { provider: "gpt-image-2" }, 0)
    await expect(processor(job)).resolves.toBeUndefined()

    expect(mocks.mockHandler).toHaveBeenCalledTimes(2)
    expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
  })

  it("(b) safety block on gpt-image-2 twice (the inline re-run blocks too) → fallback sentence, error_hint retried + suggestedProvider, refund once, throws UnrecoverableError", async () => {
    const original = safetyKieError("safety", "Content policy violation: blocked")
    mocks.mockHandler.mockRejectedValueOnce(original).mockRejectedValueOnce(original)

    const job = makeBullJob("generate-image", { provider: "gpt-image-2" }, 0)
    const rejection = await processor(job).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    expect(rejection.message).toBe(
      "The provider's safety filter blocked this output. This filter is not always consistent, so the request was retried once. You can try the same prompt and references on Nano Banana Pro, or adjust the prompt.",
    )

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message:
          "The provider's safety filter blocked this output. This filter is not always consistent, so the request was retried once. You can try the same prompt and references on Nano Banana Pro, or adjust the prompt.",
        error_hint: {
          kind: "safety-block",
          class: "safety",
          retried: true,
          suggestedProvider: "nano-banana-pro",
        },
      }),
    )
    expect(mocks.mockHandler).toHaveBeenCalledTimes(2)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", original)
  })

  it("(c) copyright block, attemptsMade 0 (final immediately) → existing message kept, hint without suggestedProvider, throws UnrecoverableError", async () => {
    const original = safetyKieError(
      "copyright",
      "Blocked for copyright: the provider refused this generation.",
    )
    mocks.mockHandler.mockRejectedValueOnce(original)

    const job = makeBullJob("generate-image", { provider: "gpt-image-2" }, 0)
    const rejection = await processor(job).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    // Copyright is never retried, so it keeps KIE's own message verbatim —
    // NOT the safety-filter sentence.
    expect(rejection.message).toBe("Blocked for copyright: the provider refused this generation.")

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: "Blocked for copyright: the provider refused this generation.",
        error_hint: { kind: "safety-block", class: "copyright", retried: false },
      }),
    )
    const failedCall = mocks.mockUpdate.mock.calls.map((c) => c[0]).find((c) => c.status === "failed")
    expect(failedCall.error_hint).not.toHaveProperty("suggestedProvider")
    expect(mocks.mockHandler).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
  })

  it("(d) safety block on an unflagged model → final on attempt 1 (single-attempt policy)", async () => {
    const original = safetyKieError("safety", "Content policy violation: blocked")
    mocks.mockHandler.mockRejectedValueOnce(original)

    // nano-banana-pro carries no `safetyFilter` flag in the catalog → maxAttempts 1.
    const job = makeBullJob("generate-image", { provider: "nano-banana-pro" }, 0)
    const rejection = await processor(job).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: expect.not.stringContaining("retried once"),
        error_hint: { kind: "safety-block", class: "safety", retried: false },
      }),
    )
    expect(mocks.mockHandler).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
  })

  it("(e) a non-policy error keeps today's behaviour — not final on attempt 1 of 3, no UnrecoverableError", async () => {
    mocks.mockIsFinalJobAttempt.mockReturnValueOnce(false)
    const original = new Error("transient KIE 503")
    mocks.mockHandler.mockRejectedValueOnce(original)

    const job = makeBullJob("generate-image", { provider: "gpt-image-2" }, 0)
    await expect(processor(job)).rejects.toBe(original)

    expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
  })
})
