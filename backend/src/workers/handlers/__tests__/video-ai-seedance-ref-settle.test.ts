import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A Seedance 2 run with a reference video is RESERVED at a worst case: the
 * provider may read the prompt as an edit of that clip and render the clip's
 * own length instead of the requested duration (`runVideoTaskWithSeedanceEditRetry`),
 * and `commit_credits` can only refund. The two video handlers must therefore
 * measure what was delivered — from the RAW provider output, before any
 * post-process — and hand it to finalize as `meteredBaseCredits`, which is what
 * turns the worst-case reservation into the exact charge.
 *
 * The measurement itself (`measureSeedance2RefVideoBaseCredits`) is tested in
 * `lib/__tests__/seedance2-ref-video-settle.test.ts` and the maths next to the
 * ee helper; this pins the PLUMBING: called with the run's own inputs
 * (including the reservation's probe of the reference clips, carried on the
 * queue payload), its answer reaches finalize untouched, and its absence
 * changes nothing.
 */

const mocks = vi.hoisted(() => ({
  mockImageToVideo: vi.fn(),
  mockTextToVideo: vi.fn(),
  mockMeasure: vi.fn(),
  mockFinalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }),
  mockUploadVideoMaybeWatermark: vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4"),
  mockGenerateAndUploadThumbnail: vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/job-1.png"),
  mockSetJobProgress: vi.fn(async () => {}),
  mockApplySmartLoopCut: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) },
}))

vi.mock("@/lib/storage.js", () => ({
  uploadToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/raw.mp4"),
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.example.com/buffer.mp4"),
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: mocks.mockTextToVideo,
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
}))

vi.mock("@/providers/video/apply-smart-loop-cut.js", () => ({
  applySmartLoopCutToR2Url: mocks.mockApplySmartLoopCut,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/workdir"),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  stripAudio: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia,
}))

vi.mock("../../../lib/seedance2-ref-video-settle.js", () => ({
  measureSeedance2RefVideoBaseCredits: mocks.mockMeasure,
}))

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: vi.fn().mockResolvedValue(undefined),
    shouldSaveJobResult: vi.fn().mockResolvedValue(true),
    markJobCompleted: vi.fn().mockResolvedValue(true),
    uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
    watermarkLocalVideoAndUpload: vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1-merged.mp4"),
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: mocks.mockSetJobProgress,
    refundLoopTrimAddon: vi.fn().mockResolvedValue(undefined),
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

import { videoAIHandlers } from "../video-ai.js"

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: false }

const RAW_URL = "https://kie.example/out.mp4"
const REFS = ["https://r2.example.com/videos/ref.mp4"]
const RESULT = { url: RAW_URL, providerUsed: "seedance-2-5", cost: 1.25, displayCost: 1.5625 }

const finalizeArg = () => mocks.mockFinalizeJobWithMedia.mock.calls[0]![0] as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockImageToVideo.mockResolvedValue(RESULT)
  mocks.mockTextToVideo.mockResolvedValue(RESULT)
  mocks.mockMeasure.mockResolvedValue(undefined)
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
})

describe("image-to-video handler — Seedance reference-video settlement", () => {
  const handler = videoAIHandlers["image-to-video"]

  it("measures the RAW provider output with the run's own provider / resolution / reference clips / reservation probe, and finalize gets the answer", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(7193)
    await handler(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "1080p", duration: 12,
        referenceVideoUrls: REFS, refVideoDurationsSec: [30],
      }) as never,
      ctx as never,
    )
    expect(mocks.mockMeasure).toHaveBeenCalledWith({
      provider: "seedance-2-5", resolution: "1080p", outputUrl: RAW_URL, referenceVideoUrls: REFS, refVideoDurationsSec: [30], duration: 12,
    })
    expect(finalizeArg().meteredBaseCredits).toBe(7193)
  })

  it("measures BEFORE the smart-loop-cut shortens the kept clip — the provider billed the raw length", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(7193)
    mocks.mockApplySmartLoopCut.mockResolvedValueOnce("https://r2.example.com/trimmed.mp4")
    await handler(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "720p", duration: 8, referenceVideoUrls: REFS,
        loopTrim: { enabled: true, framesToTest: 16, quality: "precise" },
      }) as never,
      ctx as never,
    )
    expect(mocks.mockMeasure).toHaveBeenCalledWith(expect.objectContaining({ outputUrl: RAW_URL }))
    expect(mocks.mockMeasure.mock.invocationCallOrder[0]).toBeLessThan(mocks.mockApplySmartLoopCut.mock.invocationCallOrder[0]!)
    expect(finalizeArg().meteredBaseCredits).toBe(7193)
    // The retained add-on still rides separately; finalize adds it on top.
    expect(finalizeArg().extraNonProviderCredits).toBe(30)
  })

  it("no measurement (not a Seedance ref run, or unmeasurable) → finalize commits the reservation as before", async () => {
    await handler(makeJob("image-to-video", { imageUrl: "https://x.png", provider: "veo3.1", duration: 8 }) as never, ctx as never)
    expect(mocks.mockMeasure).toHaveBeenCalledWith({
      provider: "veo3.1", resolution: undefined, outputUrl: RAW_URL, referenceVideoUrls: undefined, refVideoDurationsSec: undefined, duration: 8,
    })
    expect(finalizeArg().meteredBaseCredits).toBeUndefined()
  })
})

describe("text-to-video handler — Seedance reference-video settlement", () => {
  const handler = videoAIHandlers["text-to-video"]

  it("measures the RAW provider output and finalize gets the answer", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(3990)
    await handler(
      makeJob("text-to-video", {
        prompt: "make it black and white", provider: "seedance-2-5", resolution: "720p", duration: 12,
        referenceVideoUrls: REFS, refVideoDurationsSec: [30],
      }) as never,
      ctx as never,
    )
    expect(mocks.mockMeasure).toHaveBeenCalledWith({
      provider: "seedance-2-5", resolution: "720p", outputUrl: RAW_URL, referenceVideoUrls: REFS, refVideoDurationsSec: [30], duration: 12,
    })
    expect(finalizeArg().meteredBaseCredits).toBe(3990)
  })

  it("no measurement → finalize commits the reservation as before", async () => {
    await handler(makeJob("text-to-video", { prompt: "a sunset", provider: "minimax", duration: 5 }) as never, ctx as never)
    expect(finalizeArg().meteredBaseCredits).toBeUndefined()
  })
})
