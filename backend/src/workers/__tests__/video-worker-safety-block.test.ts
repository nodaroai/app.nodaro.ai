import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
    "video-to-video": mocks.mockHandler,
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
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { PLATFORM_CAPACITY_MESSAGE } from "../../lib/llm-platform-exhaustion.js"

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
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", original, { chargeBilledRefusal: false })
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

// The provider refused the INPUT VIDEO itself. The hint says so (a caller can
// act on it by sending a different clip), beside the class when there is one;
// the user-facing message is exactly what it was. Flag on the error or its
// cause chain (the mocked KieError here does not carry it, so it is assigned).
describe("video worker — input-video refusal hint", () => {
  let processor: (job: unknown, token?: string) => Promise<void>

  beforeEach(() => {
    mocks.mockIsFinalJobAttempt.mockReturnValue(true) // the file default; some cases below override it
    createVideoWorker()
    processor = mocks.getCapturedProcessor()!
  })

  function failedUpdate(): Record<string, unknown> | undefined {
    return mocks.mockUpdate.mock.calls.map((c) => c[0] as Record<string, unknown>).find((c) => c.status === "failed")
  }

  const withRefVideo = { provider: "seedance-2", referenceVideoUrls: ["https://cdn.example/src.mp4"] }
  const withSourceVideo = { provider: "seedance-2", videoUrl: "https://cdn.example/src.mp4" }

  function inputCopyright(): KieError {
    return Object.assign(
      new KieError("Declined: may resemble protected content.", "detail", "Generation", true, true, "copyright"),
      { inputVideoRefused: true },
    )
  }

  function fileProcessingFailed(): KieError {
    return Object.assign(
      new KieError("Generation failed. Please try again or contact support if the issue persists.", "task failed: [500] File processing failed", "Generation", true),
      { inputVideoRefused: true },
    )
  }

  it("a copyright refusal of the input video → safety-block hint with subject input_video, message unchanged", async () => {
    mocks.mockHandler.mockRejectedValueOnce(inputCopyright())

    await processor(makeBullJob("text-to-video", withRefVideo)).catch(() => {})

    expect(failedUpdate()).toEqual(expect.objectContaining({
      error_message: "Declined: may resemble protected content.",
      error_hint: { kind: "safety-block", class: "copyright", retried: false, subject: "input_video" },
    }))
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
  })

  it("a copyright refusal of an input image → safety-block hint with subject input_image, final and refunded", async () => {
    const message = "The video model declined one of your pictures as possibly copyrighted. Try a different picture."
    mocks.mockHandler.mockRejectedValueOnce(
      Object.assign(
        new KieError(
          message,
          "task failed: [400] The request failed because the input image may be related to copyright restrictions.",
          "Generation", true, true, "copyright",
        ),
        { inputImageRefused: true },
      ),
    )

    await processor(makeBullJob("image-to-video", { provider: "seedance-2", imageUrl: "https://cdn.example/a.png" })).catch(() => {})

    expect(failedUpdate()).toEqual(expect.objectContaining({
      error_message: message,
      error_hint: { kind: "safety-block", class: "copyright", retried: false, subject: "input_image" },
    }))
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
  })

  it("an unclassified refusal of the input video → input-refused hint, message unchanged", async () => {
    mocks.mockHandler.mockRejectedValueOnce(fileProcessingFailed())

    await processor(makeBullJob("video-to-video", withSourceVideo)).catch(() => {})

    expect(failedUpdate()).toEqual(expect.objectContaining({
      error_message: "Generation failed. Please try again or contact support if the issue persists.",
      error_hint: { kind: "input-refused", subject: "input_video" },
    }))
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
  })

  it("reads the flag off the cause chain", async () => {
    const inner = Object.assign(new Error("File processing failed"), { inputVideoRefused: true })
    mocks.mockHandler.mockRejectedValueOnce(new Error("edit failed", { cause: inner }))

    await processor(makeBullJob("text-to-video", withRefVideo)).catch(() => {})

    expect(failedUpdate()?.error_hint).toEqual({ kind: "input-refused", subject: "input_video" })
  })

  it("is final on attempt 1 of 3: hint written, refunded once, UnrecoverableError — never left for the retry", async () => {
    mocks.mockIsFinalJobAttempt.mockReturnValue(false) // BullMQ alone would still retry
    mocks.mockHandler.mockRejectedValueOnce(fileProcessingFailed())

    const rejection = await processor(makeBullJob("video-to-video", withSourceVideo, 0)).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    expect(rejection.message).toBe("Generation failed. Please try again or contact support if the issue persists.")
    expect(failedUpdate()?.error_hint).toEqual({ kind: "input-refused", subject: "input_video" })
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
    expect(mocks.mockHandler).toHaveBeenCalledTimes(1)
    mocks.mockIsFinalJobAttempt.mockReturnValue(true) // restore the file default
  })

  it("without a video input, a copyright refusal keeps today's hint (no subject)", async () => {
    mocks.mockHandler.mockRejectedValueOnce(inputCopyright())

    await processor(makeBullJob("image-to-video", { provider: "seedance-2", imageUrl: "https://cdn.example/a.png" })).catch(() => {})

    expect(failedUpdate()?.error_hint).toEqual({ kind: "safety-block", class: "copyright", retried: false })
  })

  it("without a video input, \"File processing failed\" is today's plain failure: no hint, not final on attempt 1", async () => {
    mocks.mockIsFinalJobAttempt.mockReturnValue(false)
    const err = fileProcessingFailed()
    mocks.mockHandler.mockRejectedValueOnce(err)

    await expect(processor(makeBullJob("image-to-video", { provider: "seedance-2", imageUrl: "https://cdn.example/a.png" }, 0))).rejects.toBe(err)

    expect(failedUpdate()).toBeUndefined()
    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
    mocks.mockIsFinalJobAttempt.mockReturnValue(true) // restore the file default
  })

  it("without a video input, on the final attempt: failed with no hint", async () => {
    mocks.mockHandler.mockRejectedValueOnce(fileProcessingFailed())

    await processor(makeBullJob("image-to-video", { provider: "seedance-2", imageUrl: "https://cdn.example/a.png" })).catch(() => {})

    const update = failedUpdate()
    expect(update).toBeDefined()
    expect(update).not.toHaveProperty("error_hint")
  })

  it("a plain copyright refusal keeps today's hint (no subject)", async () => {
    mocks.mockHandler.mockRejectedValueOnce(safetyKieError("copyright", "Blocked for copyright."))

    await processor(makeBullJob("text-to-video", { provider: "seedance-2" })).catch(() => {})

    expect(failedUpdate()?.error_hint).toEqual({ kind: "safety-block", class: "copyright", retried: false })
  })
})

