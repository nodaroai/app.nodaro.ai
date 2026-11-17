// @test-units-by-name runs only the Extend Video provider it names (Gemini Omni Flash 1.2 Extend)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Gemini Omni Flash 1.2 Extend in the worker (decided 2026-11-17): the
// source's last 10 s go to fal's extend (the generation is mocked here), fal's
// clip is the tail with the new seconds after it, only the new seconds are
// kept and joined onto the user's own source by the native-extend stitch, and
// the run settles per second sent and added on its own rows.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockTextToVideo: vi.fn(),
  mockImageToVideo: vi.fn(),
  mockCombineVideos: vi.fn(),
  mockStitchExtension: vi.fn(),
  mockCreateWorkDir: vi.fn(),
  mockCleanupWorkDir: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockProbeVideoSource: vi.fn(),
  mockExtractTailToFile: vi.fn(),
  mockExtractFrame: vi.fn(),
  mockUploadJobScratchFile: vi.fn(),
  mockUploadToR2: vi.fn(),
  mockFindChainedMovReference: vi.fn(),
  mockCutChainedMovTail: vi.fn(),
  mockFinalizeJobWithMedia: vi.fn(),
  mockWatermarkLocalVideoAndUpload: vi.fn(),
  mockGenerateAndUploadThumbnail: vi.fn(),
  mockFrom: vi.fn(),
  mockDiscardFailedRunCopies: vi.fn(),
  mockProbeMatched: vi.fn(),
  /** A price read that fails, when a test sets it. */
  priceReadFails: { current: false },
  mockProbeMatchedOrThrow: vi.fn(),
  mockFalGeminiOmniExtend: vi.fn(),
  mockCutNativeExtension: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))

