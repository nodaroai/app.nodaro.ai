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
 * The measurement itself (`measureSeedance2Settle`) is tested in
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
  mockDraftMeasure: vi.fn(),
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

vi.mock("@/providers/video/merge-video-audio.js", () => ({
  mergeVideoAudio: vi.fn().mockResolvedValue("/tmp/merge/merged.mp4"),
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
  measureSeedance2Settle: mocks.mockMeasure,
}))

vi.mock("../../../lib/seedance-draft-finalize.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/seedance-draft-finalize.js")>()
  return { ...actual, measureSeedanceDraftRenderSec: mocks.mockDraftMeasure }
})

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
import { seedance25CostUsd } from "../../../providers/kie/seedance-cost.js"
import { KIE_CREDIT_USD } from "../../../providers/kie/models.js"

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: false }

const RAW_URL = "https://kie.example/out.mp4"
const REFS = ["https://r2.example.com/videos/ref.mp4"]
const RESULT = { url: RAW_URL, providerUsed: "seedance-2-5", cost: 1.25, displayCost: 1.5625 }

const finalizeArg = () => mocks.mockFinalizeJobWithMedia.mock.calls[0]![0] as Record<string, unknown>
/** What the settle shim answers when it measured nothing (or the measurement failed). */
const NOT_MEASURED = { baseCredits: undefined, seconds: undefined }
/** A settle that measured: the credits the charge commits and the seconds behind them. */
const measured = (baseCredits: number, outputSec: number, inputSec: number) => ({ baseCredits, seconds: { outputSec, inputSec } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockImageToVideo.mockResolvedValue(RESULT)
  mocks.mockTextToVideo.mockResolvedValue(RESULT)
  mocks.mockMeasure.mockResolvedValue(NOT_MEASURED)
  mocks.mockDraftMeasure.mockResolvedValue(undefined)
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
})

describe("image-to-video handler — Seedance reference-video settlement", () => {
  const handler = videoAIHandlers["image-to-video"]

  it("measures the RAW provider output with the run's own provider / resolution / reference clips / reservation probe, and finalize gets the answer", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(7193, 12, 30))
    await handler(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "1080p", duration: 12,
        referenceVideoUrls: REFS, refVideoDurationsSec: [30],
      }) as never,
      ctx as never,
    )
    expect(mocks.mockMeasure).toHaveBeenCalledWith({
      provider: "seedance-2-5", resolution: "1080p", outputUrl: RAW_URL, referenceVideoUrls: REFS, refVideoDurationsSec: [30], duration: 12, jobId: "job-1",
    })
    expect(finalizeArg().meteredBaseCredits).toBe(7193)
  })

  it("measures BEFORE the smart-loop-cut shortens the kept clip — the provider billed the raw length", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(7193, 8, 5))
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

  it("hands the settlement the type the route declared (the hold it sized)", async () => {
    await handler(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "720p", duration: -1,
        referenceVideoUrls: REFS, refVideoDurationsSec: [5], referenceTaskType: "reference",
      }) as never,
      ctx as never,
    )
    expect(mocks.mockMeasure).toHaveBeenCalledWith(expect.objectContaining({ duration: -1, refVideoDurationsSec: [5], referenceTaskType: "reference" }))
  })

  it("no measurement (not a Seedance ref run, or unmeasurable) → finalize commits the reservation as before", async () => {
    await handler(makeJob("image-to-video", { imageUrl: "https://x.png", provider: "veo3.1", duration: 8 }) as never, ctx as never)
    expect(mocks.mockMeasure).toHaveBeenCalledWith({
      provider: "veo3.1", resolution: undefined, outputUrl: RAW_URL, referenceVideoUrls: undefined, refVideoDurationsSec: undefined, duration: 8, jobId: "job-1",
    })
    expect(finalizeArg().meteredBaseCredits).toBeUndefined()
  })
})

