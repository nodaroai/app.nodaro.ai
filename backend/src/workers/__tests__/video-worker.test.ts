import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockHasCreditsRef = { value: true }
  const mockRefundJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockCreateAssetFromJob = vi.fn().mockResolvedValue(undefined)
  const mockIsPromptBlocked = vi.fn().mockReturnValue(false)
  const mockInitProviders = vi.fn()
  const mockTryInlineReconcile = vi.fn().mockResolvedValue(undefined)

  // Handler mock — a single spy we can configure per test
  const mockHandler = vi.fn().mockResolvedValue(undefined)

  // Supabase mock
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    update: mockUpdate,
  })

  // Captured processor callback from Worker constructor
  let capturedProcessor: ((job: unknown) => Promise<void>) | null = null

  return {
    mockHasCreditsRef,
    mockRefundJobCredits,
    mockCreateAssetFromJob,
    mockIsPromptBlocked,
    mockInitProviders,
    mockTryInlineReconcile,
    mockHandler,
    mockFrom,
    mockSingle,
    mockEq,
    mockSelect,
    mockUpdate,
    getCapturedProcessor: () => capturedProcessor,
    setCapturedProcessor: (p: ((job: unknown) => Promise<void>) | null) => { capturedProcessor = p },
  }
})

// BullMQ Worker mock — must be a class (called with `new`)
vi.mock("bullmq", () => {
  class MockWorker {
    on = vi.fn()
    close = vi.fn()
    constructor(_queue: string, processor: (job: unknown) => Promise<void>) {
      mocks.setCapturedProcessor(processor)
    }
  }
  return { Worker: MockWorker }
})

// IORedis mock — must be a class (called with `new`)
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
}))

vi.mock("@/config/content-filter.js", () => ({
  isPromptBlocked: mocks.mockIsPromptBlocked,
}))

vi.mock("../shared.js", () => ({
  refundJobCredits: mocks.mockRefundJobCredits,
  createAssetFromJob: mocks.mockCreateAssetFromJob,
}))

vi.mock("../inline-reconcile.js", () => ({
  tryInlineReconcile: mocks.mockTryInlineReconcile,
}))

