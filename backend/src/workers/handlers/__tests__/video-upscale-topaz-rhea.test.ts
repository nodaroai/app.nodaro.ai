import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The video-upscale handler's Topaz Rhea lane (decided 2026-11-24): it sends
 * exactly the factor, target and billed seconds the route priced, persists the
 * fal request for the reconcile (`fal-rhea`), brings the output to the
 * planned frame through the shared delivery under the finalize claim (taken
 * before the delivery, so the worker and the reconcile cron never both do the delivery work), records the provider's cost, and
 * commits the reserved price as it is (nothing metered). Nodaro Video Upscale
 * in transparent mode (its default) runs this same lane. A job missing its plan fails final, before any call.
 */
const mocks = vi.hoisted(() => ({
  rhea: vi.fn(),
  upload: vi.fn(),
  thumbnail: vi.fn(),
  finalizeJob: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
  onTaskCreated: vi.fn(),
  makeOnTaskCreated: vi.fn(),
  delivered: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/providers/fal/topaz-rhea.js", () => ({ falTopazRheaUpscale: mocks.rhea }))
// The delivery (crop / sound) is lib/topaz-rhea-delivery.ts's own test; here it stores the engine's file through the given store.
vi.mock("@/lib/topaz-rhea-delivery.js", () => ({
  deliverRheaOutput: vi.fn(async (opts: { outputUrl: string; store: (p: string) => Promise<unknown>; expected: unknown }) => {
    mocks.delivered.push(opts)
    // The delivery reports the stored file's probed frame (here one pixel off the plan, to tell them apart).
    return { stored: await opts.store(`/tmp/fitted-of-${opts.outputUrl}`), width: 720, height: 1278 }
  }),
}))
vi.mock("@/lib/reconcile/persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reconcile/persistence.js")>()),
  makeOnTaskCreated: mocks.makeOnTaskCreated,
}))
vi.mock("@/lib/job-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-finalize.js")>()),
  finalizeJobWithMedia: mocks.finalizeJob,
  claimJobFinalize: mocks.claim,
  releaseJobFinalizeClaim: mocks.release,
}))
vi.mock("@/workers/shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/workers/shared.js")>()
  return {
    ...actual,
    watermarkLocalVideoAndUpload: mocks.upload,
    generateAndUploadThumbnail: mocks.thumbnail,
    setJobProgress: vi.fn(async () => {}),
    withProgressRamp: vi.fn(async (_j: unknown, _i: unknown, _o: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

import { videoAIHandlers } from "../video-ai.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

const ctx = { jobId: "job-rhea", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: true }
const CLIP = "https://cdn.example.com/take.mp4"
const job = (data: Record<string, unknown> = {}) => ({
  updateData: vi.fn(async function (this: { data: Record<string, unknown> }, next: Record<string, unknown>) { this.data = next }),
  name: "video-upscale",
  data: { jobId: "job-rhea", provider: "topaz-rhea", videoUrl: CLIP, targetResolution: "720p", upscaleRatio: 1.5, upscaleBilledSec: 5, upscaleFrameWidth: 720, upscaleFrameHeight: 1280, upscaleRateTier: "720p", usageLogId: "log-1", ...data },
  id: "b",
  updateProgress: vi.fn(),
})
const run = (data?: Record<string, unknown>) => videoAIHandlers["video-upscale"](job(data) as never, ctx as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  mocks.makeOnTaskCreated.mockReturnValue(mocks.onTaskCreated)
  mocks.rhea.mockReset()
  mocks.rhea.mockResolvedValue({ url: "https://fal.media/out.mp4", cost: 0.05, providerMs: 35_000, requestId: "req-x" })
  mocks.upload.mockResolvedValue({ videoUrl: "https://r2.example/out.mp4" })
  mocks.thumbnail.mockResolvedValue("https://r2.example/thumb.png")
  mocks.finalizeJob.mockResolvedValue({ ok: true })
  mocks.claim.mockResolvedValue({ won: true, ts: "2026-11-24T10:00:00.000Z" })
})

describe("video-upscale topaz-rhea", () => {
  it("sends exactly what was priced and persists the fal request for the reconcile", async () => {
    await run()
    expect(mocks.makeOnTaskCreated).toHaveBeenCalledWith("job-rhea", "fal-rhea")
    expect(mocks.rhea).toHaveBeenCalledWith({
      videoUrl: CLIP,
      upscaleFactor: 1.5,
      target: "720p",
      billedSec: 5,
      reconcileOpts: { onTaskCreated: mocks.onTaskCreated },
      onSubmitted: expect.any(Function),
    })
  })

  it("brings the output to the planned frame (the shared delivery), stores it with the account's watermark rule, and finalizes once at the reserved price", async () => {
    mocks.delivered.length = 0
    await run()
    expect(mocks.delivered[0]).toMatchObject({ outputUrl: "https://fal.media/out.mp4", expected: { width: 720, height: 1280 }, sourceUrl: CLIP, jobId: "job-rhea" })
    expect(mocks.upload).toHaveBeenCalledWith("/tmp/fitted-of-https://fal.media/out.mp4", "job-rhea", "user-1", true)
    expect(mocks.finalizeJob).toHaveBeenCalledTimes(1)
    const arg = mocks.finalizeJob.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({
      jobId: "job-rhea",
      jobType: "video-upscale",
      video: { videoUrl: "https://r2.example/out.mp4" },
      result: { url: "https://fal.media/out.mp4", cost: 0.05, providerUsed: "topaz-rhea", providerMs: 35_000 },
      // The stored file's probed frame, never the plan's.
      extraOutputData: { thumbnailUrl: "https://r2.example/thumb.png", width: 720, height: 1278 },
    })
    expect(arg).not.toHaveProperty("meteredBaseCredits")
  })

  it("takes the finalize claim BEFORE the delivery, as the worker", async () => {
    mocks.delivered.length = 0
    const order: string[] = []
    mocks.claim.mockImplementationOnce(async () => { order.push("claim"); return { won: true, ts: "t1" } })
    mocks.upload.mockImplementationOnce(async () => { order.push("deliver"); return "https://r2.example/out.mp4" })
    await run()
    expect(mocks.claim).toHaveBeenCalledWith("job-rhea", "worker")
    expect(order).toEqual(["claim", "deliver"])
  })

  it("the claim is taken by another finalizer mid-delivery: this worker stops before it stores, and does not finalize", async () => {
    const { CLAIM_REFRESH_MS } = await import("../../../lib/finalize-claim-hold.js")
    const { deliverRheaOutput } = await import("@/lib/topaz-rhea-delivery.js")
    vi.useFakeTimers()
    try {
      mocks.claim.mockResolvedValueOnce({ won: true, ts: "t1" }).mockResolvedValue({ won: false, ts: null })
      vi.mocked(deliverRheaOutput).mockImplementationOnce(async (opts) => {
        // The download and encode outlast a refresh, which finds the claim taken.
        await vi.advanceTimersByTimeAsync(CLAIM_REFRESH_MS + 1)
        return { stored: await opts.store("/tmp/fitted.mp4"), width: 720, height: 1280 }
      })
      await expect(run()).resolves.toBeUndefined()
      expect(mocks.upload).not.toHaveBeenCalled()
      expect(mocks.finalizeJob).not.toHaveBeenCalled()
      expect(mocks.release).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("another finalizer holds the claim (the reconcile is delivering this run): this worker neither delivers nor finalizes", async () => {
    mocks.delivered.length = 0
    mocks.claim.mockResolvedValueOnce({ won: false, ts: null })
    await expect(run()).resolves.toBeUndefined()
    expect(mocks.delivered).toHaveLength(0)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.finalizeJob).not.toHaveBeenCalled()
  })

  it("a delivery that fails releases the claim, so a retry or the reconcile need not wait it out", async () => {
    mocks.claim.mockResolvedValueOnce({ won: true, ts: "t-claim" })
    mocks.upload.mockRejectedValueOnce(new Error("upload failed"))
    await expect(run()).rejects.toThrow("upload failed")
    expect(mocks.release).toHaveBeenCalledWith("job-rhea", "t-claim")
    expect(mocks.finalizeJob).not.toHaveBeenCalled()
  })

  it("a job without its plan fails final, before any call", async () => {
    for (const missing of [{ upscaleRatio: undefined }, { upscaleBilledSec: undefined }, { upscaleFrameWidth: undefined }, { upscaleRateTier: "2k" }, { videoUrl: undefined }]) {
      const err = await run(missing).catch((e: unknown) => e)
      expect(isDeterministicJobError(err)).toBe(true)
    }
    expect(mocks.rhea).not.toHaveBeenCalled()
  })
})

describe("Nodaro Video Upscale's modes on the worker", () => {
  it("a job that names Transparent runs the Rhea lane and is recorded as Nodaro Video Upscale", async () => {
    await run({ provider: "nodaro-video-upscale", mode: "transparent", tier: "2k", targetResolution: "2k", upscaleRateTier: "4k" })
    expect(mocks.rhea).toHaveBeenCalledTimes(1)
    expect(mocks.rhea.mock.calls[0]![0]).toMatchObject({ target: "4k", upscaleFactor: 1.5 })
    expect((mocks.finalizeJob.mock.calls[0]![0] as { result: { providerUsed: string } }).result.providerUsed).toBe("nodaro-video-upscale")
  })

  it("a job queued before modes existed (no mode, no run plan) is the pre-change shape: Sharp, never the Rhea lane", async () => {
    const preDeploy = { jobId: "job-old", provider: "nodaro-video-upscale", videoUrl: CLIP, tier: "2k", targetResolution: "2k", billedSec: 10, sourceDurationSec: 9.4, sourceSizeBytes: 12_000_000 }
    const j = { ...job(), data: preDeploy }
    await videoAIHandlers["video-upscale"](j as never, ctx as never).catch(() => undefined)
    expect(mocks.rhea).not.toHaveBeenCalled()
  })
})

describe("one engine request per job: a retry or a stall re-pick resumes it", () => {
  it("a retry after the submit polls the same request; there is one engine request in total", async () => {
    const j = job()
    mocks.rhea.mockImplementationOnce(async (opts: { onSubmitted: (id: string) => Promise<void> }) => {
      await opts.onSubmitted("req-1")
      throw new Error("the worker died mid-wait")
    })
    await expect(videoAIHandlers["video-upscale"](j as never, ctx as never)).rejects.toThrow("mid-wait")
    expect((j.data as Record<string, unknown>).upscaleRequestId).toBe("req-1")
    // The retry (or a stall re-pick of the same queue job) resumes it.
    await videoAIHandlers["video-upscale"](j as never, ctx as never)
    expect(mocks.rhea).toHaveBeenCalledTimes(2)
    expect(mocks.rhea.mock.calls[0]![0]).not.toHaveProperty("resumeRequestId")
    expect(mocks.rhea.mock.calls[1]![0]).toMatchObject({ resumeRequestId: "req-1" })
    // The resumed wait restamps the row as a Rhea run (the pickup put it back on the pre-task sentinel), before it polls:
    // its own wait is what the kind's threshold covers.
    expect(mocks.onTaskCreated).toHaveBeenCalledWith("req-1")
    expect(mocks.onTaskCreated.mock.invocationCallOrder[0]!).toBeLessThan(mocks.rhea.mock.invocationCallOrder[1]!)
  })

  it("a request the engine answered as failed is forgotten, so its retry submits a new one", async () => {
    const j = job({ upscaleRequestId: "req-1" })
    mocks.rhea.mockRejectedValueOnce(Object.assign(new Error("fal request failed (req-1): boom"), { ended: true }))
    await expect(videoAIHandlers["video-upscale"](j as never, ctx as never)).rejects.toThrow("boom")
    expect(j.data).not.toHaveProperty("upscaleRequestId")
  })
})
