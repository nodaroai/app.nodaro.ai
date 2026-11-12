import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The video-upscale handler's Nodaro Video Upscale lane (decided 2026-11-11):
 * the run happens behind the house-model seam (`runHouseModelTask`, mocked
 * here), on its row's poll cadence and budget, with the stored clip's one
 * measurement as its input facts; its result is delivered by the lane's ONE
 * delivery (`deliverHouseModelRun` → the lane row's `deliver`, real here) —
 * the same the reconcile calls — never this handler's own finalize. A failure
 * is rethrown unchanged: the seam says what is final and what is pending.
 */
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  upload: vi.fn(),
  thumbnail: vi.fn(),
  finalizeJob: vi.fn(),
  row: { user_id: "user-1", should_watermark: false, status: "processing" } as Record<string, unknown> | null,
  readError: null as { code?: string; message: string } | null,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => (mocks.readError ? { data: null, error: mocks.readError } : { data: mocks.row, error: null })) })) })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
    })),
  },
}))
vi.mock("@/lib/house-models.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/house-models.js")>()),
  planHouseModelRun: () => ({ providerCostUsd: 0.4 }),
  runHouseModelTask: mocks.run,
}))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeJob }))
vi.mock("@/workers/shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/workers/shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.upload,
    generateAndUploadThumbnail: mocks.thumbnail,
    setJobProgress: vi.fn(async () => {}),
    withProgressRamp: vi.fn(async (_j: unknown, _i: unknown, _o: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

import { videoAIHandlers } from "../video-ai.js"
import { deliverHouseModelRun } from "../../../lib/house-model-delivery.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { JobCancelledError } from "../../../lib/job-cancellation.js"
import { isPostProcessingError } from "../../../lib/post-processing-error.js"
import { HouseModelRunError, HouseModelRunPendingError, isHouseModelRunFinal, isHouseModelRunPending } from "../../../lib/house-model-failure.js"

const ctx = { jobId: "job-nvu", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: false }
const CLIP = "https://cdn.example.com/tmp/provider-input/job-nvu/outside-input-x.mp4"
const job = (data: Record<string, unknown> = {}) => ({
  name: "video-upscale",
  data: { jobId: "job-nvu", provider: "nodaro-video-upscale", videoUrl: CLIP, tier: "2k", targetResolution: "2k", billedSec: 10, sourceDurationSec: 9.4, sourceSizeBytes: 12_000_000, ...data },
  id: "b",
  updateProgress: vi.fn(),
})
const run = (data?: Record<string, unknown>) => videoAIHandlers["video-upscale"](job(data) as never, ctx as never)
type FinalizeArg = { result: Record<string, unknown>; mediaUrl: string; extraOutputData: Record<string, unknown> } & Record<string, unknown>
const finalized = () => mocks.finalizeJob.mock.calls[0]![0] as FinalizeArg

beforeEach(() => {
  vi.clearAllMocks()
  mocks.row = { user_id: "user-1", should_watermark: false, status: "processing" }
  mocks.readError = null
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  mocks.run.mockResolvedValue({ resultUrls: ["https://results.example/out.mp4"], width: 2560, height: 1440, reportedCostUsd: 0.4, plannedCostUsd: 0.45 })
  mocks.upload.mockResolvedValue("https://r2.example/out.mp4")
  mocks.thumbnail.mockResolvedValue("https://r2.example/thumb.png")
  mocks.finalizeJob.mockResolvedValue({ ok: true })
})

describe("video-upscale nodaro-video-upscale — a served run", () => {
  it("runs exactly what was priced, on its row's cadence and budget, with the stored clip's one measurement as its input facts", async () => {
    await run()
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.run).toHaveBeenCalledWith(
      "nodaro-video-upscale",
      { videoUrl: CLIP, tier: "2k", billedSec: 10 },
      { jobId: "job-nvu", pollIntervalMs: 10_000, timeoutMs: 3_600_000, inputFacts: { [CLIP]: { bytes: 12_000_000 } } },
    )
  })

  it("delivers through the lane's one delivery: re-hosted as delivered, its thumbnail, completed once", async () => {
    await run()
    expect(mocks.upload).toHaveBeenCalledWith("https://results.example/out.mp4", "job-nvu", "user-1", false)
    expect(mocks.thumbnail).toHaveBeenCalledWith("https://r2.example/out.mp4", "job-nvu", "user-1")
    expect(mocks.finalizeJob).toHaveBeenCalledTimes(1)
    expect(finalized()).toMatchObject({ jobId: "job-nvu", jobType: "video-upscale", claimant: "worker", mediaUrl: "https://r2.example/out.mp4" })
    expect(finalized().extraOutputData).toMatchObject({ thumbnailUrl: "https://r2.example/thumb.png" })
  })

  it("records the run's reported cost and the house-model id as the provider, and commits the reserved price as it is (nothing metered)", async () => {
    await run()
    expect(finalized().result).toEqual({ url: "https://results.example/out.mp4", cost: 0.4, providerUsed: "nodaro-video-upscale" })
    expect(finalized()).not.toHaveProperty("meteredBaseCredits")
  })

  it("writes the output size only when the run reports both", async () => {
    await run()
    expect(finalized().extraOutputData).toMatchObject({ width: 2560, height: 1440 })
    mocks.finalizeJob.mockClear()
    mocks.run.mockResolvedValueOnce({ resultUrls: ["https://results.example/out.mp4"], reportedCostUsd: null, plannedCostUsd: 0.45 })
    await run()
    expect(finalized().extraOutputData).not.toHaveProperty("width")
    // No reported cost: the start's planned figure.
    expect(finalized().result.cost).toBe(0.45)
  })
})

describe("video-upscale nodaro-video-upscale — failures are rethrown unchanged", () => {
  it("a final failure (failed and refunded now) is the seam's own error", async () => {
    const final = Object.assign(new HouseModelRunError("Nodaro Video Upscale could not complete this run.", "nodaro-video-upscale", "House model run failed."), { deterministic: true as const })
    mocks.run.mockRejectedValueOnce(final)
    const err = await run().catch((e: unknown) => e)
    expect(err).toBe(final)
    expect(isHouseModelRunFinal(err)).toBe(true)
    expect(mocks.finalizeJob).not.toHaveBeenCalled()
  })

  it("a pending run (a timeout, failed status reads) is left for the reconcile to read again", async () => {
    const pending = new HouseModelRunPendingError("Nodaro Video Upscale did not finish within 60 minutes; the run will be checked again.", "nodaro-video-upscale")
    mocks.run.mockRejectedValueOnce(pending)
    const err = await run().catch((e: unknown) => e)
    expect(err).toBe(pending)
    expect(isHouseModelRunPending(err)).toBe(true)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("a cancellation passes through untouched", async () => {
    const cancelled = new JobCancelledError("job-nvu")
    mocks.run.mockRejectedValueOnce(cancelled)
    await expect(run()).rejects.toBe(cancelled)
  })

  it("a job without its tier, billed seconds or measured size is refused as deterministic, and nothing is run", async () => {
    for (const missing of [{ tier: undefined }, { billedSec: undefined }, { sourceSizeBytes: undefined }, { tier: "8k" }]) {
      expect(isDeterministicJobError(await run(missing).catch((e: unknown) => e)), JSON.stringify(missing)).toBe(true)
    }
    expect(mocks.run).not.toHaveBeenCalled()
  })
})

describe("the lane's one delivery, from the reconcile (the same function)", () => {
  it("delivers a recovered run exactly like the worker, with the job's own watermark and the cron as claimant", async () => {
    mocks.row = { user_id: "user-2", should_watermark: true, status: "processing" }
    await deliverHouseModelRun({
      id: "nodaro-video-upscale",
      jobId: "job-rec",
      jobType: "video-upscale",
      job: { videoUrl: CLIP, tier: "4k", billedSec: 30 },
      resultUrls: ["https://results.example/rec.mp4"],
      reportedCostUsd: null,
      claimant: "cron",
    })
    expect(mocks.upload).toHaveBeenCalledWith("https://results.example/rec.mp4", "job-rec", "user-2", true)
    expect(finalized()).toMatchObject({ jobId: "job-rec", claimant: "cron", result: { providerUsed: "nodaro-video-upscale", cost: null } })
  })
})

describe("the delivery reads the job's row first, and stores nothing it cannot vouch for", () => {
  const recovered = () => deliverHouseModelRun({
    id: "nodaro-video-upscale",
    jobId: "job-rec",
    jobType: "video-upscale",
    job: { videoUrl: CLIP, tier: "4k", billedSec: 30 },
    resultUrls: ["https://results.example/rec.mp4"],
    reportedCostUsd: null,
    claimant: "cron",
  })

  it("a failed read is thrown as a post-processing failure (retried, or left for the reconcile): nothing downloaded, stored or finalized", async () => {
    mocks.readError = { code: "57014", message: "canceling statement due to statement timeout" }
    const err = await run().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isPostProcessingError(err)).toBe(true)
    // The seam's fixed sentence, never the read's own words.
    expect((err as Error).message).toBe("Nodaro Video Upscale finished, but its result could not be stored.")
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.thumbnail).not.toHaveBeenCalled()
    expect(mocks.finalizeJob).not.toHaveBeenCalled()
  })

  it.each(["completed", "failed", "cancelled", "pending_review"])("a job already %s is the finalize's graceful skip, before any download", async (status) => {
    mocks.row = { user_id: "user-2", should_watermark: true, status }
    await expect(recovered()).resolves.toEqual({ ok: false })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.thumbnail).not.toHaveBeenCalled()
    expect(mocks.finalizeJob).not.toHaveBeenCalled()
  })

  it("a job with no row (PostgREST's no-row answer) is skipped the same way, never thrown", async () => {
    mocks.readError = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }
    await expect(recovered()).resolves.toEqual({ ok: false })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.finalizeJob).not.toHaveBeenCalled()
  })

  it("a pending job (picked up, not yet processing) is still delivered", async () => {
    mocks.row = { user_id: "user-2", should_watermark: true, status: "pending" }
    await recovered()
    expect(mocks.upload).toHaveBeenCalledWith("https://results.example/rec.mp4", "job-rec", "user-2", true)
    expect(mocks.finalizeJob).toHaveBeenCalledTimes(1)
  })
})