describe("text-to-video handler — Seedance reference-video settlement", () => {
  const handler = videoAIHandlers["text-to-video"]

  it("measures the RAW provider output and finalize gets the answer", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(3990, 12, 30))
    await handler(
      makeJob("text-to-video", {
        prompt: "make it black and white", provider: "seedance-2-5", resolution: "720p", duration: 12,
        referenceVideoUrls: REFS, refVideoDurationsSec: [30],
      }) as never,
      ctx as never,
    )
    expect(mocks.mockMeasure).toHaveBeenCalledWith({
      provider: "seedance-2-5", resolution: "720p", outputUrl: RAW_URL, referenceVideoUrls: REFS, refVideoDurationsSec: [30], duration: 12, jobId: "job-1",
    })
    expect(finalizeArg().meteredBaseCredits).toBe(3990)
  })

  it("hands the settlement the type the route declared (the hold it sized), and none when none was", async () => {
    const job = { prompt: "a cat in the style of @video_1", provider: "seedance-2-5", resolution: "720p", duration: -1, referenceVideoUrls: REFS, refVideoDurationsSec: [5] }
    await handler(makeJob("text-to-video", { ...job, referenceTaskType: "reference" }) as never, ctx as never)
    expect(mocks.mockMeasure.mock.calls.at(-1)![0]).toStrictEqual({
      provider: "seedance-2-5", resolution: "720p", outputUrl: RAW_URL, referenceVideoUrls: REFS, refVideoDurationsSec: [5], characterReferences: undefined, duration: -1, referenceTaskType: "reference", jobId: "job-1",
    })
    await handler(makeJob("text-to-video", job) as never, ctx as never)
    expect(mocks.mockMeasure.mock.calls.at(-1)![0]).toHaveProperty("referenceTaskType", undefined)
  })

  // Decided 2026-11-14: the settlement prices what the hold priced, so it gets
  // the job's character references (a Flash character's clip is not priced).
  it("hands the settlement the job's character references", async () => {
    const characterReferences = [{ imageUrl: "https://r2.example.com/p.png", description: "Maya", name: "Maya", videoUrl: REFS[0] }]
    const job = { prompt: "Maya walks", provider: "seedance-2-5", resolution: "720p", duration: 5, referenceVideoUrls: REFS, refVideoDurationsSec: [5], characterReferences }
    await handler(makeJob("text-to-video", job) as never, ctx as never)
    expect(mocks.mockMeasure.mock.calls.at(-1)![0]).toHaveProperty("characterReferences", characterReferences)
  })

  it("no measurement → finalize commits the reservation as before", async () => {
    await handler(makeJob("text-to-video", { prompt: "a sunset", provider: "minimax", duration: 5 }) as never, ctx as never)
    expect(finalizeArg().meteredBaseCredits).toBeUndefined()
  })
})

