import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Worker handler test for the Beeble SwitchX job. Mocks the provider, the
 * semaphore, cancellation, persistence, finalize, and the watermark helper so we
 * can assert the lifecycle in isolation: submit (semaphore-bounded) → persist
 * task id → poll → re-host WITH watermark (never bare uploadToR2) → commit the
 * reserved bucket verbatim. Poll delays are driven with fake timers.
 */

const mocks = vi.hoisted(() => {
  const onTaskCreated = vi.fn(async () => {})
  // Declared inside vi.hoisted so it's initialized before the hoisted vi.mock
  // factory references it (a top-level class would be in the TDZ at mock time).
  class FakeBeebleError extends Error {
    constructor(message: string, public readonly code: string, public readonly status: number) {
      super(message)
      this.name = "BeebleError"
    }
  }
  return {
    BeebleError: FakeBeebleError,
    startSwitchXGeneration: vi.fn(),
    getSwitchXStatus: vi.fn(),
    withSwitchXSlot: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    throwIfJobCancelled: vi.fn(async () => {}),
    onTaskCreated,
    makeOnTaskCreated: vi.fn(() => onTaskCreated),
    uploadVideoMaybeWatermark: vi.fn(async () => "https://r2.nodaro.ai/videos/job1.mp4"),
    generateAndUploadThumbnail: vi.fn(async () => "https://r2.nodaro.ai/thumb/job1.webp"),
    setJobProgress: vi.fn(async () => {}),
    finalizeJobWithMedia: vi.fn(async () => ({ ok: true })),
    uploadToR2: vi.fn(async () => "https://r2/UNEXPECTED.mp4"),
  }
})

// `mocks.BeebleError` stands in for the real BeebleError; the handler's
// `instanceof BeebleError` resolves to it via this mock, so error mapping runs.
vi.mock("@/providers/beeble/index.js", () => ({
  startSwitchXGeneration: mocks.startSwitchXGeneration,
  getSwitchXStatus: mocks.getSwitchXStatus,
  BeebleError: mocks.BeebleError,
}))
vi.mock("@/lib/switchx-concurrency.js", () => ({ withSwitchXSlot: mocks.withSwitchXSlot }))
vi.mock("@/lib/job-cancellation.js", () => ({ throwIfJobCancelled: mocks.throwIfJobCancelled }))
vi.mock("@/lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: mocks.makeOnTaskCreated }))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeJobWithMedia }))
// Guard: the worker must NEVER use bare uploadToR2 (skips watermark + transcode).
vi.mock("@/lib/storage.js", () => ({ uploadToR2: mocks.uploadToR2 }))
vi.mock("@/workers/shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/workers/shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
    generateAndUploadThumbnail: mocks.generateAndUploadThumbnail,
    setJobProgress: mocks.setJobProgress,
  }
})

import { handleBeebleSwitchX } from "../beeble-switchx.js"

const ctx = { jobId: "job1", jobUserId: "user1", shouldWatermark: true } as Parameters<
  typeof handleBeebleSwitchX
>[1]

const makeJob = (data: Record<string, unknown>) =>
  ({ data: { jobId: "job1", ...data } }) as unknown as Parameters<typeof handleBeebleSwitchX>[0]

const validData = {
  videoUrl: "https://cdn.example/src.mp4",
  alphaMode: "auto",
  maxResolution: 1080,
  prompt: "warm relight",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.withSwitchXSlot.mockImplementation(async (fn: () => Promise<unknown>) => fn())
  mocks.makeOnTaskCreated.mockReturnValue(mocks.onTaskCreated)
  mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://r2.nodaro.ai/videos/job1.mp4")
  mocks.generateAndUploadThumbnail.mockResolvedValue("https://r2.nodaro.ai/thumb/job1.webp")
  mocks.finalizeJobWithMedia.mockResolvedValue({ ok: true })
})

