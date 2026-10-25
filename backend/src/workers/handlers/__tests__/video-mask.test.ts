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
  detectCutFrames: vi.fn(async (): Promise<number[]> => []),
}))

vi.mock("@/providers/video/video-mask.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/video-mask.js")>()),
  prepareVideoMaskSource: mocks.prepareVideoMaskSource,
  renderMaskVideo: mocks.renderMaskVideo,
  splitMaskSource: mocks.splitMaskSource,
}))
vi.mock("@/services/scene-cut-frames.js", () => ({ detectCutFrames: mocks.detectCutFrames }))
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
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  // parseFrameRate is pure (the hold limit reads the clip's rate); the work dir is the test's.
  parseFrameRate: (await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()).parseFrameRate,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))
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
  mocks.detectCutFrames.mockResolvedValue([])
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
      output_data: { videoUrl: `https://r2/videos/${ctx.jobId}.mp4`, thumbnailUrl: "https://r2/thumb.webp", width: 640, height: 360, frames: 90, chunks: 1, shots: 1, coverage: 0.25, kept: true },
      provider: "sam-3.1",
      provider_cost: 0.03,
    })
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("ul1", ctx.jobId)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/vm")
    // perShot off (the default): no cut scan at all.
    expect(mocks.detectCutFrames).not.toHaveBeenCalled()
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

  it("holdLastMask off (the default): the model's frames are drawn as they are, and the output has no heldFrames", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 4, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: ["1 10", "1 900", "", ""], requestId: "r", cost: 0.03 })
    await run({})
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(["1 10", "1 900", "", ""], geometry, "/tmp/vm/mask.mp4")
    expect((mocks.markJobCompleted.mock.calls[0] as unknown as [string, { output_data: object }])[1].output_data).not.toHaveProperty("heldFrames")
  })

  it("holdLastMask on: empty frames after the first detection are drawn from the last non-empty one, and counted", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 5, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: ["", "1 900", "", "1 800", ""], requestId: "r", cost: 0.03 })
    await run({ holdLastMask: true })
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(["", "1 900", "1 900", "1 800", "1 800"], geometry, "/tmp/vm/mask.mp4")
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ frames: 5, heldFrames: 2 }) }))
    // What a retry reuses is the model's answer, not the held one.
    const cached = JSON.parse((await import("node:zlib")).gunzipSync((mocks.uploadJobScratchBuffer.mock.calls[0] as unknown as [Buffer])[0]).toString()) as { rle: string[] }
    expect(cached.rle).toEqual(["", "1 900", "", "1 800", ""])
  })

  it("holdLastMask on: a mask is held for at most HOLD_MAX_SEC of frames at the clip's rate, then the frames stay empty", async () => {
    // 10 fps: one second is 10 frames. One detection, then 14 empty frames.
    const tenFps = { ...geometry, frameRate: "10/1", durationSec: 1.5 }
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 15, geometry: tenFps })
    mocks.runSam3Video.mockResolvedValue({ rle: ["1 900", ...Array(14).fill("")], requestId: "r", cost: 0.03 })
    await run({ holdLastMask: true })
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(["1 900", ...Array(10).fill("1 900"), ...Array(4).fill("")], tenFps, "/tmp/vm/mask.mp4")
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ heldFrames: 10 }) }))
  })

  it("minSubjectHeightPct 0 (the default): no size filter, no droppedRegions", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 2, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: ["1 900", "1 900"], requestId: "r", cost: 0.03 })
    await run({ minSubjectHeightPct: 0 })
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(["1 900", "1 900"], geometry, "/tmp/vm/mask.mp4")
    expect((mocks.markJobCompleted.mock.calls[0] as unknown as [string, { output_data: object }])[1].output_data).not.toHaveProperty("droppedRegions")
  })

  it("minSubjectHeightPct > 0 drops the small regions first, then holds", async () => {
    // 640×360: 20 % = 72 rows. A 100-row region (x 10–29) and a 10-row one (x 400–419).
    const rows = (x: number, y: number, h: number) => Array.from({ length: h }, (_, i) => `${(y + i) * 640 + x + 1} 20`).join(" ")
    const big = rows(10, 0, 100), small = rows(400, 0, 10)
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 3, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: [`${big} ${small}`, small, ""], requestId: "r", cost: 0.03 })
    await run({ minSubjectHeightPct: 20, holdLastMask: true })
    const drawn = (mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]
    expect(drawn).toEqual([big, big, big])
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ frames: 3, droppedRegions: 2, heldFrames: 2 }) }))
  })

  it("maxSubjectHeightPct keeps only the small regions; both cuts keep a band; both 0 leave the frames as they are", async () => {
    const rows = (x: number, y: number, h: number) => Array.from({ length: h }, (_, i) => `${(y + i) * 640 + x + 1} 20`).join(" ")
    const big = rows(10, 0, 100), small = rows(400, 0, 10)
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 1, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: [`${big} ${small}`], requestId: "r", cost: 0.03 })
    await run({ maxSubjectHeightPct: 20 }) // 72 rows
    expect((mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]).toEqual([small])
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ droppedRegions: 1 }) }))
    vi.clearAllMocks()
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 1, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: [`${big} ${small}`], requestId: "r", cost: 0.03 })
    await run({ minSubjectHeightPct: 0, maxSubjectHeightPct: 0 })
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith([`${big} ${small}`], geometry, "/tmp/vm/mask.mp4")
    expect((mocks.markJobCompleted.mock.calls[0] as unknown as [string, { output_data: object }])[1].output_data).not.toHaveProperty("droppedRegions")
  })

  it("delivers an empty mask (completed and charged) when no region on any frame reaches the cut", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 2, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: ["1 20", "1 20"], requestId: "r", cost: 0.03 })
    mocks.renderMaskVideo.mockResolvedValueOnce({ coveredFraction: 0 })
    await run({ minSubjectHeightPct: 50 })
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(["", ""], geometry, "/tmp/vm/mask.mp4", { allowEmpty: true })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ frames: 2, coverage: 0, kept: false, droppedRegions: 2 }) }))
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("ul1", ctx.jobId)
  })

  it("kept: true for a mask whose coverage rounds to 0 (a few pixels kept), so a caller never reads it off coverage", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 2, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: ["1 2", ""], requestId: "r", cost: 0.03 })
    mocks.renderMaskVideo.mockResolvedValueOnce({ coveredFraction: 0.000004 })
    await run({})
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ coverage: 0, kept: true }) }))
  })

  it("still refuses a run where the model itself matched nothing, with the size filter on", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 2, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: ["", ""], requestId: "r", cost: 0.03 })
    await run({ minSubjectHeightPct: 50 }).catch(() => {})
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(["", ""], geometry, "/tmp/vm/mask.mp4")
  })

  it("zone: drops the regions centred outside the inner rectangle after the size filter and before the hold; droppedRegions sums both", async () => {
    // 640×360. Side margins of 10 % = 64 px. Regions (x, height): edge face x 10–29 (centre 20, outside), centred face
    // x 300–319 (centre 310, inside), small face x 400–419 (10 rows: under the 20 % = 72-row cut).
    const rows = (x: number, y: number, h: number) => Array.from({ length: h }, (_, i) => `${(y + i) * 640 + x + 1} 20`).join(" ")
    const edge = rows(10, 0, 100), centred = rows(300, 0, 100), small = rows(400, 0, 10)
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 3, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: [`${edge} ${centred} ${small}`, `${edge} ${small}`, ""], requestId: "r", cost: 0.03 })
    await run({ minSubjectHeightPct: 20, zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 }, holdLastMask: true })
    const drawn = (mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]
    expect(drawn).toEqual([centred, centred, centred])
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(drawn, geometry, "/tmp/vm/mask.mp4")
    // Size: 2 small; zone: 2 edge faces.
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ frames: 3, droppedRegions: 4, heldFrames: 2 }) }))
    // What a retry reuses is the model's answer.
    const cached = JSON.parse((await import("node:zlib")).gunzipSync((mocks.uploadJobScratchBuffer.mock.calls[0] as unknown as [Buffer])[0]).toString()) as { rle: string[] }
    expect(cached.rle).toEqual([`${edge} ${centred} ${small}`, `${edge} ${small}`, ""])
  })

  it("zone alone works without the size filter; a null or all-zero zone is off (no droppedRegions)", async () => {
    const rows = (x: number, y: number, h: number) => Array.from({ length: h }, (_, i) => `${(y + i) * 640 + x + 1} 20`).join(" ")
    const edge = rows(10, 0, 100), centred = rows(300, 0, 100)
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 1, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: [`${edge} ${centred}`], requestId: "r", cost: 0.03 })
    await run({ zone: { leftPct: 10, rightPct: 0, topPct: 0, bottomPct: 0 } })
    expect((mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]).toEqual([centred])
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ droppedRegions: 1 }) }))
    for (const zone of [null, { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 }, undefined]) {
      vi.clearAllMocks()
      mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 1, geometry })
      mocks.runSam3Video.mockResolvedValue({ rle: [`${edge} ${centred}`], requestId: "r", cost: 0.03 })
      await run({ zone })
      expect(mocks.renderMaskVideo).toHaveBeenCalledWith([`${edge} ${centred}`], geometry, "/tmp/vm/mask.mp4")
      expect((mocks.markJobCompleted.mock.calls[0] as unknown as [string, { output_data: object }])[1].output_data).not.toHaveProperty("droppedRegions")
    }
  })

  it("delivers an empty mask (completed and charged) when the zone leaves no region on any frame", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 2, geometry })
    // A 20-px run at the top-left corner: centre (10, 0.5), outside a 10 % side margin.
    mocks.runSam3Video.mockResolvedValue({ rle: ["1 20", "1 20"], requestId: "r", cost: 0.03 })
    mocks.renderMaskVideo.mockResolvedValueOnce({ coveredFraction: 0 })
    await run({ zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } })
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(["", ""], geometry, "/tmp/vm/mask.mp4", { allowEmpty: true })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith(ctx.jobId, expect.objectContaining({ output_data: expect.objectContaining({ frames: 2, coverage: 0, droppedRegions: 2 }) }))
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("ul1", ctx.jobId)
  })

  it("still refuses a run where the model itself matched nothing, with the zone on", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue({ localPath: "/tmp/vm/source.mp4", frameCount: 2, geometry })
    mocks.runSam3Video.mockResolvedValue({ rle: ["", ""], requestId: "r", cost: 0.03 })
    await run({ zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } }).catch(() => {})
    expect(mocks.renderMaskVideo).toHaveBeenCalledWith(["", ""], geometry, "/tmp/vm/mask.mp4")
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