vi.mock("@/lib/storage.js", () => ({
  mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}`,
  uploadToR2: mocks.mockUploadToR2,
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/buf.mp4"),
}))
vi.mock("@/lib/job-scratch.js", () => ({ uploadJobScratchFile: mocks.mockUploadJobScratchFile }))

vi.mock("@/lib/seedance-extend-mov-chain.js", () => ({
  findChainedMovReference: mocks.mockFindChainedMovReference,
  cutChainedMovTail: mocks.mockCutChainedMovTail,
  isMovUrl: (u: string) => {
    try {
      return new URL(u).pathname.toLowerCase().endsWith(".mov")
    } catch {
      return false
    }
  },
}))

vi.mock("@/providers/video/extract-tail.js", () => ({ extractTailToFile: mocks.mockExtractTailToFile }))
vi.mock("@/providers/video/extract-frame.js", () => ({ extractFrame: mocks.mockExtractFrame }))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: mocks.mockTextToVideo,
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  lipSyncVideo: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
  speechToVideo: vi.fn(),
}))

// Kept mocked so a regression back to the general combine is caught, never run.
vi.mock("@/providers/video/combine-videos.js", () => ({ combineVideos: mocks.mockCombineVideos }))
// The tail's picture rule is the real one (`extendTailPicture`); the stitch itself is mocked.
vi.mock("@/providers/video/extend-stitch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/extend-stitch.js")>()),
  stitchExtension: mocks.mockStitchExtension,
}))
// The source's colour probe (`probeMatched`): what decides whether its tail is converted to SDR.
vi.mock("@/providers/video/matched-encode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/matched-encode.js")>()),
  probeMatched: mocks.mockProbeMatched,
  // The extension's probe, which throws when ffprobe fails (`extensionPictureSeconds`).
  probeMatchedOrThrow: mocks.mockProbeMatchedOrThrow,
}))
vi.mock("@/providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: vi.fn() }))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  createWorkDir: mocks.mockCreateWorkDir,
  downloadFile: mocks.mockDownloadFile,
  stripAudio: vi.fn().mockResolvedValue(undefined),
  probeVideoSource: mocks.mockProbeVideoSource,
}))

vi.mock("@/providers/kie/client.js", () => ({
  runVeoExtendTask: vi.fn(),
  runVeo1080pTask: vi.fn(),
  runVeo4kTask: vi.fn(),
  KieError: class KieError extends Error {},
}))
vi.mock("@/providers/kie/runway-client.js", () => ({ runRunwayExtendTask: vi.fn() }))
vi.mock("@/providers/kie/video.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/kie/video.js")>()
  return { ...actual, KieVideoProvider: class {} }
})

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: vi.fn().mockResolvedValue(undefined),
    shouldSaveJobResult: vi.fn().mockResolvedValue(true),
    markJobCompleted: vi.fn().mockResolvedValue(true),
    uploadVideoMaybeWatermark: vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4"),
    watermarkLocalVideoAndUpload: mocks.mockWatermarkLocalVideoAndUpload,
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: vi.fn(async () => {}),
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_j: unknown, _i: unknown, _o: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia }))
// The price rows a settlement reads, from the static table (no database here).
// (The table is read when a price is asked for, never while the mock is built:
// the billing module imports this one, so loading it here would deadlock.)
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/credit-base-cost.js")>()
  return {
    ...actual,
    unitRateBaseCredits: async (id: string, units: number) => {
      if (mocks.priceReadFails.current) throw new Error("price table unreachable")
      const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
      return actual.quoteBaseCredits(STATIC_CREDIT_COSTS[id]!, units)
    },
    baseCreditCostFor: async (id: string) => {
      if (mocks.priceReadFails.current) throw new Error("price table unreachable")
      const { STATIC_CREDIT_COSTS } = await import("@/ee/billing/credits.js")
      return STATIC_CREDIT_COSTS[id]!
    },
  }
})
vi.mock("@/lib/discard-job-copies.js", () => ({ discardFailedRunCopies: mocks.mockDiscardFailedRunCopies }))

vi.mock("@/providers/fal/gemini-omni-extend.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/fal/gemini-omni-extend.js")>()),
  falGeminiOmniExtend: mocks.mockFalGeminiOmniExtend,
}))
vi.mock("@/providers/video/native-extension-cut.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/native-extension-cut.js")>()),
  cutNativeExtension: mocks.mockCutNativeExtension,
}))

import { videoAIHandlers } from "../video-ai.js"
import { config } from "../../../lib/config.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { extensionTooShortMessage } from "../../../lib/extend-recipe.js"
import { falGeminiOmniExtendCostUsd } from "@/providers/fal/pricing.js"
import type { MatchedProbe } from "@/providers/video/matched-encode.js"

const P = "gemini-omni-flash-1-2-extend"
const SOURCE_URL = "https://r2.example.com/videos/prev-job.mp4"
const PREP_DIR = "/tmp/test-workdir"
const SOURCE_LOCAL = `${PREP_DIR}/source.mp4`
const TAIL_PATH = `${PREP_DIR}/source.mp4.tail.mp4`
const TAIL_URL = "https://r2.example.com/tmp/provider-input/job-1/extend-tail-aaaaaaaa.mp4"
const FAL_URL = "https://fal.media/files/out.mp4"
const STITCH_DIR = "/tmp/extend-stitch-x"
const GENERATED_PATH = `${STITCH_DIR}/extension.mp4`
const NEW_PART_PATH = `${STITCH_DIR}/native-new.mp4`
const STITCHED_R2 = "https://r2.example.com/videos/job-1.mp4"
const BOUNDARY = { matched: true, psnrDb: 41.2, trimEndFrames: 0, trimStartFrames: 2, searchedPrevFrames: 8, searchedNextFrames: 8 }

/** The source's picture as downloaded, the sent tail's, and fal's clip (the tail + the new seconds). */
let sourceSec: number
let tailSec: number
let falSec: number

const probeOf = (sec: number): MatchedProbe => ({ width: 1920, height: 1080, videoCodec: "h264", durationSec: sec, videoDurationSec: sec })
function probeByPath(path: string): MatchedProbe {
  if (path === TAIL_PATH) return probeOf(tailSec)
  if (path === GENERATED_PATH) return probeOf(falSec)
  return probeOf(sourceSec)
}

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
/** A BullMQ job whose data persists across its attempts (`updateData`), as Redis keeps it. */
function makeJob(data: Record<string, unknown> = {}) {
  const job = {
    name: "extend-video",
    data: { jobId: "job-1", provider: P, video: SOURCE_URL, prompt: "she turns and runs", ...data } as Record<string, unknown>,
    id: "bull-1",
    updateProgress: vi.fn(),
    updateData: vi.fn(async (next: Record<string, unknown>) => { job.data = next }),
  }
  return job
}
const runJob = (job: ReturnType<typeof makeJob>) => videoAIHandlers["extend-video"]!(job as never, ctx as never)
const run = (data: Record<string, unknown> = {}) => runJob(makeJob(data))

const finalized = () => mocks.mockFinalizeJobWithMedia.mock.calls[0]![0] as Record<string, unknown> & { result: Record<string, unknown> }
const savedFalKey = config.FAL_KEY

beforeEach(() => {
  vi.clearAllMocks()
  ;(config as { FAL_KEY: string }).FAL_KEY = "test-fal-key"
  sourceSec = 12
  tailSec = 10
  falSec = 18
  mocks.mockProbeVideoSource.mockImplementation(async () => ({ width: 3840, height: 2160, durationSeconds: sourceSec + 0.1, videoDurationSeconds: sourceSec }))
  mocks.mockExtractTailToFile.mockResolvedValue(TAIL_PATH)
  mocks.mockUploadJobScratchFile.mockResolvedValue(TAIL_URL)
  mocks.mockFalGeminiOmniExtend.mockResolvedValue({ videoUrl: FAL_URL, requestId: "req-1" })
  mocks.mockCreateWorkDir.mockImplementation(async (prefix: string) => (prefix === "extend-stitch" ? STITCH_DIR : PREP_DIR))
  mocks.mockCleanupWorkDir.mockResolvedValue(undefined)
  mocks.mockDownloadFile.mockResolvedValue(undefined)
  mocks.mockCutNativeExtension.mockResolvedValue(NEW_PART_PATH)
  mocks.mockStitchExtension.mockResolvedValue({ outputPath: `${STITCH_DIR}/stitched.mp4`, boundary: BOUNDARY })
  mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue(STITCHED_R2)
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/images/thumb.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockDiscardFailedRunCopies.mockResolvedValue(undefined)
  mocks.mockProbeMatched.mockImplementation(async (path: string) => probeByPath(path))
  mocks.mockProbeMatchedOrThrow.mockImplementation(async (path: string) => probeByPath(path))
})

afterEach(() => {
  ;(config as { FAL_KEY: string }).FAL_KEY = savedFalKey
  mocks.priceReadFails.current = false
})

describe("Gemini Omni Flash 1.2 Extend — the generation (decided 2026-11-17)", () => {
  it("sends the source's last 10 s to fal with the prompt as written, the seconds and the resolution; never KIE", async () => {
    await run({ duration: 5, resolution: "1080p" })
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith(SOURCE_LOCAL, 10, expect.objectContaining({ measureFrom: "picture" }))
    expect(mocks.mockFalGeminiOmniExtend).toHaveBeenCalledTimes(1)
    expect(mocks.mockFalGeminiOmniExtend).toHaveBeenCalledWith({ prompt: "she turns and runs", videoUrl: TAIL_URL, durationSec: 5, resolution: "1080p" }, { onSubmitted: expect.any(Function) })
    expect(mocks.mockTextToVideo).not.toHaveBeenCalled()
    expect(mocks.mockImageToVideo).not.toHaveBeenCalled()
    expect(mocks.mockExtractFrame).not.toHaveBeenCalled()
  })

  it("sends all of a source shorter than 10 s", async () => {
    sourceSec = 6
    tailSec = 6
    falSec = 14
    await run({ duration: 8 })
    expect(mocks.mockExtractTailToFile.mock.calls[0]![1]).toBe(6)
  })

  it("renders a tier above the source's at the source's, records it, and settles at it", async () => {
    // A 1280×720 source asked for 4K: 720p (decided 2026-11-17).
    mocks.mockProbeVideoSource.mockImplementation(async () => ({ width: 1280, height: 720, durationSeconds: sourceSec + 0.1, videoDurationSeconds: sourceSec }))
    await run({ duration: 5, resolution: "4k" })
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[0]![0]).toMatchObject({ resolution: "720p" })
    expect(finalized().extraOutputData).toMatchObject({ resolution: "720p" })
    // 10 s × 5 + 5 s × 42 = 260, the 720p price, not the 4K one held.
    expect(finalized().meteredBaseCredits).toBe(260)
  })

  it("takes an anamorphic source by the shape it plays at, and caps the tier at its display size", async () => {
    // Stored 1440×1080 with a 4:3 sample aspect: it plays as 1920×1080 (16:9).
    mocks.mockProbeVideoSource.mockImplementation(async () => ({ width: 1440, height: 1080, sampleAspectRatio: 4 / 3, durationSeconds: sourceSec + 0.1, videoDurationSeconds: sourceSec }))
    await run({ duration: 5, resolution: "4k" })
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[0]![0]).toMatchObject({ resolution: "1080p" })
  })

  it("a source a few lines over a tier renders at that tier (1920×1088 asked for 4K: 1080p)", async () => {
    mocks.mockProbeVideoSource.mockImplementation(async () => ({ width: 1920, height: 1088, durationSeconds: sourceSec + 0.1, videoDurationSeconds: sourceSec }))
    await run({ duration: 5, resolution: "4k" })
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[0]![0]).toMatchObject({ resolution: "1080p" })
    expect(finalized().meteredBaseCredits).toBe(370)
  })

  it("renders a tier below the source's as asked", async () => {
    await run({ duration: 5, resolution: "360p" })
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[0]![0]).toMatchObject({ resolution: "360p" })
  })

  it("renders its default 8 s at 720p, and a resolution it does not render at 720p", async () => {
    await run({ resolution: "480p" })
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[0]![0]).toMatchObject({ durationSec: 8, resolution: "720p" })
  })

  it("keeps only what follows the sent tail, and joins it onto the ORIGINAL source with the native-extend stitch", async () => {
    await run({ duration: 8 })
    // fal's clip is cut where the tail's picture ends on its timeline, the sound kept.
    expect(mocks.mockCutNativeExtension).toHaveBeenCalledWith(GENERATED_PATH, 10, STITCH_DIR, { sound: true })
    expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
    expect(mocks.mockStitchExtension.mock.calls[0]![0]).toEqual({
      sourcePath: SOURCE_LOCAL,
      extensionPath: NEW_PART_PATH,
      workDir: STITCH_DIR,
      smartCut: { framesFromPrev: 8, framesFromNext: 8 },
      fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 },
      audioFadeSec: expect.any(Number),
      dropLeadingRepeats: true,
    })
    expect(finalized().result).toMatchObject({ url: STITCHED_R2, providerUsed: P })
    expect(finalized().extraOutputData).toMatchObject({ rawExtensionUrl: FAL_URL, smartCuts: [expect.objectContaining({ matched: true, nextClipStartTrimFrames: 2 })] })
  })

  it("a new part under half the billed seconds fails the run, final and refunded, before anything is stitched", async () => {
    falSec = 12 // 10 s tail + 2 s of the 8 s billed
    const err = await run({ duration: 8 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(extensionTooShortMessage(2, 8))
    expect(mocks.mockCutNativeExtension).not.toHaveBeenCalled()
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })
})

describe("Gemini Omni Flash 1.2 Extend — the source", () => {
  it.each([[640, 640], [1440, 1080]])("refuses a %s×%s source again in the worker, final, before fal is called", async (width, height) => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width, height, durationSeconds: 12, videoDurationSeconds: 12 })
    const err = await run({}).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/16:9 or 9:16/)
    expect(mocks.mockFalGeminiOmniExtend).not.toHaveBeenCalled()
  })

  it("refuses a source under about 4 s (3.75 s) before fal is called; takes a nominal 4 s clip measuring 3.96 s", async () => {
    sourceSec = 3.5
    await expect(run({})).rejects.toThrow(/at least 3\.75s/)
    expect(mocks.mockFalGeminiOmniExtend).not.toHaveBeenCalled()
    sourceSec = 3.96
    tailSec = 3.96
    falSec = 3.96 + 8
    await run({})
    expect(mocks.mockFalGeminiOmniExtend).toHaveBeenCalledTimes(1)
  })

  it("an install with no fal key is refused before the source is fetched", async () => {
    ;(config as { FAL_KEY: string }).FAL_KEY = ""
    const err = await run({}).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe("provider_key_missing")
    expect(mocks.mockDownloadFile).not.toHaveBeenCalled()
    expect(mocks.mockFalGeminiOmniExtend).not.toHaveBeenCalled()
  })
})

// Decided 2026-11-17: a retry never starts a second billed generation.
describe("Gemini Omni Flash 1.2 Extend — a retry", () => {
  /** A request as an earlier attempt kept it on the job. */
  const kept = (over: Record<string, unknown> = {}) => ({ falExtendRequest: { falRequestId: "req-7", sentPictureSec: 10, resolution: "1080p", addedSec: 5, sourcePictureSec: 12, ...over } })
  const submits = (id = "req-7") =>
    mocks.mockFalGeminiOmniExtend.mockImplementation(async (_req: unknown, opts: { resumeRequestId?: string; onSubmitted?: (id: string) => Promise<void> }) => {
      if (!opts.resumeRequestId) await opts.onSubmitted?.(id)
      return { videoUrl: FAL_URL, requestId: opts.resumeRequestId ?? id }
    })

  it("keeps the request's id on the job right after submit, with what it was sent", async () => {
    submits()
    tailSec = 9.96
    falSec = 9.96 + 5
    const job = makeJob({ duration: 5, resolution: "1080p" })
    await runJob(job)
    expect(job.updateData).toHaveBeenCalledWith(expect.objectContaining({
      falExtendRequest: { falRequestId: "req-7", sentPictureSec: 9.96, resolution: "1080p", addedSec: 5, sourcePictureSec: 12 },
    }))
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[0]![1]).not.toHaveProperty("resumeRequestId")
  })

  it("the write that keeps it is tried again; one that keeps failing does not abandon the request fal is running", async () => {
    submits()
    const job = makeJob({ duration: 5 })
    job.updateData.mockRejectedValueOnce(new Error("redis down")).mockRejectedValueOnce(new Error("redis down"))
    await runJob(job)
    expect(job.updateData).toHaveBeenCalledTimes(3)
    expect(job.data.falExtendRequest).toMatchObject({ falRequestId: "req-7" })

    mocks.mockFinalizeJobWithMedia.mockClear()
    const lost = makeJob({ duration: 5 })
    lost.updateData.mockRejectedValue(new Error("redis down"))
    await runJob(lost)
    expect(lost.updateData).toHaveBeenCalledTimes(3)
    expect(finalized().result).toMatchObject({ url: STITCHED_R2 })
  })

  it("after a failure once fal finished (the stitch), the retry polls the same request and submits nothing new", async () => {
    submits()
    mocks.mockStitchExtension.mockRejectedValueOnce(new Error("stitch failed"))
    const job = makeJob({ duration: 5 })
    await expect(runJob(job)).rejects.toThrow("stitch failed")
    expect(job.data.falExtendRequest).toMatchObject({ falRequestId: "req-7" })
    await runJob(job)
    expect(mocks.mockFalGeminiOmniExtend).toHaveBeenCalledTimes(2)
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[1]![1]).toMatchObject({ resumeRequestId: "req-7" })
    expect(finalized().result).toMatchObject({ url: STITCHED_R2 })
  })

  it("a request it picks up is cut, settled and recorded by what that request was sent, not by this attempt's reading", async () => {
    submits()
    // This attempt reads another file behind the link: a 1280×720 source of 6 s (its tail 6 s).
    mocks.mockProbeVideoSource.mockImplementation(async () => ({ width: 1280, height: 720, durationSeconds: 6.1, videoDurationSeconds: 6 }))
    sourceSec = 6
    tailSec = 6
    // The request kept on the job was sent a 9.96 s tail of a 12 s source, 5 s at 1080p.
    falSec = 9.96 + 5
    const job = makeJob({ duration: 8, resolution: "4k", ...kept({ sentPictureSec: 9.96 }) })
    await runJob(job)
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[0]![1]).toMatchObject({ resumeRequestId: "req-7" })
    // The new seconds start where the tail that was sent ends.
    expect(mocks.mockCutNativeExtension).toHaveBeenCalledWith(GENERATED_PATH, 9.96, STITCH_DIR, { sound: true })
    // 10 s × 5 + 5 s × 63 = 365 → 370: the kept request's run, not 6 s + 8 s at 720p.
    expect(finalized().meteredBaseCredits).toBe(370)
    expect(finalized().extraOutputData).toMatchObject({ resolution: "1080p" })
    expect(finalized().result.cost).toBeCloseTo(falGeminiOmniExtendCostUsd({ resolution: "1080p", sentSec: 9.96, addedSec: 5 })!, 10)
  })

  it("a kept request that is not whole is not picked up: a new one is submitted", async () => {
    submits("req-new")
    const job = makeJob({ duration: 5, falExtendRequest: { falRequestId: "req-7" }, falRequestId: "req-old" })
    await runJob(job)
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[0]![1]).not.toHaveProperty("resumeRequestId")
    expect(job.data.falExtendRequest).toMatchObject({ falRequestId: "req-new" })
  })

  it("a request that failed on fal's side is forgotten, so the retry submits a new one", async () => {
    mocks.mockFalGeminiOmniExtend.mockRejectedValueOnce(Object.assign(new Error("Gemini Omni Flash 1.2 could not generate the extension. Please try again."), { requestEnded: true }))
    const job = makeJob({ duration: 5, ...kept({ falRequestId: "req-dead" }) })
    await expect(runJob(job)).rejects.toThrow(/could not generate/)
    expect(job.data).not.toHaveProperty("falExtendRequest")
  })

  it("a write that cannot forget it never replaces fal's own error", async () => {
    mocks.mockFalGeminiOmniExtend.mockRejectedValueOnce(Object.assign(new Error("Gemini Omni Flash 1.2 could not generate the extension. Please try again."), { requestEnded: true }))
    const job = makeJob({ duration: 5, ...kept() })
    job.updateData.mockRejectedValue(new Error("redis down"))
    await expect(runJob(job)).rejects.toThrow(/could not generate/)
  })

  it("a poll that got no answer from fal (or ran out) keeps the request, so the retry polls it again", async () => {
    mocks.mockFalGeminiOmniExtend.mockRejectedValueOnce(Object.assign(new Error("Gemini Omni Flash 1.2 could not generate the extension. Please try again."), { requestEnded: false }))
    const job = makeJob({ duration: 5, ...kept() })
    await expect(runJob(job)).rejects.toThrow(/could not generate/)
    expect(job.data.falExtendRequest).toMatchObject({ falRequestId: "req-7" })
    await runJob(job)
    expect(mocks.mockFalGeminiOmniExtend.mock.calls[1]![1]).toMatchObject({ resumeRequestId: "req-7" })
  })

  it("a submit whose outcome is not known leaves no request on the job: the retry submits", async () => {
    // The provider layer throws before any id exists (`onSubmitted` is never told one).
    mocks.mockFalGeminiOmniExtend.mockRejectedValueOnce(Object.assign(new Error("Gemini Omni Flash 1.2 could not generate the extension. Please try again."), { requestEnded: false }))
    const job = makeJob({ duration: 5 })
    await expect(runJob(job)).rejects.toThrow(/could not generate/)
    expect(job.data).not.toHaveProperty("falExtendRequest")
    expect(job.updateData).not.toHaveBeenCalled()
  })

  it("a final refusal keeps nothing to retry", async () => {
    const { DeterministicJobError } = await import("../../../lib/deterministic-job-error.js")
    mocks.mockFalGeminiOmniExtend.mockRejectedValueOnce(new DeterministicJobError("refused"))
    const job = makeJob({ duration: 5, ...kept() })
    await expect(runJob(job)).rejects.toThrow("refused")
    // The job is final: what it keeps does not matter, and it is not cleared.
    expect(job.updateData).not.toHaveBeenCalled()
  })
})

// Decided 2026-11-17: an anamorphic source is sent at the shape it plays at.
describe("Gemini Omni Flash 1.2 Extend — the tail's pixels", () => {
  it("cuts the tail of an anamorphic source with square pixels at its display size", async () => {
    mocks.mockProbeVideoSource.mockImplementation(async () => ({ width: 1440, height: 1080, sampleAspectRatio: 4 / 3, durationSeconds: sourceSec + 0.1, videoDurationSeconds: sourceSec }))
    await run({ duration: 5 })
    expect(mocks.mockExtractTailToFile.mock.calls[0]![2]).toMatchObject({ pictureFilter: "scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1" })
  })

  it("leaves a square-pixel source's tail cut as it was", async () => {
    await run({ duration: 5 })
    expect(mocks.mockExtractTailToFile.mock.calls[0]![2]).not.toHaveProperty("pictureFilter")
  })
})

describe("Gemini Omni Flash 1.2 Extend — the settlement", () => {
  // [source picture, seconds added, resolution, base]
  it.each([
    [12, 5, "720p", 260],
    [12, 10, "720p", 470],
    [4, 3, "720p", 150],
    [12, 5, "4k", 680],
    [12, 5, "360p", 130],
  ] as const)("a %s s source + %s s at %s settles at %s base", async (picture, duration, resolution, base) => {
    sourceSec = picture
    tailSec = Math.min(10, picture)
    falSec = tailSec + duration
    await run({ duration, resolution })
    expect(finalized().meteredBaseCredits).toBe(base)
  })

  it("never sends (or settles) more of the source than its hold was priced on", async () => {
    // Held on an 8 s source; the link now serves 12 s.
    tailSec = 8
    falSec = 13
    await run({ duration: 5, resolution: "720p", sourcePictureSec: 8 })
    expect(mocks.mockExtractTailToFile.mock.calls[0]![1]).toBe(8)
    // 8 × 5 + 5 × 41 = 245 → 250.
    expect(finalized().meteredBaseCredits).toBe(250)
  })

  it("records fal's bill as the job's provider cost, on the length of the tail as it was cut", async () => {
    tailSec = 9.96
    falSec = 9.96 + 5
    await run({ duration: 5, resolution: "1080p" })
    expect(finalized().result.cost).toBeCloseTo(falGeminiOmniExtendCostUsd({ resolution: "1080p", sentSec: 9.96, addedSec: 5 })!, 10)
  })

  it("a price that cannot be read commits the hold as made", async () => {
    mocks.priceReadFails.current = true
    await run({ duration: 5 })
    expect(finalized().meteredBaseCredits).toBeUndefined()
  })
})
