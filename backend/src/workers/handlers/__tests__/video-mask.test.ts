import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Worker handler test for Video Mask + Mask Composite. Mocks the provider, the
 * local render steps and the completion helpers so the lifecycle is asserted in
 * isolation: a re-encoded source is uploaded under a SUFFIXED id (never the
 * bare job id — that key is the deliverable's), the mask is uploaded plain
 * (never watermarked), the job completes with the mask's facts and the
 * reserved row is committed.
 */

const mocks = vi.hoisted(() => ({
  prepareVideoMaskSource: vi.fn(),
  renderMaskVideo: vi.fn(async () => ({ coveredFraction: 0.25 })),
  runSam3Video: vi.fn(),
  maskComposite: vi.fn(async () => ({ outputPath: "/tmp/mc/output.mp4", width: 640, height: 360, durationSec: 3 })),
  uploadFileToR2: vi.fn(async (_p: string, id: string) => `https://r2/videos/${id}.mp4`),
  listObjectsByPrefixWithMeta: vi.fn(async (): Promise<Array<{ key: string }>> => []),
  readR2ObjectBuffer: vi.fn(async (): Promise<Buffer | null> => null),
  uploadJobScratchFile: vi.fn(async () => "https://r2/tmp/provider-input/job1/mask-src-ab12cd34.mp4"),
  uploadJobScratchBuffer: vi.fn(async () => "https://r2/tmp/provider-input/job1/sam3-rle-ab12cd34.json"),
  createWorkDir: vi.fn(async () => "/tmp/vm"),
  cleanupWorkDir: vi.fn(async () => {}),
  markJobCompleted: vi.fn(async () => true),
  commitJobCredits: vi.fn(async () => {}),
  generateAndUploadThumbnail: vi.fn(async () => "https://r2/thumb.webp"),
  setJobProgress: vi.fn(async () => {}),
  shouldSaveJobResult: vi.fn(async () => true),
  completeFfmpegVideoJob: vi.fn(async () => {}),
}))

vi.mock("@/providers/video/video-mask.js", () => ({
  prepareVideoMaskSource: mocks.prepareVideoMaskSource,
  renderMaskVideo: mocks.renderMaskVideo,
}))
vi.mock("@/providers/fal/sam3-video.js", () => ({ runSam3Video: mocks.runSam3Video }))
vi.mock("@/providers/video/mask-composite.js", () => ({ maskComposite: mocks.maskComposite }))
vi.mock("@/lib/storage.js", () => ({
  uploadFileToR2: mocks.uploadFileToR2,
  listObjectsByPrefixWithMeta: mocks.listObjectsByPrefixWithMeta,
  readR2ObjectBuffer: mocks.readR2ObjectBuffer,
}))
vi.mock("@/lib/job-scratch.js", () => ({
  jobScratchPrefix: (id: string) => `tmp/provider-input/${id}/`,
  uploadJobScratchFile: mocks.uploadJobScratchFile,
  uploadJobScratchBuffer: mocks.uploadJobScratchBuffer,
}))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ createWorkDir: mocks.createWorkDir, cleanupWorkDir: mocks.cleanupWorkDir }))
vi.mock("@/workers/shared.js", () => ({
  markJobCompleted: mocks.markJobCompleted,
  commitJobCredits: mocks.commitJobCredits,
  generateAndUploadThumbnail: mocks.generateAndUploadThumbnail,
  setJobProgress: mocks.setJobProgress,
  shouldSaveJobResult: mocks.shouldSaveJobResult,
  completeFfmpegVideoJob: mocks.completeFfmpegVideoJob,
  withProgressRamp: async (_job: unknown, _id: string, _o: unknown, fn: () => Promise<unknown>) => fn(),
}))

import { videoMaskHandlers } from "../video-mask.js"

const ctx = { jobId: "00000000-0000-4000-8000-0000000000aa", jobUserId: "user1", usageLogId: "ul1", shouldWatermark: true }
const job = (data: Record<string, unknown>) => ({ data: { jobId: ctx.jobId, ...data }, updateProgress: vi.fn() }) as never
const geometry = { width: 640, height: 360, frameRate: "30/1", durationSec: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runSam3Video.mockResolvedValue({ rle: Array(90).fill("1 10"), requestId: "r1", cost: 0.03 })
})