describe("Seedance draft — the RAW take length is recorded for the 1080p finalize", () => {
  it("image-to-video: measured on the provider's clip BEFORE the loop-cut, recorded on the job", async () => {
    mocks.mockDraftMeasure.mockResolvedValueOnce(4.04)
    mocks.mockApplySmartLoopCut.mockResolvedValueOnce("https://r2.example.com/trimmed.mp4")
    await videoAIHandlers["image-to-video"](
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "480p", duration: 4, draft: true,
        loopTrim: { enabled: true, framesToTest: 16, quality: "precise" },
      }) as never,
      ctx as never,
    )
    expect(mocks.mockDraftMeasure).toHaveBeenCalledWith({ draft: true, provider: "seedance-2-5", outputUrl: RAW_URL })
    expect(mocks.mockDraftMeasure.mock.invocationCallOrder[0]).toBeLessThan(mocks.mockApplySmartLoopCut.mock.invocationCallOrder[0]!)
    expect((finalizeArg().extraOutputData as Record<string, unknown>).draftRenderSec).toBe(4.04)
  })

  it("text-to-video: recorded from the raw clip", async () => {
    mocks.mockDraftMeasure.mockResolvedValueOnce(9.04)
    await videoAIHandlers["text-to-video"](
      makeJob("text-to-video", { prompt: "p", provider: "seedance-2-5", resolution: "480p", duration: -1, draft: true, referenceVideoUrls: REFS }) as never,
      ctx as never,
    )
    expect(mocks.mockDraftMeasure).toHaveBeenCalledWith({ draft: true, provider: "seedance-2-5", outputUrl: RAW_URL })
    expect((finalizeArg().extraOutputData as Record<string, unknown>).draftRenderSec).toBe(9.04)
    // t2v muxes nothing after rendering: an explicit null, never left to inference.
    expect((finalizeArg().extraOutputData as Record<string, unknown>).draftAudioMux).toBeNull()
  })

  it("image-to-video with an audioUrl: the draft records the exact merge it got (for its finalize)", async () => {
    mocks.mockDraftMeasure.mockResolvedValueOnce(4.04)
    await videoAIHandlers["image-to-video"](
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "480p", duration: 4, draft: true,
        audioUrl: "https://a/vo.mp3", generateAudio: true,
      }) as never,
      ctx as never,
    )
    expect((finalizeArg().extraOutputData as Record<string, unknown>).draftAudioMux).toEqual({
      kind: "audio-track", audioUrl: "https://a/vo.mp3", voiceoverVolume: 100, backgroundVolume: 30, keepOriginalAudio: true,
    })
  })

  it("a plain draft records draftAudioMux: null (nothing to re-apply)", async () => {
    await videoAIHandlers["image-to-video"](
      makeJob("image-to-video", { imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "480p", duration: 4, draft: true }) as never,
      ctx as never,
    )
    expect((finalizeArg().extraOutputData as Record<string, unknown>).draftAudioMux).toBeNull()
  })

  it("a non-draft run records nothing", async () => {
    await videoAIHandlers["image-to-video"](
      makeJob("image-to-video", { imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "720p", duration: 4 }) as never,
      ctx as never,
    )
    expect(finalizeArg().extraOutputData).not.toHaveProperty("draftRenderSec")
    expect(finalizeArg().extraOutputData).not.toHaveProperty("draftAudioMux")
  })
})

/**
 * A Seedance 2.5 render records what KIE billed for it as its provider cost:
 * the rate of the tier it rendered at × the seconds its charge was measured
 * from (`seedance25CostUsd`). Recorded only: finalize gets the same
 * `meteredBaseCredits` (the charge), media and output as before, and only
 * `result.cost` differs.
 */
