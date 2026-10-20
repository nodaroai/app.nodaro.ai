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
  splitMaskSource: vi.fn(async (_p: string, _w: string, _g: unknown, chunks: Array<{ index: number }>) => chunks.map((c) => `/tmp/vm/chunk-${c.index}.mp4`)),
  runSam3Video: vi.fn(),
  maskComposite: vi.fn(async () => ({ outputPath: "/tmp/mc/output.mp4", width: 640, height: 360, durationSec: 3 })),
  uploadFileToR2: vi.fn(async (_p: string, id: string) => `https://r2/videos/${id}.mp4`),
  listObjectsByPrefixWithMeta: vi.fn(async (): Promise<Array<{ key: string }>> => []),
  readR2ObjectBuffer: vi.fn(async (_key: string): Promise<Buffer | null> => null),
  uploadJobScratchFile: vi.fn(async (_p: string, name: string) => `https://r2/tmp/${name}.mp4`),
  uploadJobScratchBuffer: vi.fn(async () => "https://r2/tmp/cache.gz"),
  createWorkDir: vi.fn(async () => "/tmp/vm"),
  cleanupWorkDir: vi.fn(async () => {}),
  markJobCompleted: vi.fn(async () => true),
  commitJobCredits: vi.fn(async () => {}),
  generateAndUploadThumbnail: vi.fn(async () => "https://r2/thumb.webp"),
  setJobProgress: vi.fn(async () => {}),
  shouldSaveJobResult: vi.fn(async () => true),
  completeFfmpegVideoJob: vi.fn(async () => {}),
}))

vi.mock("@/providers/video/video-mask.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/video-mask.js")>()),
  prepareVideoMaskSource: mocks.prepareVideoMaskSource,
  renderMaskVideo: mocks.renderMaskVideo,
  splitMaskSource: mocks.splitMaskSource,
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

import { gzipSync } from "node:zlib"
import { videoMaskHandlers } from "../video-mask.js"

const ctx = { jobId: "00000000-0000-4000-8000-0000000000aa", jobUserId: "user1", usageLogId: "ul1", shouldWatermark: true }
const job = (data: Record<string, unknown>) => ({ data: { jobId: ctx.jobId, ...data }, updateProgress: vi.fn() }) as never
const geometry = { width: 640, height: 360, frameRate: "30/1", durationSec: 3 }
const answer = (frames: number, cost = 0.03) => ({ rle: Array(frames).fill("1 10"), requestId: "r", cost })
const run = (data: Record<string, unknown>) => videoMaskHandlers["video-mask"]!(job({ videoUrl: "https://x/clip.mp4", prompt: "the dog", ...data }), ctx)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runSam3Video.mockImplementation(async (p: { frameCount: number }) => answer(p.frameCount))
  mocks.listObjectsByPrefixWithMeta.mockResolvedValue([])
  mocks.readR2ObjectBuffer.mockResolvedValue(null)
})

describe("video-mask handler — one request", () => {
  it("sends a plain clip as it is on SAM 3.1 (the default), uploads the mask unwatermarked, completes and commits", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 90, geometry })
    await run({ threshold: 0.4 })
    expect(mocks.splitMaskSource).not.toHaveBeenCalled()
    expect(mocks.runSam3Video).toHaveBeenCalledWith({ model: "sam-3.1", videoUrl: "https://x/clip.mp4", prompt: "the dog", threshold: 0.4, frameCount: 90 })
    expect(mocks.uploadFileToR2).toHaveBeenCalledTimes(1)
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith("/tmp/vm/mask.mp4", ctx.jobId, "video", "user1")
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, {
      output_data: { videoUrl: `https://r2/videos/${ctx.jobId}.mp4`, thumbnailUrl: "https://r2/thumb.webp", width: 640, height: 360, frames: 90, chunks: 1, coverage: 0.25 },
      provider: "sam-3.1",
      provider_cost: 0.03,
    })
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("ul1", ctx.jobId)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/vm")
  })

  it("runs SAM 3 when the node asks for it", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 90, geometry })
    await run({ provider: "sam-3" })
    expect(mocks.runSam3Video).toHaveBeenCalledWith(expect.objectContaining({ model: "sam-3" }))
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ provider: "sam-3" }))
  })

  it("sends a re-encoded source through the job's scratch folder and keeps the answer (gzipped) for a retry", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ normalisedPath: "/tmp/vm/normalised.mp4", localPath: "/tmp/vm/normalised.mp4", frameCount: 90, geometry })
    await run({})
    expect(mocks.uploadJobScratchFile).toHaveBeenCalledWith("/tmp/vm/normalised.mp4", "mask-src-c0", "mp4", "video/mp4", ctx.jobId)
    expect(mocks.runSam3Video).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "https://r2/tmp/mask-src-c0.mp4" }))
    const [, name, ext, , jobId] = mocks.uploadJobScratchBuffer.mock.calls[0] as unknown as [Buffer, string, string, string, string]
    expect([name, ext, jobId]).toEqual(["sam3-rle-c0", "gz", ctx.jobId])
  })

  it("refuses a frame count far from the clip's, before drawing anything, and still cleans up", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 90, geometry })
    mocks.runSam3Video.mockResolvedValue(answer(40))
    await expect(run({})).rejects.toThrow(/40 frame masks/)
    expect(mocks.renderMaskVideo).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/vm")
  })

  it("does not complete a job cancelled mid-flight", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 90, geometry })
    mocks.shouldSaveJobResult.mockResolvedValueOnce(false)
    await run({})
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
  })
})