// A refusal that is a pure function of the job's own inputs (apply-edl's
// window check: a segment runs past the end of its media) fails the same way
// on every retry — after re-downloading and re-probing every source. The
// worker treats it like a content-policy block: final NOW (failed + refunded
// with the handler's own message), then UnrecoverableError so BullMQ spends
// no further attempt. Wrapped in another error's `cause`, it still counts.
describe("video worker — deterministic refusals (lib/deterministic-job-error.ts)", () => {
  let processor: (job: unknown, token?: string) => Promise<void>

  beforeEach(() => {
    createVideoWorker()
    processor = mocks.getCapturedProcessor()!
  })

  it("is final on attempt 1 of 3: failed + refunded once with its message, then UnrecoverableError — no retry", async () => {
    mocks.mockIsFinalJobAttempt.mockReturnValue(false) // BullMQ alone would still retry
    const refusal = new DeterministicJobError(
      `apply-edl: segment[0] "s0" ends at 9.00s on source "A", but its video track is only 6.00s long — shorten the segment or check the source's offsetMs`,
    )
    mocks.mockHandler.mockRejectedValueOnce(refusal)

    const rejection = await processor(makeBullJob("combine-videos", {}, 0)).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    expect(rejection.message).toBe(refusal.message)
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error_message: refusal.message }))
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", refusal, { chargeBilledRefusal: false })
    expect(mocks.mockHandler).toHaveBeenCalledTimes(1)
    mocks.mockIsFinalJobAttempt.mockReturnValue(true) // restore the file default
  })

  it("still counts when a wrapper carries it as `cause`", async () => {
    mocks.mockIsFinalJobAttempt.mockReturnValue(false)
    const wrapped = new Error("render failed", { cause: new DeterministicJobError("apply-edl: no video track") })
    mocks.mockHandler.mockRejectedValueOnce(wrapped)

    const rejection = await processor(makeBullJob("combine-videos", {}, 0)).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
    mocks.mockIsFinalJobAttempt.mockReturnValue(true) // restore the file default
  })
})

// The platform's own provider account ran out (createTask 402 "Credits
// insufficient"). Staging and production print the same failure line, so the
// line names the environment; the user-facing message is unchanged.
describe("video worker — provider-balance failure line names the environment", () => {
  let processor: (job: unknown, token?: string) => Promise<void>
  const saved = { runtime: process.env.RUNTIME_ENV, railway: process.env.RAILWAY_ENVIRONMENT_NAME }

  beforeEach(() => {
    mocks.mockIsFinalJobAttempt.mockReturnValue(true)
    createVideoWorker()
    processor = mocks.getCapturedProcessor()!
    delete process.env.RUNTIME_ENV
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
  })

  afterEach(() => {
    if (saved.runtime === undefined) delete process.env.RUNTIME_ENV
    else process.env.RUNTIME_ENV = saved.runtime
    if (saved.railway === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME
    else process.env.RAILWAY_ENVIRONMENT_NAME = saved.railway
  })

  async function failureLine(err: Error): Promise<string | undefined> {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    spy.mockClear()
    mocks.mockHandler.mockRejectedValueOnce(err)
    await processor(makeBullJob("text-to-video", { provider: "seedance-2" })).catch(() => {})
    return spy.mock.calls.map((c) => String(c[0])).find((l) => l.includes("failed (KIE.ai)"))
  }

  it("a 402 'Credits insufficient' failure carries the environment", async () => {
    const line = await failureLine(
      new KieError(
        PLATFORM_CAPACITY_MESSAGE,
        `createTask failed: 402 - {"code":402,"msg":"Credits insufficient","data":null}`,
        "Generation",
      ),
    )
    expect(line).toContain("| context: Generation | env: staging | user message: ")
    expect(failedUpdateMessage()).toBe(PLATFORM_CAPACITY_MESSAGE)
  })

  it("any other failure line is unchanged", async () => {
    const line = await failureLine(new KieError("Generation timed out. Please try again.", "task timed out", "Generation"))
    expect(line).not.toContain("env:")
  })

  function failedUpdateMessage(): unknown {
    return mocks.mockUpdate.mock.calls.map((c) => c[0] as Record<string, unknown>).find((c) => c.status === "failed")?.error_message
  }
})
