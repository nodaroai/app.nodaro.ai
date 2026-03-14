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

// Mock all handler modules to return our controllable mockHandler
vi.mock("../handlers/image-ai.js", () => ({
  imageAIHandlers: { "generate-image": mocks.mockHandler },
}))
vi.mock("../handlers/video-ai.js", () => ({
  videoAIHandlers: { "image-to-video": mocks.mockHandler },
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
})
