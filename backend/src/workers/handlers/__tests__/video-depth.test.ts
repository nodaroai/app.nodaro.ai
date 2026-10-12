import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  falVideoDepth: vi.fn(),
  replicateVideoDepth: vi.fn(),
  grayscaleVideo: vi.fn(),
  cleanupWorkDir: vi.fn(),
  uploadVideoMaybeWatermark: vi.fn(),
  watermarkLocalVideoAndUpload: vi.fn(),
  generateAndUploadThumbnail: vi.fn(),
  setJobProgress: vi.fn(),
  rampStop: vi.fn(),
  startProgressRamp: vi.fn(),
  finalizeJobWithMedia: vi.fn(),
  makeOnTaskCreated: vi.fn(),
}))

vi.mock("../../../providers/fal/video-depth.js", () => ({ falVideoDepth: mocks.falVideoDepth }))
vi.mock("../../../providers/replicate/video-depth.js", () => ({ replicateVideoDepth: mocks.replicateVideoDepth }))
vi.mock("../../../providers/video/grayscale-video.js", () => ({ grayscaleVideo: mocks.grayscaleVideo }))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ cleanupWorkDir: mocks.cleanupWorkDir }))
vi.mock("../../../lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: mocks.makeOnTaskCreated }))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeJobWithMedia }))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
    watermarkLocalVideoAndUpload: mocks.watermarkLocalVideoAndUpload,
    generateAndUploadThumbnail: mocks.generateAndUploadThumbnail,
    setJobProgress: mocks.setJobProgress,
    startProgressRamp: mocks.startProgressRamp,
  }
})

import type { Job } from "bullmq"
import { handleVideoDepth, videoDepthHandlers } from "../video-depth.js"

function job(data: Record<string, unknown>): Job {
  return { name: "video-depth", id: "bull-1", data: { jobId: "job-1", ...data }, updateProgress: vi.fn() } as unknown as Job
}

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.falVideoDepth.mockResolvedValue({ videoUrl: "https://fal.media/depth.mp4", cost: 0.12 })
  mocks.replicateVideoDepth.mockResolvedValue({ videoUrl: "https://replicate.delivery/depth.mp4", cost: 0.03 })
  mocks.grayscaleVideo.mockResolvedValue({ outputPath: "/tmp/gray/output.mp4", workDir: "/tmp/gray" })
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
  mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://r2/out.mp4")
  mocks.watermarkLocalVideoAndUpload.mockResolvedValue("https://r2/gray.mp4")
  mocks.generateAndUploadThumbnail.mockResolvedValue("https://r2/thumb.png")
  mocks.setJobProgress.mockResolvedValue(undefined)
  mocks.startProgressRamp.mockReturnValue({ stop: mocks.rampStop })
  mocks.finalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.makeOnTaskCreated.mockImplementation(() => vi.fn())
})

describe("videoDepthHandlers", () => {
  it("registers the handler under the job name", () => {
    expect(videoDepthHandlers["video-depth"]).toBe(handleVideoDepth)
  })
})