describe("video-mask handler — a long clip in chunks", () => {
  const long = { width: 1920, height: 1080, frameRate: "30/1", durationSec: 133.3 }
  const prepared = { localPath: "/tmp/vm/source.mp4", frameCount: 4000, geometry: long }
  const cacheBody = (index: number, startFrame: number, frames: number, over: Record<string, unknown> = {}) =>
    gzipSync(JSON.stringify({ model: "sam-3.1", geometry: long, chunk: { index, startFrame, frames }, rle: Array(frames).fill("1 1"), cost: 0.1, ...over }))

  it("cuts 4,000 frames into 1,800 / 1,800 / 400, segments each, joins them in order and sums the cost", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    let inFlight = 0, peak = 0
    mocks.runSam3Video.mockImplementation(async (p: { frameCount: number; videoUrl: string }) => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { rle: Array(p.frameCount).fill(p.videoUrl), requestId: "r", cost: p.frameCount / 1000 }
    })
    await run({})
    expect(mocks.splitMaskSource).toHaveBeenCalledWith("/tmp/vm/source.mp4", "/tmp/vm", long, [
      { index: 0, startFrame: 0, frames: 1800 }, { index: 1, startFrame: 1800, frames: 1800 }, { index: 2, startFrame: 3600, frames: 400 },
    ])
    expect(mocks.runSam3Video.mock.calls.map((c) => (c[0] as { frameCount: number }).frameCount)).toEqual([1800, 1800, 400])
    expect(mocks.uploadJobScratchFile.mock.calls.map((c) => c[1])).toEqual(["mask-src-c0", "mask-src-c1", "mask-src-c2"])
    // Joined frame for frame, chunk order kept.
    const rle = (mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]
    expect(rle).toHaveLength(4000)
    expect([rle[0], rle[1799], rle[1800], rle[3599], rle[3600]]).toEqual([
      "https://r2/tmp/mask-src-c0.mp4", "https://r2/tmp/mask-src-c0.mp4", "https://r2/tmp/mask-src-c1.mp4", "https://r2/tmp/mask-src-c1.mp4", "https://r2/tmp/mask-src-c2.mp4",
    ])
    expect(peak).toBeLessThanOrEqual(3)
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({
      output_data: expect.objectContaining({ frames: 4000, chunks: 3 }),
      provider_cost: 4,
    }))
  })

  it("a retry draws the chunks an earlier attempt paid for and segments only the rest", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    const prefix = `tmp/provider-input/${ctx.jobId}/`
    mocks.listObjectsByPrefixWithMeta.mockResolvedValue([{ key: `${prefix}sam3-rle-c0-aa.gz` }, { key: `${prefix}sam3-rle-c1-bb.gz` }])
    mocks.readR2ObjectBuffer.mockImplementation(async (key: string) =>
      key.includes("-c0-") ? cacheBody(0, 0, 1800) : key.includes("-c1-") ? cacheBody(1, 1800, 1800) : null)
    await run({})
    expect(mocks.runSam3Video).toHaveBeenCalledTimes(1)
    expect(mocks.runSam3Video).toHaveBeenCalledWith(expect.objectContaining({ frameCount: 400, videoUrl: "https://r2/tmp/mask-src-c2.mp4" }))
    expect((mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]).toHaveLength(4000)
  })

  it("ignores a kept chunk from another model or another plan", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    const prefix = `tmp/provider-input/${ctx.jobId}/`
    mocks.listObjectsByPrefixWithMeta.mockResolvedValue([{ key: `${prefix}sam3-rle-c0-aa.gz` }, { key: `${prefix}sam3-rle-c1-bb.gz` }])
    mocks.readR2ObjectBuffer.mockImplementation(async (key: string) =>
      key.includes("-c0-") ? cacheBody(0, 0, 1800, { model: "sam-3" }) : cacheBody(1, 1800, 900))
    await run({})
    expect(mocks.runSam3Video).toHaveBeenCalledTimes(3)
  })

  it("refuses a chunk whose frame count is far from its plan (deterministic), without drawing", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.runSam3Video.mockImplementation(async (p: { frameCount: number }) => answer(p.frameCount === 400 ? 200 : p.frameCount))
    await expect(run({})).rejects.toThrow(expect.objectContaining({ deterministic: true }))
    expect(mocks.renderMaskVideo).not.toHaveBeenCalled()
  })
})

describe("mask-composite handler", () => {
  it("renders with the job's opacity", async () => {
    await videoMaskHandlers["mask-composite"]!(job({ foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4", opacity: 0.85 }), ctx)
    expect(mocks.maskComposite).toHaveBeenLastCalledWith(expect.objectContaining({ settings: expect.objectContaining({ opacity: 0.85 }) }))
  })

  it("normalises the settings and finishes through the shared ffmpeg completion", async () => {
    await videoMaskHandlers["mask-composite"]!(job({ foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4", feather: 99, backgroundFit: "contain" }), ctx)
    expect(mocks.maskComposite).toHaveBeenCalledWith({
      foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4",
      settings: { invertMask: false, feather: 20, grow: 0, opacity: 1, backgroundFit: "contain", audioSource: "foreground" },
    })
    expect(mocks.completeFfmpegVideoJob).toHaveBeenCalledWith("/tmp/mc/output.mp4", ctx, { width: 640, height: 360, durationSec: 3 })
  })

  it("refuses a missing input as a deterministic failure", async () => {
    await expect(videoMaskHandlers["mask-composite"]!(job({ foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4" }), ctx)).rejects.toThrow(/needs a foreground video, a background video and a mask video/)
    expect(mocks.maskComposite).not.toHaveBeenCalled()
  })
})