// Mock all handler modules to return our controllable mockHandler
vi.mock("../handlers/image-ai.js", () => ({
  imageAIHandlers: { "generate-image": mocks.mockHandler },
}))
vi.mock("../handlers/video-ai.js", () => ({
  // Two distinct job names live behind the unified generate-video node:
  // its payload-builder dispatches `jobName` to either "image-to-video" or
  // "text-to-video" based on whether a start frame is wired. The worker map
  // therefore must route both names to the same handler family — we wire
  // both keys to the controllable spy so a single test can drive either path.
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

// Mock KieError — must be a real class for instanceof checks
vi.mock("@/providers/kie/client.js", () => {
  class KieError extends Error {
    public readonly internalDetails: string
    public readonly context: string
    constructor(sanitizedMessage: string, internalDetails: string, context: string) {
      super(sanitizedMessage)
      this.name = "KieError"
      this.internalDetails = internalDetails
      this.context = context
    }
  }
  return { KieError }
})

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { createVideoWorker } from "../video-worker.js"
import { KieError } from "../../providers/kie/client.js"

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

function makeBullJob(name: string, data: Record<string, unknown> = {}) {
  return {
    name,
    data: { jobId: "job-1", ...data },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockHasCreditsRef.value = true
  mocks.mockSingle.mockResolvedValue({ data: mockJobRecord(), error: null })
})

describe("createVideoWorker", () => {
  it("initializes providers and captures the processor", () => {
    createVideoWorker()
    expect(mocks.mockInitProviders).toHaveBeenCalled()
    expect(mocks.getCapturedProcessor()).toBeDefined()
  })
})

describe("video worker processor", () => {
  let processor: (job: unknown) => Promise<void>

  beforeEach(() => {
    createVideoWorker()
    processor = mocks.getCapturedProcessor()!
    expect(processor).toBeDefined()
  })

  it("routes to correct handler for known job type", async () => {
    const job = makeBullJob("generate-image")
    await processor(job)
    expect(mocks.mockHandler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: "job-1" }))
  })

  // Phase 4: BullMQ stall-retry guard + inline recovery (Layer 1).
  it("stall-retry: skips handler AND dispatches to tryInlineReconcile when provider_task_id is set", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({
        provider_task_id: "t-existing",
        provider_kind: "kie-suno",
        reconcile_attempts: 0,
        job_type: "suno-generate",
      }),
      error: null,
    })

    const job = makeBullJob("suno-generate")
    await processor(job)

    expect(mocks.mockHandler).not.toHaveBeenCalled()
    // Status update to "processing" is also skipped — we don't touch the row.
    expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    )
    // The Layer-1 win: inline reconcile fires immediately instead of waiting
    // for the cron at the kie-suno 30-min threshold.
    expect(mocks.mockTryInlineReconcile).toHaveBeenCalledWith({
      id: "job-1",
      provider_kind: "kie-suno",
      provider_task_id: "t-existing",
      reconcile_attempts: 0,
      job_type: "suno-generate",
    })
  })

  it("stall-retry: passes null provider_kind through (cron will sweep)", async () => {
    // Legacy row from before Phase 1 — provider_task_id set but kind missing.
    // tryInlineReconcile handles this case by logging + returning; the cron's
    // catch-all then sweeps the row.
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({
        provider_task_id: "t-legacy",
        provider_kind: null,
        reconcile_attempts: 0,
        job_type: "generate-image",
      }),
      error: null,
    })

    await processor(makeBullJob("generate-image"))

    expect(mocks.mockTryInlineReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ provider_kind: null }),
    )
  })

  it("normal flow: runs handler when provider_task_id is null", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({ provider_task_id: null }),
      error: null,
    })

    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockHandler).toHaveBeenCalled()
  })

  it("throws for unknown job type", async () => {
    const job = makeBullJob("unknown-job-type")
    await expect(processor(job)).rejects.toThrow("Unknown job type: unknown-job-type")
  })

  it("updates job to 'processing' before calling handler", async () => {
    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    )
  })

  it("sets provider_kind='pre-task' + provider_call_started_at in the processing transition", async () => {
    // Reconcile blind-spot regression: a worker crash between status=processing
    // and the first onTaskCreated used to leave the row invisible to the
    // reconcile cron (NULL provider_call_started_at filter). The pre-task
    // sentinel + timestamp make the row visible at the 30-min threshold, and
    // the sync-sweep marks it failed + refunds the reservation.
    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "processing",
        provider_kind: "pre-task",
        provider_call_started_at: expect.any(String),
      }),
    )
  })

  it("uses should_watermark from job record in cloud edition", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({ should_watermark: true }),
      error: null,
    })

    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockHandler).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ shouldWatermark: true }),
    )
  })

  it("always sets shouldWatermark=false in self-hosted edition", async () => {
    mocks.mockHasCreditsRef.value = false
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({ should_watermark: true }),
      error: null,
    })

    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockHandler).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ shouldWatermark: false }),
    )
  })

  it("sets isPublicOutput=false when prompt is blocked", async () => {
    mocks.mockIsPromptBlocked.mockReturnValueOnce(true)

    const job = makeBullJob("generate-image", { prompt: "blocked content" })
    await processor(job)

    // The update call should have is_public: false
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ is_public: false }),
    )
  })

  it("creates asset after successful handler", async () => {
    const job = makeBullJob("generate-image")
    await processor(job)
    expect(mocks.mockCreateAssetFromJob).toHaveBeenCalledWith("job-1", "user-1")
  })

  it("updates job to 'failed' on error", async () => {
    mocks.mockHandler.mockRejectedValueOnce(new Error("handler crashed"))

    const job = makeBullJob("generate-image")
    await expect(processor(job)).rejects.toThrow("handler crashed")

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_message: "handler crashed" }),
    )
  })

  it("stores only sanitized message for KieError (no internal details)", async () => {
    mocks.mockHandler.mockRejectedValueOnce(
      new KieError("Image generation failed", "KIE API returned 500: internal server error", "generate-image"),
    )

    const job = makeBullJob("generate-image")
    await expect(processor(job)).rejects.toThrow("Image generation failed")

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: "Image generation failed",
      }),
    )
  })

  it("refunds credits on error", async () => {
    mocks.mockHandler.mockRejectedValueOnce(new Error("crash"))

    const job = makeBullJob("generate-image")
    await expect(processor(job)).rejects.toThrow()

    expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", "crash")
  })

  // -------------------------------------------------------------------------
  // Unified generate-video node — dispatch parity contract.
  //
  // The new node never emits its own `job.name`; payload-builder swaps in
  // either "image-to-video" (start frame wired) or "text-to-video" (text-only).
  // The worker must continue to route those job-name strings to the same i2v
  // and t2v handlers it has always used — no new entries needed in the map,
  // just confirmation that both names still resolve.
  //
  // Adding these guards prevents a future refactor (e.g., introducing a
  // dedicated "generate-video" handler key) from silently breaking dispatch
  // for the unified node while leaving the legacy single-node routes intact.
  // -------------------------------------------------------------------------

  it("dispatch parity: routes 'image-to-video' job.name through videoAIHandlers (generate-video start-frame mode)", async () => {
    const job = makeBullJob("image-to-video", { provider: "kling" })
    await processor(job)
    expect(mocks.mockHandler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: "job-1" }))
  })

  it("dispatch parity: routes 'text-to-video' job.name through videoAIHandlers (generate-video text-only mode)", async () => {
    const job = makeBullJob("text-to-video", { provider: "kling" })
    await processor(job)
    expect(mocks.mockHandler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: "job-1" }))
  })

  it("dispatch parity: does NOT recognize 'generate-video' as a job name (payload-builder must rewrite it)", async () => {
    // Regression net: if anyone removes the mode-dispatch swap in
    // payload-builder.ts and lets the raw node type leak through to
    // BullMQ, the worker has nothing to do with it. Surface that as a
    // fast crash, not a silent stall on a queue with no handler.
    const job = makeBullJob("generate-video")
    await expect(processor(job)).rejects.toThrow("Unknown job type: generate-video")
  })
})