describe("handleBeebleSwitchX", () => {
  it("submits via the semaphore, persists the task id, polls, re-hosts WITH watermark, commits the reserved bucket", async () => {
    vi.useFakeTimers()
    mocks.startSwitchXGeneration.mockResolvedValue({ id: "swx1" })
    mocks.getSwitchXStatus
      .mockResolvedValueOnce({ id: "swx1", status: "processing", progress: 40 })
      .mockResolvedValueOnce({
        id: "swx1",
        status: "completed",
        progress: 100,
        output: { render: "https://cdn.beeble/render.mp4" },
      })

    const p = handleBeebleSwitchX(makeJob(validData), ctx)
    await vi.advanceTimersByTimeAsync(5000) // poll 1 → processing
    await vi.advanceTimersByTimeAsync(5000) // poll 2 → completed
    await p
    vi.useRealTimers()

    // Submitted once, through the semaphore, with R2 url passed direct + idempotency key = jobId.
    expect(mocks.withSwitchXSlot).toHaveBeenCalledTimes(1)
    expect(mocks.startSwitchXGeneration).toHaveBeenCalledTimes(1)
    expect(mocks.startSwitchXGeneration.mock.calls[0][0]).toMatchObject({
      generation_type: "video",
      source_uri: "https://cdn.example/src.mp4",
      alpha_mode: "auto",
      max_resolution: 1080,
      idempotency_key: "job1",
      prompt: "warm relight",
    })
    // Task id persisted under the `beeble` reconciler kind, BEFORE polling.
    expect(mocks.makeOnTaskCreated).toHaveBeenCalledWith("job1", "beeble")
    expect(mocks.onTaskCreated).toHaveBeenCalledWith("swx1")
    // Re-host uses the watermark+transcode helper, NEVER bare uploadToR2.
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(
      "https://cdn.beeble/render.mp4",
      "job1",
      "user1",
      true,
    )
    expect(mocks.uploadToR2).not.toHaveBeenCalled()
    // Bucket-billed: cost null + meteredCost false; only the R2 url is stored.
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "switchx",
        mediaUrl: "https://r2.nodaro.ai/videos/job1.mp4",
        result: expect.objectContaining({
          url: "https://r2.nodaro.ai/videos/job1.mp4",
          cost: null,
          meteredCost: false,
          providerUsed: "beeble",
        }),
      }),
    )
  })

  it("omits absent optional fields and only sends a mask for mask modes", async () => {
    vi.useFakeTimers()
    mocks.startSwitchXGeneration.mockResolvedValue({ id: "swx1" })
    mocks.getSwitchXStatus.mockResolvedValueOnce({
      id: "swx1",
      status: "completed",
      output: { render: "https://cdn.beeble/render.mp4" },
    })

    const p = handleBeebleSwitchX(
      makeJob({
        videoUrl: "https://cdn.example/src.mp4",
        alphaMode: "select",
        maskUrl: "https://cdn.example/mask.png",
        alphaKeyframeIndex: 12,
        prompt: "x",
        // no referenceImageUrl, no seed, no maxResolution
      }),
      ctx,
    )
    await vi.advanceTimersByTimeAsync(5000)
    await p
    vi.useRealTimers()

    const sent = mocks.startSwitchXGeneration.mock.calls[0][0] as Record<string, unknown>
    expect(sent).toMatchObject({
      alpha_mode: "select",
      alpha_uri: "https://cdn.example/mask.png",
      alpha_keyframe_index: 12,
      max_resolution: 1080, // default
    })
    expect(sent).not.toHaveProperty("reference_image_uri")
    expect(sent).not.toHaveProperty("seed")
  })

  it("throws when Beeble reports a failed status (BullMQ will retry/fail)", async () => {
    vi.useFakeTimers()
    mocks.startSwitchXGeneration.mockResolvedValue({ id: "swx1" })
    mocks.getSwitchXStatus.mockResolvedValueOnce({ id: "swx1", status: "failed", error: "boom" })

    const p = handleBeebleSwitchX(makeJob(validData), ctx)
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(5000)
    await expect(p).rejects.toThrow("boom")
    vi.useRealTimers()

    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("aborts BEFORE the status fetch and re-host when cancelled mid-poll", async () => {
    vi.useFakeTimers()
    mocks.startSwitchXGeneration.mockResolvedValue({ id: "swx1" })
    mocks.throwIfJobCancelled.mockRejectedValueOnce(new Error("cancelled"))

    const p = handleBeebleSwitchX(makeJob(validData), ctx)
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(5000)
    await expect(p).rejects.toThrow("cancelled")
    vi.useRealTimers()

    expect(mocks.getSwitchXStatus).not.toHaveBeenCalled()
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
  })

  it("jitters then rethrows on a rate-limit error so the queue retries, without persisting a task id", async () => {
    vi.useFakeTimers()
    mocks.startSwitchXGeneration.mockRejectedValue(
      new mocks.BeebleError("too many", "RATE_LIMIT_EXCEEDED", 429),
    )

    const p = handleBeebleSwitchX(makeJob(validData), ctx)
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(2000) // cover the 250–1750ms jitter
    await expect(p).rejects.toThrow("too many")
    vi.useRealTimers()

    expect(mocks.makeOnTaskCreated).not.toHaveBeenCalled() // never got past submit
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
  })
})