describe("Seedance 2.5 — the recorded provider cost", () => {
  const i2v = videoAIHandlers["image-to-video"]
  const t2v = videoAIHandlers["text-to-video"]
  const finalResult = () => finalizeArg().result as Record<string, unknown>

  it("image-to-video at 720p, a 10 s clip delivered as 10 s: the reference rate on input + output", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(1900, 10, 10))
    await i2v(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "720p", duration: 10,
        referenceVideoUrls: REFS, refVideoDurationsSec: [10],
      }) as never,
      ctx as never,
    )
    expect(finalResult().cost).toBe(seedance25CostUsd({ resolution: "720p", draft: false, hasVideoRef: true, outputSec: 10, inputSec: 10 }))
    expect(finalResult().cost).toBeCloseTo(38 * 20 * KIE_CREDIT_USD, 12)
    // The charge is the measured count, exactly as before.
    expect(finalizeArg().meteredBaseCredits).toBe(1900)
    // Only the cost differs: the rest of the result, the media and the output are as before.
    expect(finalResult()).toEqual({ ...RESULT, cost: finalResult().cost })
    expect(finalizeArg().mediaUrl).toBe("https://r2.example.com/videos/job-1.mp4")
    expect(finalizeArg().extraOutputData).toEqual({ thumbnailUrl: "https://r2.example.com/thumbnails/job-1.png" })
    expect(finalizeArg()).not.toHaveProperty("result.meteredCost")
  })

  it("image-to-video at 1080p, 6 s, records its own figure", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(2055, 6, 6))
    await i2v(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "1080p", duration: 6,
        referenceVideoUrls: REFS, refVideoDurationsSec: [6],
      }) as never,
      ctx as never,
    )
    expect(finalResult().cost).toBe(seedance25CostUsd({ resolution: "1080p", draft: false, hasVideoRef: true, outputSec: 6, inputSec: 6 }))
    expect(finalResult().cost).toBeCloseTo(95 * 12 * KIE_CREDIT_USD, 12)
    expect(finalizeArg().meteredBaseCredits).toBe(2055)
  })

  it("a draft renders and bills at 480p, whatever resolution its payload names", async () => {
    await i2v(
      makeJob("image-to-video", { imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "720p", duration: 4, draft: true }) as never,
      ctx as never,
    )
    // No reference video and a fixed duration: nothing to measure, the 4 s it was asked for.
    expect(finalResult().cost).toBe(seedance25CostUsd({ resolution: "720p", draft: true, hasVideoRef: false, outputSec: 4, inputSec: 0 }))
    expect(finalResult().cost).toBeCloseTo(28 * 4 * KIE_CREDIT_USD, 12)
    expect(finalizeArg().meteredBaseCredits).toBeUndefined()
  })

  it("text-to-video with a reference video records its figure too", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(3990, 12, 30))
    await t2v(
      makeJob("text-to-video", {
        prompt: "make it black and white", provider: "seedance-2-5", resolution: "720p", duration: 12,
        referenceVideoUrls: REFS, refVideoDurationsSec: [30],
      }) as never,
      ctx as never,
    )
    expect(finalResult().cost).toBe(seedance25CostUsd({ resolution: "720p", draft: false, hasVideoRef: true, outputSec: 12, inputSec: 30 }))
    expect(finalizeArg().meteredBaseCredits).toBe(3990)
    expect(finalResult()).toEqual({ ...RESULT, cost: finalResult().cost })
  })

  it("text-to-video with no reference video and a fixed duration bills that duration", async () => {
    await t2v(makeJob("text-to-video", { prompt: "a sunset", provider: "seedance-2-5", resolution: "1080p", duration: 8 }) as never, ctx as never)
    expect(finalResult().cost).toBe(seedance25CostUsd({ resolution: "1080p", draft: false, hasVideoRef: false, outputSec: 8, inputSec: 0 }))
    expect(finalResult().cost).toBeCloseTo(158 * 8 * KIE_CREDIT_USD, 12)
    expect(finalizeArg().meteredBaseCredits).toBeUndefined()
  })

  it("an Auto run with nothing wired bills the length it chose", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(311, 9, 0))
    await t2v(makeJob("text-to-video", { prompt: "a sunset", provider: "seedance-2-5", resolution: "480p", duration: -1 }) as never, ctx as never)
    expect(finalResult().cost).toBe(seedance25CostUsd({ resolution: "480p", draft: false, hasVideoRef: false, outputSec: 9, inputSec: 0 }))
    expect(finalizeArg().meteredBaseCredits).toBe(311)
  })

  it("a seedance-2 run keeps the adapter's cost (no rate table for it)", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(813, 8, 5))
    await i2v(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2", resolution: "720p", duration: 8,
        referenceVideoUrls: REFS, refVideoDurationsSec: [5],
      }) as never,
      ctx as never,
    )
    expect(finalResult()).toEqual(RESULT)
    expect(finalizeArg().meteredBaseCredits).toBe(813)
  })

  it("a failed measurement keeps the adapter's cost: the length is unknown", async () => {
    await i2v(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "720p", duration: 10,
        referenceVideoUrls: REFS, refVideoDurationsSec: [10],
      }) as never,
      ctx as never,
    )
    expect(finalResult()).toEqual(RESULT)
    expect(finalizeArg().meteredBaseCredits).toBeUndefined()
    // An Auto run with nothing wired and an unmeasured length: the same.
    mocks.mockFinalizeJobWithMedia.mockClear()
    await t2v(makeJob("text-to-video", { prompt: "p", provider: "seedance-2-5", resolution: "720p", duration: -1 }) as never, ctx as never)
    expect(finalResult()).toEqual(RESULT)
  })

  it("a length measured but not priced: the reservation is committed, and the cost is still recorded from the seconds", async () => {
    mocks.mockMeasure.mockResolvedValueOnce({ baseCredits: undefined, seconds: { outputSec: 10, inputSec: 10 } })
    await i2v(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "720p", duration: 10,
        referenceVideoUrls: REFS, refVideoDurationsSec: [10],
      }) as never,
      ctx as never,
    )
    expect(finalResult().cost).toBe(seedance25CostUsd({ resolution: "720p", draft: false, hasVideoRef: true, outputSec: 10, inputSec: 10 }))
    expect(finalizeArg().meteredBaseCredits).toBeUndefined()
  })

  it("a relayed run records no cost: the far end's account paid, not this install", async () => {
    const relayed = { url: RAW_URL, providerUsed: "nodaro", cost: null, displayCost: null, relayJobId: "far-job", relayCredits: 120 }
    mocks.mockImageToVideo.mockResolvedValueOnce(relayed)
    mocks.mockMeasure.mockResolvedValueOnce(measured(1900, 10, 10))
    await i2v(
      makeJob("image-to-video", {
        imageUrl: "https://x.png", provider: "seedance-2-5", resolution: "720p", duration: 10,
        referenceVideoUrls: REFS, refVideoDurationsSec: [10],
      }) as never,
      ctx as never,
    )
    expect(finalResult()).toEqual(relayed)
    // A fixed-duration run with nothing wired is not given one either.
    mocks.mockFinalizeJobWithMedia.mockClear()
    mocks.mockTextToVideo.mockResolvedValueOnce(relayed)
    await t2v(makeJob("text-to-video", { prompt: "p", provider: "seedance-2-5", resolution: "720p", duration: 8 }) as never, ctx as never)
    expect(finalResult()).toEqual(relayed)
  })
})