describe("video-mask handler", () => {
  it("sends a plain clip as it is, uploads the mask unwatermarked, completes with its facts and commits", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ geometry })
    await videoMaskHandlers["video-mask"]!(job({ videoUrl: "https://x/clip.mp4", prompt: "the dog", threshold: 0.4 }), ctx)
    expect(mocks.runSam3Video).toHaveBeenCalledWith({ videoUrl: "https://x/clip.mp4", prompt: "the dog", threshold: 0.4, frameCount: 90 })
    expect(mocks.uploadFileToR2).toHaveBeenCalledTimes(1)
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith("/tmp/vm/mask.mp4", ctx.jobId, "video", "user1")
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, {
      output_data: { videoUrl: `https://r2/videos/${ctx.jobId}.mp4`, thumbnailUrl: "https://r2/thumb.webp", width: 640, height: 360, frames: 90, coverage: 0.25 },
      provider: "sam-3",
      provider_cost: 0.03,
    })
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("ul1", ctx.jobId)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/vm")
  })

  it("sends a re-encoded source through the job's scratch folder (no quota, deleted at job end) and keeps the answer for a retry", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ normalisedPath: "/tmp/vm/normalised.mp4", geometry })
    await videoMaskHandlers["video-mask"]!(job({ videoUrl: "https://x/phone.mov", prompt: "the dog" }), ctx)
    expect(mocks.uploadJobScratchFile).toHaveBeenCalledWith("/tmp/vm/normalised.mp4", "mask-src", "mp4", "video/mp4", ctx.jobId)
    expect(mocks.runSam3Video).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "https://r2/tmp/provider-input/job1/mask-src-ab12cd34.mp4", threshold: 0.5 }))
    // Only the deliverable goes through the user's storage.
    expect(mocks.uploadFileToR2).toHaveBeenCalledTimes(1)
    const [buf, name, ext, , jobId] = mocks.uploadJobScratchBuffer.mock.calls[0] as unknown as [Buffer, string, string, string, string]
    expect([name, ext, jobId]).toEqual(["sam3-rle", "json", ctx.jobId])
    expect(JSON.parse(buf.toString())).toMatchObject({ geometry, cost: 0.03 })
  })

  it("a retry after the model answered draws the kept segmentation and never pays the model again", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ normalisedPath: "/tmp/vm/normalised.mp4", geometry })
    mocks.listObjectsByPrefixWithMeta.mockResolvedValue([{ key: `tmp/provider-input/${ctx.jobId}/sam3-rle-1a2b3c4d.json` }])
    mocks.readR2ObjectBuffer.mockResolvedValue(Buffer.from(JSON.stringify({ geometry, rle: Array(90).fill("1 10"), cost: 0.03 })))
    await videoMaskHandlers["video-mask"]!(job({ videoUrl: "https://x/phone.mov", prompt: "the dog" }), ctx)
    expect(mocks.runSam3Video).not.toHaveBeenCalled()
    expect(mocks.uploadJobScratchFile).not.toHaveBeenCalled()
    expect(mocks.renderMaskVideo).toHaveBeenCalled()
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ provider_cost: 0.03 }))
  })

  it("ignores a kept segmentation drawn on other geometry", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ geometry })
    mocks.listObjectsByPrefixWithMeta.mockResolvedValue([{ key: `tmp/provider-input/${ctx.jobId}/sam3-rle-1a2b3c4d.json` }])
    mocks.readR2ObjectBuffer.mockResolvedValue(Buffer.from(JSON.stringify({ geometry: { ...geometry, width: 1280 }, rle: [], cost: 0 })))
    await videoMaskHandlers["video-mask"]!(job({ videoUrl: "https://x/c.mp4", prompt: "the dog" }), ctx)
    expect(mocks.runSam3Video).toHaveBeenCalledTimes(1)
  })

  it("refuses a frame count far from the clip's, before drawing anything, and still cleans up", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: Array(40).fill("1 10"), requestId: "r1", cost: 0.01 })
    await expect(videoMaskHandlers["video-mask"]!(job({ videoUrl: "https://x/c.mp4", prompt: "x" }), ctx)).rejects.toThrow(/40 frame masks/)
    expect(mocks.renderMaskVideo).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/vm")
  })

  it("does not complete a job cancelled mid-flight", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ geometry })
    mocks.shouldSaveJobResult.mockResolvedValueOnce(false)
    await videoMaskHandlers["video-mask"]!(job({ videoUrl: "https://x/c.mp4", prompt: "x" }), ctx)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
  })
})

describe("mask-composite handler", () => {
  it("normalises the settings and finishes through the shared ffmpeg completion", async () => {
    await videoMaskHandlers["mask-composite"]!(job({ foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4", feather: 99, backgroundFit: "contain" }), ctx)
    expect(mocks.maskComposite).toHaveBeenCalledWith({
      foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4",
      settings: { invertMask: false, feather: 20, grow: 0, backgroundFit: "contain", audioSource: "foreground" },
    })
    expect(mocks.completeFfmpegVideoJob).toHaveBeenCalledWith("/tmp/mc/output.mp4", ctx, { width: 640, height: 360, durationSec: 3 })
  })

  it("refuses a missing input as a deterministic failure", async () => {
    await expect(videoMaskHandlers["mask-composite"]!(job({ foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4" }), ctx)).rejects.toThrow(/needs a foreground video, a background video and a mask video/)
    expect(mocks.maskComposite).not.toHaveBeenCalled()
  })
})