describe("video-mask handler — perShot", () => {
  const prepared = { localPath: "/tmp/vm/source.mp4", frameCount: 97, geometry }
  const prefix = `tmp/provider-input/${ctx.jobId}/`
  const outputOf = () => (mocks.markJobCompleted.mock.calls[0] as unknown as [string, { output_data: Record<string, unknown> }])[1].output_data

  it("runs SAM once per shot (each chunk one shot), joins them in order, and reports shots", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.detectCutFrames.mockResolvedValue([31])
    await run({ perShot: true })
    expect(mocks.detectCutFrames).toHaveBeenCalledWith("/tmp/vm/source.mp4", "30/1", expect.objectContaining({ timeoutMs: expect.any(Number) }))
    expect(mocks.splitMaskSource).toHaveBeenCalledWith("/tmp/vm/source.mp4", "/tmp/vm", geometry, [
      { index: 0, startFrame: 0, frames: 31 }, { index: 1, startFrame: 31, frames: 66 },
    ])
    expect(mocks.runSam3Video.mock.calls.map((c) => (c[0] as { frameCount: number; videoUrl: string }).frameCount)).toEqual([31, 66])
    expect(mocks.runSam3Video.mock.calls.map((c) => (c[0] as { videoUrl: string }).videoUrl)).toEqual(["https://r2/tmp/mask-src-c0.mp4", "https://r2/tmp/mask-src-c1.mp4"])
    expect((mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]).toHaveLength(97)
    expect(outputOf()).toMatchObject({ frames: 97, chunks: 2, shots: 2 })
  })

  it("holds per shot: a shot that opens on empty frames does not inherit the previous shot's mask", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.detectCutFrames.mockResolvedValue([31])
    // Shot 1 (31 frames): the face, lost on its last 5 frames. Shot 2 (66): nothing for 10 frames, then a new face, then lost.
    const shot1 = [...Array(26).fill("1 900"), ...Array(5).fill("")]
    const shot2 = [...Array(10).fill(""), ...Array(40).fill("1 800"), ...Array(16).fill("")]
    mocks.runSam3Video.mockImplementation(async (p: { frameCount: number }) => ({ rle: p.frameCount === 31 ? [...shot1] : [...shot2], requestId: "r", cost: 0.03 }))
    await run({ perShot: true, holdLastMask: true })
    const drawn = (mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]
    expect(drawn.slice(0, 31)).toEqual(Array(31).fill("1 900"))
    expect(drawn.slice(31, 41)).toEqual(Array(10).fill(""))
    expect(drawn.slice(41)).toEqual(Array(56).fill("1 800"))
    expect(outputOf()).toMatchObject({ shots: 2, heldFrames: 5 + 16 })
  })

  it("a clip with no cut: one SAM call on the clip as it is, shots 1 — and, when the answer already has the clip's frame count, the same mask as the single pass", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.runSam3Video.mockImplementation(async (p: { frameCount: number }) => ({ rle: Array.from({ length: p.frameCount }, (_, i) => (i % 3 ? "1 10" : "")), requestId: "r", cost: 0.03 }))
    await run({ holdLastMask: true })
    const single = (mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]
    const singleOut = outputOf()
    vi.clearAllMocks()
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    await run({ holdLastMask: true, perShot: true })
    expect(mocks.detectCutFrames).toHaveBeenCalledTimes(1)
    expect(mocks.splitMaskSource).not.toHaveBeenCalled()
    expect(mocks.runSam3Video).toHaveBeenCalledTimes(1)
    expect(mocks.runSam3Video).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: "https://x/clip.mp4", frameCount: 97 }))
    expect((mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]).toEqual(single)
    expect(outputOf()).toEqual(singleOut)
    expect(outputOf()).toMatchObject({ chunks: 1, shots: 1 })
  })

  it("a short answer in one shot never shifts the next: each shot's masks are fitted to its planned frames", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.detectCutFrames.mockResolvedValue([31])
    // Shot 1 comes back two frames short (29 of 31, inside the tolerance); shot 2 is exact.
    mocks.runSam3Video.mockImplementation(async (p: { frameCount: number }) => ({
      rle: p.frameCount === 31 ? Array.from({ length: 29 }, (_, i) => `s1-${i}`) : Array.from({ length: 66 }, (_, i) => `s2-${i}`),
      requestId: "r", cost: 0.03,
    }))
    // The fixture strings are not RLE: no region filter or hold reads them, and the encode is mocked.
    await run({ perShot: true })
    const drawn = (mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]
    expect(drawn).toHaveLength(97)
    // Shot 1's last answer repeats over its two missing frames…
    expect(drawn.slice(28, 31)).toEqual(["s1-28", "s1-28", "s1-28"])
    // …and shot 2's first mask lands exactly on the cut frame.
    expect(drawn[31]).toBe("s2-0")
    expect(drawn[96]).toBe("s2-65")
    // The retry cache keeps the model's own answer.
    const stored = JSON.parse((await import("node:zlib")).gunzipSync((mocks.uploadJobScratchBuffer.mock.calls[0] as unknown as [Buffer])[0]).toString()) as { rle: string[]; chunk: { frames: number } }
    expect(stored.rle).toHaveLength(stored.chunk.frames === 31 ? 29 : 66)
  })

  it("drops a cut that would make a shot shorter than 8 frames before planning (the earlier cut is kept)", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.detectCutFrames.mockResolvedValue([31, 35, 92])
    await run({ perShot: true })
    expect(mocks.splitMaskSource).toHaveBeenCalledWith("/tmp/vm/source.mp4", "/tmp/vm", geometry, [
      { index: 0, startFrame: 0, frames: 31 }, { index: 1, startFrame: 31, frames: 66 },
    ])
    expect(outputOf()).toMatchObject({ chunks: 2, shots: 2 })
  })

  it("without perShot a short answer is joined as today (no fitting)", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.runSam3Video.mockImplementation(async () => ({ rle: Array.from({ length: 95 }, (_, i) => `f${i}`), requestId: "r", cost: 0.03 }))
    await run({})
    expect((mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]).toHaveLength(95)
  })

  it("perShot false: no cut scan, one SAM call, shots 1", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.detectCutFrames.mockResolvedValue([31])
    await run({ perShot: false })
    expect(mocks.detectCutFrames).not.toHaveBeenCalled()
    expect(mocks.runSam3Video).toHaveBeenCalledTimes(1)
    expect(outputOf()).toMatchObject({ chunks: 1, shots: 1 })
  })

  describe("the retry cache never mixes perShot and single-pass answers", () => {
    const long = { width: 1920, height: 1080, frameRate: "30/1", durationSec: 133.3 }
    const longPrepared = { localPath: "/tmp/vm/source.mp4", frameCount: 4000, geometry: long }
    const body = (index: number, startFrame: number, frames: number, over: Record<string, unknown> = {}) =>
      gzipSync(JSON.stringify({ model: "sam-3.1", geometry: long, chunk: { index, startFrame, frames }, rle: Array(frames).fill("1 1"), cost: 0.1, ...over }))
    // A cut at 1800 gives the perShot plan the very same chunk ranges as the single pass.
    const kept = (over: Record<string, unknown>) => {
      mocks.listObjectsByPrefixWithMeta.mockResolvedValue([{ key: `${prefix}sam3-rle-c0-aa.gz` }, { key: `${prefix}sam3-rle-c1-bb.gz` }])
      mocks.readR2ObjectBuffer.mockImplementation(async (key: string) =>
        key.includes("-c0-") ? body(0, 0, 1800, over) : key.includes("-c1-") ? body(1, 1800, 1800, over) : null)
    }

    it("a perShot job ignores chunks a single-pass attempt kept (no perShot mark), even on the same ranges", async () => {
      mocks.prepareVideoMaskSource.mockResolvedValue(longPrepared)
      mocks.detectCutFrames.mockResolvedValue([1800])
      kept({})
      await run({ perShot: true })
      expect(mocks.runSam3Video).toHaveBeenCalledTimes(3)
    })

    it("a single-pass job ignores chunks a perShot attempt kept", async () => {
      mocks.prepareVideoMaskSource.mockResolvedValue(longPrepared)
      kept({ perShot: true })
      await run({})
      expect(mocks.runSam3Video).toHaveBeenCalledTimes(3)
    })

    it("a perShot retry draws its own kept chunks, and marks what it keeps", async () => {
      mocks.prepareVideoMaskSource.mockResolvedValue(longPrepared)
      mocks.detectCutFrames.mockResolvedValue([1800])
      kept({ perShot: true })
      await run({ perShot: true })
      expect(mocks.runSam3Video).toHaveBeenCalledTimes(1)
      const stored = JSON.parse((await import("node:zlib")).gunzipSync((mocks.uploadJobScratchBuffer.mock.calls[0] as unknown as [Buffer])[0]).toString()) as { perShot: boolean; chunk: { index: number } }
      expect(stored).toMatchObject({ perShot: true, chunk: { index: 2 } })
    })

    it("of two kept answers for one chunk, the one matching this plan is drawn (a stale one listed first is skipped)", async () => {
      mocks.prepareVideoMaskSource.mockResolvedValue(longPrepared)
      mocks.detectCutFrames.mockResolvedValue([1800])
      mocks.listObjectsByPrefixWithMeta.mockResolvedValue([
        { key: `${prefix}sam3-rle-c0-old.gz` }, { key: `${prefix}sam3-rle-c0-new.gz` }, { key: `${prefix}sam3-rle-c1-bb.gz` },
      ])
      mocks.readR2ObjectBuffer.mockImplementation(async (key: string) =>
        key.includes("-c0-old") ? body(0, 0, 1500, { perShot: true }) : key.includes("-c0-new") ? body(0, 0, 1800, { perShot: true }) : key.includes("-c1-") ? body(1, 1800, 1800, { perShot: true }) : null)
      await run({ perShot: true })
      expect(mocks.runSam3Video).toHaveBeenCalledTimes(1)
      expect(mocks.runSam3Video).toHaveBeenCalledWith(expect.objectContaining({ frameCount: 400 }))
    })
  })
})