describe("Kling 4.0 and Kling 4.0 Flash — the recorded provider cost of a reference-video run", () => {
  // The provider bills a reference-video run per second of output + the longer
  // of output and the reference clips, at its with-video rate (KIE credits/s:
  // Flash 11.3; Kling 4.0 17 @720p, 25.5 @1080p). The runner cannot see the
  // clips' lengths, so it reports the 2 × output floor; the worker records the
  // cost over the very seconds the charge settled on.
  const i2v = videoAIHandlers["image-to-video"]
  const t2v = videoAIHandlers["text-to-video"]
  const finalResult = () => finalizeArg().result as Record<string, unknown>

  it("Flash: a 5 s output with a 12 s clip records 11.3 × (5 + 12) KIE credits, not the 2 × 5 s floor", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(489, 5, 12))
    await t2v(makeJob("text-to-video", { prompt: "p", provider: "kling-4-flash", resolution: "720p", duration: 5, referenceVideoUrls: REFS, refVideoDurationsSec: [12] }) as never, ctx as never)
    expect(finalResult().cost).toBeCloseTo(11.3 * 17 * KIE_CREDIT_USD, 12)
    expect(finalizeArg().meteredBaseCredits).toBe(489)
  })

  it("Kling 4.0 at 1080p, a 6 s output with a 9 s clip: 25.5 × (6 + 9)", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(957, 6, 9))
    await i2v(
      makeJob("image-to-video", { imageUrl: "https://x.png", provider: "kling-4", resolution: "1080p", duration: 6, referenceVideoUrls: REFS, refVideoDurationsSec: [9] }) as never,
      ctx as never,
    )
    expect(finalResult().cost).toBeCloseTo(25.5 * 15 * KIE_CREDIT_USD, 12)
  })

  it("a clip shorter than the output counts as the output's length: Kling 4.0 720p, 10 s + a 4 s clip = 17 × 20", async () => {
    mocks.mockMeasure.mockResolvedValueOnce(measured(850, 10, 4))
    await t2v(makeJob("text-to-video", { prompt: "p", provider: "kling-4", resolution: "720p", duration: 10, referenceVideoUrls: REFS, refVideoDurationsSec: [4] }) as never, ctx as never)
    expect(finalResult().cost).toBeCloseTo(17 * 20 * KIE_CREDIT_USD, 12)
  })

  it("a failed measurement, or a run with no reference video, keeps the runner's own figure", async () => {
    await t2v(makeJob("text-to-video", { prompt: "p", provider: "kling-4-flash", duration: 5, referenceVideoUrls: REFS, refVideoDurationsSec: [12] }) as never, ctx as never)
    expect(finalResult()).toEqual(RESULT)
    mocks.mockFinalizeJobWithMedia.mockClear()
    await t2v(makeJob("text-to-video", { prompt: "p", provider: "kling-4-flash", duration: 5 }) as never, ctx as never)
    expect(finalResult()).toEqual(RESULT)
  })
})