describe("handleVideoDepth", () => {
  it("fal provider → falVideoDepth with levers, then finalize as video-depth", async () => {
    await handleVideoDepth(job({ provider: "video-depth-anything", videoUrl: "https://x/v.mp4", modelSize: "small", colormap: "magma", resolution: "720p", sideBySide: true, outputFps: 24, durationSec: 12 }), ctx)
    expect(mocks.falVideoDepth).toHaveBeenCalledWith("video-depth-anything", "https://x/v.mp4",
      expect.objectContaining({ modelSize: "small", colormap: "magma", resolution: "720p", sideBySide: true, durationSec: 12 }),
      expect.objectContaining({ onTaskCreated: expect.any(Function) }))
    // A job queued before the lever was removed still carries outputFps; it is never handed on.
    expect(mocks.falVideoDepth.mock.calls[0][2]).not.toHaveProperty("outputFps")
    expect(mocks.makeOnTaskCreated).toHaveBeenCalledWith("job-1", "fal-request")
    expect(mocks.replicateVideoDepth).not.toHaveBeenCalled()
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith("https://fal.media/depth.mp4", "job-1", "user-1", false)
    expect(mocks.generateAndUploadThumbnail).toHaveBeenCalledWith("https://r2/out.mp4", "job-1", "user-1")
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith({
      jobId: "job-1",
      jobType: "video-depth",
      result: { url: "https://fal.media/depth.mp4", cost: 0.12, displayCost: 0.12, providerUsed: "fal" },
      mediaUrl: "https://r2/out.mp4",
      extraOutputData: { thumbnailUrl: "https://r2/thumb.png" },
    })
  })

  it("reads the orchestrator's duration_seconds stamp when durationSec is absent", async () => {
    await handleVideoDepth(job({ provider: "video-depth-anything", videoUrl: "https://x/v.mp4", colormap: "grayscale", duration_seconds: 12 }), ctx)
    expect(mocks.falVideoDepth).toHaveBeenCalledWith("video-depth-anything", "https://x/v.mp4",
      expect.objectContaining({ durationSec: 12 }), expect.anything())
  })

  it("replicate provider → replicateVideoDepth", async () => {
    await handleVideoDepth(job({ provider: "depth-anything-frames", videoUrl: "https://x/v.mp4", modelSize: "base", colormap: "inferno" }), ctx)
    expect(mocks.replicateVideoDepth).toHaveBeenCalledWith("depth-anything-frames", "https://x/v.mp4",
      expect.objectContaining({ modelSize: "base", colormap: "inferno" }),
      expect.objectContaining({ onTaskCreated: expect.any(Function) }))
    expect(mocks.makeOnTaskCreated).toHaveBeenCalledWith("job-1", "replicate-prediction")
    expect(mocks.falVideoDepth).not.toHaveBeenCalled()
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "video-depth",
      result: expect.objectContaining({ url: "https://replicate.delivery/depth.mp4", providerUsed: "replicate:depth-anything-frames" }),
    }))
  })

  it("replicate + no colormap → grayscale ffmpeg pass, local upload, work dir cleaned", async () => {
    await handleVideoDepth(job({ provider: "depth-anything-frames", videoUrl: "https://x/v.mp4" }), { ...ctx, shouldWatermark: true })
    expect(mocks.grayscaleVideo).toHaveBeenCalledWith("https://replicate.delivery/depth.mp4")
    expect(mocks.watermarkLocalVideoAndUpload).toHaveBeenCalledWith("/tmp/gray/output.mp4", "job-1", "user-1", true)
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/gray")
    expect(mocks.generateAndUploadThumbnail).toHaveBeenCalledWith("https://r2/gray.mp4", "job-1", "user-1")
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "https://r2/gray.mp4" }))
  })

  it("replicate + grayscale pass: an upload failure rethrows, still cleans the work dir and never finalizes", async () => {
    mocks.watermarkLocalVideoAndUpload.mockRejectedValueOnce(new Error("R2 down"))
    await expect(handleVideoDepth(job({ provider: "depth-anything-frames", videoUrl: "https://x/v.mp4" }), ctx)).rejects.toThrow("R2 down")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/gray")
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("replicate + grayscale pass failure is tagged post-processing (no refund: the provider delivered)", async () => {
    mocks.grayscaleVideo.mockRejectedValueOnce(new Error("ffmpeg failed: boom"))
    const err = await handleVideoDepth(job({ provider: "depth-anything-frames", videoUrl: "https://x/v.mp4" }), ctx).catch((e: unknown) => e)
    expect((err as { postProcessing?: unknown }).postProcessing).toBe(true)
    expect(mocks.cleanupWorkDir).not.toHaveBeenCalled()
  })

  it("replicate + inferno → no grayscale pass", async () => {
    await handleVideoDepth(job({ provider: "depth-anything-frames", videoUrl: "https://x/v.mp4", colormap: "inferno" }), ctx)
    expect(mocks.grayscaleVideo).not.toHaveBeenCalled()
    expect(mocks.watermarkLocalVideoAndUpload).not.toHaveBeenCalled()
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith("https://replicate.delivery/depth.mp4", "job-1", "user-1", false)
  })

  it("fal + grayscale → no grayscale pass (fal renders the colormap itself)", async () => {
    await handleVideoDepth(job({ provider: "video-depth-anything", videoUrl: "https://x/v.mp4", colormap: "grayscale" }), ctx)
    expect(mocks.grayscaleVideo).not.toHaveBeenCalled()
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith("https://fal.media/depth.mp4", "job-1", "user-1", false)
  })

  it("stops the progress ramp even when the provider throws", async () => {
    mocks.falVideoDepth.mockRejectedValueOnce(new Error("fal 500"))
    await expect(handleVideoDepth(job({ provider: "video-depth-anything", videoUrl: "https://x/v.mp4" }), ctx)).rejects.toThrow("fal 500")
    expect(mocks.rampStop).toHaveBeenCalled()
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("unknown provider throws", async () => {
    await expect(handleVideoDepth(job({ provider: "nope", videoUrl: "https://x/v.mp4" }), ctx)).rejects.toThrow(/Unsupported video-depth provider/)
    expect(mocks.falVideoDepth).not.toHaveBeenCalled()
    expect(mocks.replicateVideoDepth).not.toHaveBeenCalled()
  })
})