describe("video-mask handler — redetectEverySec", () => {
  const prepared = { localPath: "/tmp/vm/source.mp4", frameCount: 97, geometry }
  const prefix = `tmp/provider-input/${ctx.jobId}/`
  const outputOf = () => (mocks.markJobCompleted.mock.calls[0] as unknown as [string, { output_data: Record<string, unknown> }])[1].output_data
  const framesSent = () => mocks.runSam3Video.mock.calls.map((c) => (c[0] as { frameCount: number }).frameCount)
  const drawn = () => (mocks.renderMaskVideo.mock.calls[0] as unknown as [string[]])[0]

  it("off (0, absent or junk): the plan of today — one SAM call on the clip as it is", async () => {
    for (const redetectEverySec of [undefined, 0, -3, "2"]) {
      vi.clearAllMocks()
      mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
      mocks.runSam3Video.mockImplementation(async (p: { frameCount: number }) => answer(p.frameCount))
      await run(redetectEverySec === undefined ? {} : { redetectEverySec })
      expect(mocks.splitMaskSource).not.toHaveBeenCalled()
      expect(framesSent()).toEqual([97])
      expect(outputOf()).toMatchObject({ chunks: 1, shots: 1 })
    }
  })

  it("on without perShot: no cut scan; the clip is sent in pieces of that many seconds from its start (a tail under 8 frames joins the last)", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    await run({ redetectEverySec: 1 })
    expect(mocks.detectCutFrames).not.toHaveBeenCalled()
    // 97 frames at 30 fps: 30, 30, then 30 + the 7-frame tail.
    expect(mocks.splitMaskSource).toHaveBeenCalledWith("/tmp/vm/source.mp4", "/tmp/vm", geometry, [
      { index: 0, startFrame: 0, frames: 30 }, { index: 1, startFrame: 30, frames: 30 }, { index: 2, startFrame: 60, frames: 37 },
    ])
    expect(framesSent()).toEqual([30, 30, 37])
    expect(drawn()).toHaveLength(97)
    expect(outputOf()).toMatchObject({ frames: 97, chunks: 3, shots: 1 })
  })

  it("reads the piece length off the clip's own frame rate (24000/1001 at 2 s = 48 frames)", async () => {
    const g = { ...geometry, frameRate: "24000/1001" }
    mocks.prepareVideoMaskSource.mockResolvedValue({ ...prepared, geometry: g })
    await run({ redetectEverySec: 2 })
    expect(framesSent()).toEqual([48, 49])
  })

  it("a held mask keeps going across a re-detection boundary (not a cut)", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    // Chunk 0 (frames 0–29): the face, lost on its last 5 frames; chunk 1 (30–59) opens on 10 empty frames.
    mocks.runSam3Video.mockImplementation(async (p: { frameCount: number; videoUrl: string }) => ({
      rle: p.videoUrl.endsWith("c0.mp4") ? [...Array(25).fill("1 900"), ...Array(5).fill("")]
        : p.videoUrl.endsWith("c1.mp4") ? [...Array(10).fill(""), ...Array(20).fill("1 800")]
          : Array(p.frameCount).fill("1 800"),
      requestId: "r", cost: 0.03,
    }))
    await run({ redetectEverySec: 1, holdLastMask: true })
    // 15 empty frames (25–39) at 30 fps — inside HOLD_MAX_SEC — all held from frame 24, across the boundary at 30.
    expect(drawn().slice(25, 40)).toEqual(Array(15).fill("1 900"))
    expect(outputOf()).toMatchObject({ heldFrames: 15, shots: 1 })
  })

  it("with perShot: every cut starts a chunk AND each shot is cut every N frames; the hold resets at the cut only", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.detectCutFrames.mockResolvedValue([50])
    // Shot 1 (0–49) = 30 + 20, shot 2 (50–96) = 30 + 17.
    const byChunk: Record<string, string[]> = {
      c0: [...Array(25).fill("1 900"), ...Array(5).fill("")],
      c1: Array(20).fill(""),
      c2: Array(30).fill(""),
      c3: Array(17).fill("1 800"),
    }
    mocks.runSam3Video.mockImplementation(async (p: { videoUrl: string }) => ({
      rle: [...byChunk[p.videoUrl.match(/-(c\d)\.mp4$/)![1]!]!], requestId: "r", cost: 0.03,
    }))
    await run({ perShot: true, redetectEverySec: 1, holdLastMask: true })
    expect(mocks.splitMaskSource).toHaveBeenCalledWith("/tmp/vm/source.mp4", "/tmp/vm", geometry, [
      { index: 0, startFrame: 0, frames: 30 }, { index: 1, startFrame: 30, frames: 20 },
      { index: 2, startFrame: 50, frames: 30 }, { index: 3, startFrame: 80, frames: 17 },
    ])
    const out = drawn()
    // Held over 25–49 (across the re-detection boundary at 30)…
    expect(out.slice(25, 50)).toEqual(Array(25).fill("1 900"))
    // …and never across the cut at 50.
    expect(out.slice(50, 80)).toEqual(Array(30).fill(""))
    expect(out.slice(80)).toEqual(Array(17).fill("1 800"))
    expect(outputOf()).toMatchObject({ chunks: 4, shots: 2, heldFrames: 25 })
  })

  it("each re-detection chunk is fitted to its planned frames, so a short answer never shifts the next chunk", async () => {
    mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
    mocks.runSam3Video.mockImplementation(async (p: { frameCount: number; videoUrl: string }) => {
      const c = p.videoUrl.match(/-(c\d)\.mp4$/)![1]!
      // Chunk 0 comes back two frames short (28 of 30, inside the tolerance).
      return { rle: Array.from({ length: c === "c0" ? 28 : p.frameCount }, (_, i) => `${c}-${i}`), requestId: "r", cost: 0.03 }
    })
    await run({ redetectEverySec: 1 })
    const out = drawn()
    expect(out).toHaveLength(97)
    expect(out.slice(27, 30)).toEqual(["c0-27", "c0-27", "c0-27"])
    expect(out[30]).toBe("c1-0")
    expect(out[60]).toBe("c2-0")
  })

  describe("the retry cache keys on redetectEverySec", () => {
    const body = (index: number, startFrame: number, frames: number, over: Record<string, unknown> = {}) =>
      gzipSync(JSON.stringify({ model: "sam-3.1", geometry, chunk: { index, startFrame, frames }, rle: Array(frames).fill("1 1"), cost: 0.1, ...over }))
    // The 1 s plan of 97 frames at 30 fps: 30 / 30 / 37.
    const kept = (over: Record<string, unknown>) => {
      mocks.listObjectsByPrefixWithMeta.mockResolvedValue([0, 1, 2].map((i) => ({ key: `${prefix}sam3-rle-c${i}-k.gz` })))
      mocks.readR2ObjectBuffer.mockImplementation(async (key: string) =>
        key.includes("-c0-") ? body(0, 0, 30, over) : key.includes("-c1-") ? body(1, 30, 30, over) : key.includes("-c2-") ? body(2, 60, 37, over) : null)
    }

    it("draws chunks kept by an attempt on the same re-detection, and marks what it keeps", async () => {
      mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
      kept({ redetectEverySec: 1 })
      await run({ redetectEverySec: 1 })
      expect(mocks.runSam3Video).not.toHaveBeenCalled()
      vi.clearAllMocks()
      mocks.runSam3Video.mockImplementation(async (p: { frameCount: number }) => answer(p.frameCount))
      mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
      mocks.listObjectsByPrefixWithMeta.mockResolvedValue([])
      await run({ redetectEverySec: 1 })
      const stored = JSON.parse((await import("node:zlib")).gunzipSync((mocks.uploadJobScratchBuffer.mock.calls[0] as unknown as [Buffer])[0]).toString()) as Record<string, unknown>
      expect(stored).toMatchObject({ redetectEverySec: 1 })
      expect(stored).not.toHaveProperty("perShot")
    })

    it("ignores chunks on the same ranges kept without re-detection, or with another interval", async () => {
      for (const over of [{}, { redetectEverySec: 2 }]) {
        vi.clearAllMocks()
        mocks.runSam3Video.mockImplementation(async (p: { frameCount: number }) => answer(p.frameCount))
        mocks.prepareVideoMaskSource.mockResolvedValue(prepared)
        kept(over)
        await run({ redetectEverySec: 1 })
        expect(mocks.runSam3Video).toHaveBeenCalledTimes(3)
      }
    })

    it("a job with re-detection off never marks or reads a re-detection answer", async () => {
      mocks.prepareVideoMaskSource.mockResolvedValue({ ...prepared, frameCount: 4000, geometry: { ...geometry, durationSec: 133.3 } })
      await run({})
      const stored = JSON.parse((await import("node:zlib")).gunzipSync((mocks.uploadJobScratchBuffer.mock.calls[0] as unknown as [Buffer])[0]).toString()) as Record<string, unknown>
      expect(stored).not.toHaveProperty("redetectEverySec")
    })
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
      settings: { invertMask: false, feather: 20, grow: 0, opacity: 1, fill: "video", pixelSizePct: 1.25, blurStrengthPct: 2, backgroundFit: "contain", audioSource: "foreground" },
    })
    expect(mocks.completeFfmpegVideoJob).toHaveBeenCalledWith("/tmp/mc/output.mp4", ctx, { width: 640, height: 360, durationSec: 3 })
  })

  it("refuses a missing input as a deterministic failure", async () => {
    await expect(videoMaskHandlers["mask-composite"]!(job({ foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4" }), ctx)).rejects.toThrow(/needs a foreground video, a background video and a mask video/)
    expect(mocks.maskComposite).not.toHaveBeenCalled()
  })

  it("pixelate / blur run without a foreground, and never pass one on", async () => {
    await videoMaskHandlers["mask-composite"]!(job({ backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4", fill: "pixelate", pixelSizePct: 3 }), ctx)
    expect(mocks.maskComposite).toHaveBeenLastCalledWith({
      backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4",
      settings: expect.objectContaining({ fill: "pixelate", pixelSizePct: 3 }),
    })
    await videoMaskHandlers["mask-composite"]!(job({ foregroundUrl: "https://x/fg.mp4", backgroundUrl: "https://x/bg.mp4", maskUrl: "https://x/m.mp4", fill: "blur" }), ctx)
    expect((mocks.maskComposite.mock.lastCall as unknown[] | undefined)?.[0]).not.toHaveProperty("foregroundUrl")
  })

  it("pixelate / blur still refuse a missing background or mask", async () => {
    await expect(videoMaskHandlers["mask-composite"]!(job({ maskUrl: "https://x/m.mp4", fill: "blur" }), ctx)).rejects.toThrow(/needs a background video and a mask video/)
    expect(mocks.maskComposite).not.toHaveBeenCalled()
  })
})
