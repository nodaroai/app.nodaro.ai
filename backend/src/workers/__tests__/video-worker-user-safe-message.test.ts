// A private plugin's handler can fail a job with its own fixed, user-safe
// sentence AND a content-policy class: `contentPolicyClass: "safety"` sets the
// safety `error_hint`, and `userSafeMessage: true` (an own property on the
// thrown error itself) tells the worker to keep the sentence instead of
// replacing it with the generic safety message — whose "adjust the prompt"
// advice is wrong for a run whose prompt the user never wrote. Only a
// plugin-served job type honours the marker; a built-in handler keeps today's
// behaviour.
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


const PLUGIN_SENTENCE = "This clip could not be recast because the provider's safety filter flagged it. Try a different clip."
const GENERIC_SAFETY = "The provider's safety filter blocked this output. Try adjusting the prompt or the input image."

function pluginSafetyError(extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(PLUGIN_SENTENCE), { contentPolicyClass: "safety", ...extra })
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

describe("video worker — a plugin's user-safe failure message", () => {
  let processor: (job: unknown, token?: string) => Promise<void>

  beforeEach(() => {
    createVideoWorker()
    processor = mocks.getCapturedProcessor()!
    expect(processor).toBeDefined()
  })

  it("a plugin job failing with the marker and a safety class keeps its message and gets the safety hint", async () => {
    const err = pluginSafetyError({ userSafeMessage: true })
    mocks.mockPluginHandler.mockRejectedValueOnce(err)

    const rejection = await processor(makeBullJob("cast-swap", { trendRun: true })).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    expect(rejection.message).toBe(PLUGIN_SENTENCE)
    expect(failedUpdate()).toEqual(expect.objectContaining({
      status: "failed",
      error_message: PLUGIN_SENTENCE,
      error_hint: { kind: "safety-block", class: "safety", retried: false },
    }))
    expect(mocks.mockPluginHandler).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", err, { chargeBilledRefusal: false })
  })

  it("the kept message is capped like every other failure message", async () => {
    const long = `${PLUGIN_SENTENCE} ${"x".repeat(600)}`
    mocks.mockPluginHandler.mockRejectedValueOnce(Object.assign(new Error(long), { contentPolicyClass: "safety", userSafeMessage: true }))

    await processor(makeBullJob("cast-swap")).catch(() => {})

    expect(failedUpdate()?.error_message).toBe(long.slice(0, 500))
  })

  it("without the marker a plugin's safety failure gets today's generic message", async () => {
    mocks.mockPluginHandler.mockRejectedValueOnce(pluginSafetyError())

    await processor(makeBullJob("cast-swap")).catch(() => {})

    expect(failedUpdate()).toEqual(expect.objectContaining({
      error_message: GENERIC_SAFETY,
      error_hint: { kind: "safety-block", class: "safety", retried: false },
    }))
  })

  it.each([
    ["a truthy non-boolean marker", { userSafeMessage: "yes" }],
    ["a false marker", { userSafeMessage: false }],
  ])("%s does not count: generic message", async (_label, extra) => {
    mocks.mockPluginHandler.mockRejectedValueOnce(pluginSafetyError(extra))

    await processor(makeBullJob("cast-swap")).catch(() => {})

    expect(failedUpdate()?.error_message).toBe(GENERIC_SAFETY)
  })

  it("a marker only on the cause does not vouch for the wrapper's text: generic message", async () => {
    const wrapper = Object.assign(
      new Error("cast-swap failed: https://cdn.example/source.mp4", { cause: Object.assign(new Error(PLUGIN_SENTENCE), { userSafeMessage: true }) }),
      { contentPolicyClass: "safety" },
    )
    mocks.mockPluginHandler.mockRejectedValueOnce(wrapper)

    await processor(makeBullJob("cast-swap")).catch(() => {})

    expect(failedUpdate()?.error_message).toBe(GENERIC_SAFETY)
  })

  it("a built-in handler's safety block ignores the marker: generic message, hint unchanged", async () => {
    // nano-banana-pro has no stochastic safety flag → one attempt, no inline retry.
    const err = Object.assign(
      new KieError("Blocked by the provider.", "detail", "generate-image", true, true, "safety"),
      { userSafeMessage: true },
    )
    mocks.mockHandler.mockRejectedValueOnce(err)

    const rejection = await processor(makeBullJob("generate-image", { provider: "nano-banana-pro" })).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    expect(failedUpdate()).toEqual(expect.objectContaining({
      error_message: GENERIC_SAFETY,
      error_hint: { kind: "safety-block", class: "safety", retried: false },
    }))
    expect(mocks.mockHandler).toHaveBeenCalledTimes(1)
  })

  it("a marked safety block on a refused input video keeps its message and the hint names the input video", async () => {
    const err = pluginSafetyError({ userSafeMessage: true, inputVideoRefused: true })
    mocks.mockPluginHandler.mockRejectedValueOnce(err)

    const rejection = await processor(makeBullJob("cast-swap", { videoUrl: "https://cdn.example/source.mp4" })).catch((e) => e)

    expect(rejection).toBeInstanceOf(UnrecoverableError)
    expect(failedUpdate()).toEqual(expect.objectContaining({
      error_message: PLUGIN_SENTENCE,
      error_hint: { kind: "safety-block", class: "safety", retried: false, subject: "input_video" },
    }))
  })

  it("a plugin's marked message with a copyright class is kept, as it already was", async () => {
    mocks.mockPluginHandler.mockRejectedValueOnce(
      Object.assign(new Error(PLUGIN_SENTENCE), { contentPolicyClass: "copyright", userSafeMessage: true }),
    )

    await processor(makeBullJob("cast-swap")).catch(() => {})

    expect(failedUpdate()).toEqual(expect.objectContaining({
      error_message: PLUGIN_SENTENCE,
      error_hint: { kind: "safety-block", class: "copyright", retried: false },
    }))
  })
})
