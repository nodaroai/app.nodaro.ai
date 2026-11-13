import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// PixVerse V6 Extend (`pixverse-v6-extend`) in the worker: a native extend.
//
// The contract this file pins, in order of importance:
//   1. The deliverable is the user's ORIGINAL source joined with only
//      PixVerse's NEW seconds, through the extend stitch (`stitchExtension`,
//      never combineVideos): the same smart cut as the other extends (8 × 8,
//      best-pair), fixed trims 0/0 when it finds no match (or there is no
//      matcher), then the new part's leading repeats dropped. The new seconds
//      are cut from PixVerse's whole clip by time, at the source's picture length.
//   2. A new part under half the paid seconds — none at all included — fails
//      the run, final on this attempt (a DeterministicJobError, refunded in
//      full) before anything is cut, encoded or delivered. A probe that fails
//      is a plain, retryable error.
//   3. PixVerse gets the source by URL, the prompt as written, the seconds,
//      the quality and the sound the run was priced at; no KIE task is
//      persisted (a reconcile finalize would ship PixVerse's whole clip).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockRunPixverseExtend: vi.fn(),
  mockCutNativeExtension: vi.fn(),
  mockImageToVideo: vi.fn(),
  mockCombineVideos: vi.fn(),
  mockStitchExtension: vi.fn(),
  mockCreateWorkDir: vi.fn(),
  mockCleanupWorkDir: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockProbeVideoSource: vi.fn(),
  mockExtractTailToFile: vi.fn(),
  mockFinalizeJobWithMedia: vi.fn(),
  mockWatermarkLocalVideoAndUpload: vi.fn(),
  mockGenerateAndUploadThumbnail: vi.fn(),
  mockProbeMatched: vi.fn(),
  mockProbeMatchedOrThrow: vi.fn(),
  mockRunVeoExtendTask: vi.fn(),
  mockRunRunwayExtendTask: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/storage.js", () => ({
  mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}`,
  uploadToR2: vi.fn(),
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/buf.mp4"),
}))
vi.mock("@/lib/job-scratch.js", () => ({ uploadJobScratchFile: vi.fn() }))
vi.mock("@/lib/seedance-extend-mov-chain.js", () => ({
  findChainedMovReference: vi.fn(),
  cutChainedMovTail: vi.fn(),
  isMovUrl: () => false,
}))
vi.mock("@/providers/video/extract-tail.js", () => ({ extractTailToFile: mocks.mockExtractTailToFile }))
vi.mock("@/providers/video/extract-frame.js", () => ({ extractFrame: vi.fn() }))
vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: vi.fn(),
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  lipSyncVideo: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
  speechToVideo: vi.fn(),
}))
vi.mock("@/providers/video/combine-videos.js", () => ({ combineVideos: mocks.mockCombineVideos }))
// The real `pictureSecondsOf` / `extensionPictureSeconds`; the stitch itself is mocked.
vi.mock("@/providers/video/extend-stitch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/extend-stitch.js")>()),
  stitchExtension: mocks.mockStitchExtension,
}))
vi.mock("@/providers/video/matched-encode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/matched-encode.js")>()),
  // The source's probe (its picture length).
  probeMatched: mocks.mockProbeMatched,
  // PixVerse's clip's probe, which throws when ffprobe fails (`extensionPictureSeconds`).
  probeMatchedOrThrow: mocks.mockProbeMatchedOrThrow,
}))
// The real start rule (`nativeExtensionCutStartSec`); the cut itself is mocked.
vi.mock("@/providers/video/native-extension-cut.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/native-extension-cut.js")>()),
  cutNativeExtension: mocks.mockCutNativeExtension,
}))
vi.mock("@/providers/kie/pixverse-extend.js", () => ({ runPixverseExtend: mocks.mockRunPixverseExtend }))
vi.mock("@/providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: vi.fn() }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  createWorkDir: mocks.mockCreateWorkDir,
  downloadFile: mocks.mockDownloadFile,
  stripAudio: vi.fn().mockResolvedValue(undefined),
  probeVideoSource: mocks.mockProbeVideoSource,
}))
vi.mock("@/providers/kie/client.js", () => ({
  runVeoExtendTask: mocks.mockRunVeoExtendTask,
  runVeo1080pTask: vi.fn(),
  runVeo4kTask: vi.fn(),
  KieError: class KieError extends Error {},
}))
vi.mock("@/providers/kie/runway-client.js", () => ({ runRunwayExtendTask: mocks.mockRunRunwayExtendTask }))
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
vi.mock("@/lib/discard-job-copies.js", () => ({ discardFailedRunCopies: vi.fn().mockResolvedValue(undefined) }))

import { videoAIHandlers } from "../video-ai.js"
import { extensionTooShortMessage } from "../../../lib/extend-recipe.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import type { MatchedProbe } from "@/providers/video/matched-encode.js"

const SOURCE_URL = "https://r2.example.com/uploads/user-1/market.mp4"
const PIXVERSE_URL = "https://tempfile.kie.example/pixverse-whole.mp4"
const PREP_DIR = "/tmp/extend-prep-x"
const STITCH_DIR = "/tmp/extend-stitch-x"
const SOURCE_PATH = `${PREP_DIR}/source.mp4`
const PIXVERSE_PATH = `${STITCH_DIR}/pixverse.mp4`
const NEW_PART_PATH = `${STITCH_DIR}/native-extension.mov`
const STITCHED_PATH = `${STITCH_DIR}/stitched.mp4`
const STITCHED_R2 = "https://r2.example.com/videos/job-1.mp4"
const BOUNDARY = { matched: false, psnrDb: null, trimEndFrames: 0, trimStartFrames: 0, searchedPrevFrames: null, searchedNextFrames: null }

/** The source's picture: 8.06 s (its sound runs a little past it). */
let sourceProbe: MatchedProbe
/** PixVerse's whole clip: the source re-rendered, then the new seconds. */
let pixverseProbe: MatchedProbe

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "extend-video",
    data: {
      jobId: "job-1",
      provider: "pixverse-v6-extend",
      video: SOURCE_URL,
      prompt: "the stall keeper waves",
      duration: 5,
      resolution: "540p",
      generateAudio: true,
      ...data,
    },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
const run = (data: Record<string, unknown> = {}) => videoAIHandlers["extend-video"]!(makeJob(data) as never, ctx as never)
const failureOf = (data: Record<string, unknown> = {}) => run(data).then(() => undefined, (err: unknown) => err)

/** PixVerse's clip with `seconds` of picture in all. */
const pixverseWith = (seconds: number | undefined): void => {
  pixverseProbe = seconds === undefined
    ? { audioCodec: "aac", durationSec: 8 }
    : { width: 1280, height: 720, videoCodec: "h264", audioCodec: "aac", durationSec: seconds, videoDurationSec: seconds }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockCreateWorkDir.mockImplementation(async (prefix: string) => (prefix === "extend-stitch" ? STITCH_DIR : PREP_DIR))
  mocks.mockCleanupWorkDir.mockResolvedValue(undefined)
  mocks.mockDownloadFile.mockResolvedValue(undefined)
  mocks.mockRunPixverseExtend.mockResolvedValue({ url: PIXVERSE_URL, kieTaskId: "kie-px-1", providerMs: 90_000 })
  mocks.mockCutNativeExtension.mockResolvedValue(NEW_PART_PATH)
  mocks.mockStitchExtension.mockResolvedValue({ outputPath: STITCHED_PATH, boundary: BOUNDARY })
  mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue(STITCHED_R2)
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/images/thumb.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  sourceProbe = { width: 854, height: 480, videoCodec: "h264", audioCodec: "aac", durationSec: 8.1, videoDurationSec: 8.06 }
  // 8.06 s of source, re-rendered, then 5.19 s of new footage.
  pixverseWith(13.25)
  // Each probe reads the file it is given: the source's local copy, or PixVerse's clip.
  const probeOf = async (path: string) => (path === PIXVERSE_PATH ? pixverseProbe : sourceProbe)
  mocks.mockProbeMatched.mockImplementation(probeOf)
  mocks.mockProbeMatchedOrThrow.mockImplementation(probeOf)
})

describe("pixverse-v6-extend — what PixVerse is asked for", () => {
  it("sends the source by URL, the prompt as written, the seconds, the quality and the sound the run was priced at", async () => {
    await run({ prompt: "  the stall keeper waves  ", duration: 7, resolution: "1080p", generateAudio: false })
    expect(mocks.mockRunPixverseExtend).toHaveBeenCalledTimes(1)
    const [args, reconcileOpts] = mocks.mockRunPixverseExtend.mock.calls[0]!
    expect(args).toEqual({ videoUrl: SOURCE_URL, prompt: "  the stall keeper waves  ", durationSec: 7, quality: "1080p", sound: false })
    // No KIE task persisted: the reconcile cron would finalize the job with PixVerse's whole clip.
    expect(reconcileOpts).toBeUndefined()
    // Never the tail recipe, nor VEO or Runway.
    expect(mocks.mockImageToVideo).not.toHaveBeenCalled()
    expect(mocks.mockExtractTailToFile).not.toHaveBeenCalled()
    expect(mocks.mockRunVeoExtendTask).not.toHaveBeenCalled()
    expect(mocks.mockRunRunwayExtendTask).not.toHaveBeenCalled()
  })

  it("sends 5 s, 720p and sound on when the job names none", async () => {
    await run({ duration: undefined, resolution: undefined, generateAudio: undefined })
    expect(mocks.mockRunPixverseExtend.mock.calls[0]![0]).toMatchObject({ durationSec: 5, quality: "720p", sound: true })
  })

  it("sends a quality it offers as asked, 480p as 540p, and anything else as 720p (the rows it was priced at)", async () => {
    for (const [sent, quality] of [["360p", "360p"], ["540p", "540p"], ["720p", "720p"], ["1080p", "1080p"], ["480p", "540p"], ["4k", "720p"]] as const) {
      mocks.mockRunPixverseExtend.mockClear()
      await run({ resolution: sent })
      expect(mocks.mockRunPixverseExtend.mock.calls[0]![0].quality, sent).toBe(quality)
    }
  })

  it("holds a hand-queued length to its 1–15 s", async () => {
    for (const [sent, seconds] of [[0, 5], [1, 1], [15, 15], [40, 15], ["9", 9]] as const) {
      mocks.mockRunPixverseExtend.mockClear()
      pixverseWith(8.06 + seconds)
      await run({ duration: sent })
      expect(mocks.mockRunPixverseExtend.mock.calls[0]![0].durationSec, String(sent)).toBe(seconds)
    }
  })
})

describe("pixverse-v6-extend — the deliverable", () => {
  it("stitches the user's original source with only PixVerse's new part", async () => {
    await run()
    // PixVerse's whole clip is downloaded, and its new part cut from it at the source's picture length (by time).
    expect(mocks.mockDownloadFile).toHaveBeenCalledWith(SOURCE_URL, SOURCE_PATH)
    expect(mocks.mockDownloadFile).toHaveBeenCalledWith(PIXVERSE_URL, PIXVERSE_PATH)
    expect(mocks.mockCutNativeExtension).toHaveBeenCalledWith(PIXVERSE_PATH, 8.06, STITCH_DIR, { sound: true })
    // The stitch gets the user's own source and that cut: the smart cut the other extends
    // get (8 × 8), fixed trims 0/0 when it finds no match, and the leading repeats dropped.
    expect(mocks.mockCombineVideos).not.toHaveBeenCalled()
    expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
    expect(mocks.mockStitchExtension).toHaveBeenCalledWith({
      sourcePath: SOURCE_PATH,
      extensionPath: NEW_PART_PATH,
      workDir: STITCH_DIR,
      smartCut: { framesFromPrev: 8, framesFromNext: 8 },
      fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 },
      audioFadeSec: 0.15,
      dropLeadingRepeats: true,
    })
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(STITCHED_PATH, "job-1", "user-1", false)
  })

  // The stitch (mocked here) applies the cut and the repeat drop and reports the total in
  // its start trim (`extend-stitch.test.ts` pins that arithmetic); the run reports it as given.
  it("reports a matched cut with the leading repeats it dropped in nextClipStartTrimFrames", async () => {
    // The matcher's twin (2 frames), then 4 repeats.
    mocks.mockStitchExtension.mockResolvedValue({
      outputPath: STITCHED_PATH,
      boundary: { matched: true, psnrDb: 38.8, trimEndFrames: 1, trimStartFrames: 6, searchedPrevFrames: 8, searchedNextFrames: 8 },
    })
    await run()
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData.smartCuts).toEqual([
      { boundary: 0, prevClipEndTrimFrames: 1, nextClipStartTrimFrames: 6, psnrDb: 38.8, matched: true, searchedPrevFrames: 8, searchedNextFrames: 8 },
    ])
  })

  it("with no matcher, reports the fixed trims 0/0 plus the repeat drop", async () => {
    // The new part's first frame kept, the 3 repeats after it dropped.
    mocks.mockStitchExtension.mockResolvedValue({ outputPath: STITCHED_PATH, boundary: { ...BOUNDARY, trimStartFrames: 3 } })
    await run()
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData.smartCuts).toEqual([
      { boundary: 0, prevClipEndTrimFrames: 0, nextClipStartTrimFrames: 3, psnrDb: null, matched: false, searchedPrevFrames: null, searchedNextFrames: null },
    ])
  })

  // The paid seconds are what PixVerse returned, before any trim: the short-extension
  // rule never sees the frames the stitch drops, and the price is the row it reserved.
  it("judges the new part's length on what PixVerse returned, before the stitch drops anything", async () => {
    pixverseWith(8.06 + 2.5)
    mocks.mockStitchExtension.mockResolvedValue({ outputPath: STITCHED_PATH, boundary: { ...BOUNDARY, trimStartFrames: 12 } })
    await run({ duration: 5 })
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].result).toMatchObject({ cost: null })
  })

  it("measures the source's picture as the stitch does: the picture stream's own length, not the container's", async () => {
    sourceProbe = { width: 854, height: 480, videoCodec: "h264", durationSec: 9, videoDurationSec: 8.5 }
    pixverseWith(13.5)
    await run()
    expect(mocks.mockCutNativeExtension).toHaveBeenCalledWith(PIXVERSE_PATH, 8.5, STITCH_DIR, { sound: true })
  })

  it("counts the cut from where PixVerse's picture starts on its timeline", async () => {
    pixverseProbe = { ...pixverseProbe, videoStartSec: 0.05, audioStartSec: 0 }
    await run()
    expect(mocks.mockCutNativeExtension.mock.calls[0]![1]).toBeCloseTo(8.11, 9)
  })

  // The sound switch off: the new seconds are silent whatever PixVerse returns,
  // so the cut drops PixVerse's sound and the stitch pads the new seconds with silence.
  it("cuts the new seconds without PixVerse's sound when the sound is off", async () => {
    await run({ generateAudio: false })
    expect(mocks.mockCutNativeExtension).toHaveBeenCalledWith(PIXVERSE_PATH, 8.06, STITCH_DIR, { sound: false })
  })

  // One line that settles, from a staging run's log, where PixVerse's new part starts.
  it("logs the cut: the source's and PixVerse's picture, the new seconds, where the cut starts, the billed seconds and PixVerse's sound", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      pixverseProbe = { ...pixverseProbe, videoStartSec: 0.05, audioStartSec: 0 }
      await run({ duration: 5 })
      const lines = log.mock.calls.map((c) => c.map(String).join(" ")).filter((l) => l.includes("PixVerse cut"))
      expect(lines).toEqual([
        "[worker] extend-video job-1 PixVerse cut: source 8.060s, PixVerse clip 13.250s (sound: yes), new 5.190s, cut from 8.110s (picture offset 0.050s), billed 5s",
      ])
    } finally {
      log.mockRestore()
    }
  })

  it("logs the numbers before a short new part is refused, and when PixVerse's clip has no sound", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      pixverseProbe = { width: 1280, height: 720, videoCodec: "h264", durationSec: 10.06, videoDurationSec: 10.06 }
      await failureOf({ duration: 5 })
      const lines = log.mock.calls.map((c) => c.map(String).join(" ")).filter((l) => l.includes("PixVerse cut"))
      expect(lines).toEqual([
        "[worker] extend-video job-1 PixVerse cut: source 8.060s, PixVerse clip 10.060s (sound: no), new 2.000s, cut from 8.060s (picture offset 0.000s), billed 5s",
      ])
    } finally {
      log.mockRestore()
    }
  })

  it("finalizes the stitched clip as pixverse-v6-extend, PixVerse's clip kept as the raw extension", async () => {
    await run()
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize.jobType).toBe("extend-video")
    expect(finalize.mediaUrl).toBe(STITCHED_R2)
    expect(finalize.result).toMatchObject({ url: STITCHED_R2, providerUsed: "pixverse-v6-extend" })
    expect(finalize.extraOutputData).toMatchObject({
      thumbnailUrl: "https://r2.example.com/images/thumb.png",
      rawExtensionUrl: PIXVERSE_URL,
      smartCuts: [{ boundary: 0, prevClipEndTrimFrames: 0, nextClipStartTrimFrames: 0, psnrDb: null, matched: false, searchedPrevFrames: null, searchedNextFrames: null }],
    })
    // Not a task id a VEO or Runway extend downstream could pick up as its own.
    expect(finalize.extraOutputData).not.toHaveProperty("kieTaskId")
  })

  it("removes both folders", async () => {
    await run()
    const cleanups = mocks.mockCleanupWorkDir.mock.calls.map((c) => c[0])
    expect(cleanups).toContain(PREP_DIR)
    expect(cleanups).toContain(STITCH_DIR)
  })

  it("a stitch that fails fails the job (refunded), never delivering PixVerse's clip or the source, and removes both folders", async () => {
    mocks.mockStitchExtension.mockRejectedValue(new Error("stitch failed"))
    await expect(run()).rejects.toThrow("stitch failed")
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
    const cleanups = mocks.mockCleanupWorkDir.mock.calls.map((c) => c[0])
    expect(cleanups).toContain(PREP_DIR)
    expect(cleanups).toContain(STITCH_DIR)
  })

  // The source's probe READ it and found no picture: the same file fails the same
  // way on every attempt, so it is final now (refunded), never re-downloaded and retried.
  it("a source with no picture fails at once, final, before PixVerse is asked", async () => {
    // What the probe reads of a file with no video stream (`parseMatchedProbe`).
    sourceProbe = {}
    const failure = await failureOf()
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe("Extend: the source video has no picture to extend")
    expect(isDeterministicJobError(failure)).toBe(true)
    expect(mocks.mockProbeMatchedOrThrow).toHaveBeenCalledWith(SOURCE_PATH)
    expect(mocks.mockRunPixverseExtend).not.toHaveBeenCalled()
    expect(mocks.mockCleanupWorkDir.mock.calls.map((c) => c[0])).toContain(PREP_DIR)
  })

  // A probe that FAILED (timed out, could not start) says nothing about the source:
  // a plain error, retried like any transient failure.
  it("a source probe that fails is a plain, retryable error, before PixVerse is asked", async () => {
    mocks.mockProbeMatchedOrThrow.mockImplementation(async (path: string) => {
      if (path === SOURCE_PATH) throw Object.assign(new Error("ffprobe failed: killed"), { killed: true, timedOut: true })
      return pixverseProbe
    })
    const failure = await failureOf()
    expect(failure).toBeInstanceOf(Error)
    expect(isDeterministicJobError(failure)).toBe(false)
    expect((failure as Error).message).not.toBe("Extend: the source video has no picture to extend")
    expect(mocks.mockRunPixverseExtend).not.toHaveBeenCalled()
  })
})

// PixVerse's new part is its whole clip less the source's picture. Under half
// the paid seconds fails the run, final now and refunded in full, before it is
// cut, stitched or delivered.
describe("pixverse-v6-extend — a short new part fails with a full refund", () => {
  it("fails with a full refund when PixVerse's new part is under half the paid length", async () => {
    // 5 s paid; 8.06 s of source + 2.0 s new.
    pixverseWith(10.06)
    const failure = await failureOf({ duration: 5 })
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(extensionTooShortMessage(10.06 - 8.06, 5))
    expect((failure as Error).message).toBe("The model returned only 2.0s of the 5s extension, so nothing was charged. Try again.")
    // Final on this attempt (the failure path refunds every credit), never retried into another generation.
    expect(isDeterministicJobError(failure)).toBe(true)
    // Measured on PixVerse's own download, before anything is cut or encoded.
    expect(mocks.mockProbeMatchedOrThrow).toHaveBeenCalledWith(PIXVERSE_PATH)
    expect(mocks.mockCutNativeExtension).not.toHaveBeenCalled()
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
    expect(mocks.mockWatermarkLocalVideoAndUpload).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
    const cleanups = mocks.mockCleanupWorkDir.mock.calls.map((c) => c[0])
    expect(cleanups).toContain(PREP_DIR)
    expect(cleanups).toContain(STITCH_DIR)
  })

  it("fails the same way when PixVerse returns no new part at all", async () => {
    for (const whole of [8.06, 8.0]) {
      vi.clearAllMocks()
      mocks.mockCreateWorkDir.mockImplementation(async (prefix: string) => (prefix === "extend-stitch" ? STITCH_DIR : PREP_DIR))
      mocks.mockRunPixverseExtend.mockResolvedValue({ url: PIXVERSE_URL, kieTaskId: "kie-px-1" })
      const probeOf = async (path: string) => (path === PIXVERSE_PATH ? pixverseProbe : sourceProbe)
      mocks.mockProbeMatched.mockImplementation(probeOf)
      mocks.mockProbeMatchedOrThrow.mockImplementation(probeOf)
      pixverseWith(whole)
      const failure = await failureOf({ duration: 5 })
      expect((failure as Error).message, String(whole)).toBe("The model returned only 0.0s of the 5s extension, so nothing was charged. Try again.")
      expect(isDeterministicJobError(failure)).toBe(true)
      expect(mocks.mockCutNativeExtension).not.toHaveBeenCalled()
      expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
    }
  })

  it("a clip that was read and has no picture fails the same way, final", async () => {
    pixverseWith(undefined)
    const failure = await failureOf({ duration: 5 })
    expect((failure as Error).message).toBe(extensionTooShortMessage(undefined, 5))
    expect(isDeterministicJobError(failure)).toBe(true)
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
  })

  it("exactly half the paid seconds is delivered", async () => {
    pixverseWith(8.06 + 2.5)
    await run({ duration: 5 })
    expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
  })

  it("an unset length is judged against the 5 s it was priced at", async () => {
    pixverseWith(8.06 + 2.4)
    const failure = await failureOf({ duration: undefined })
    expect((failure as Error).message).toBe(extensionTooShortMessage(8.06 + 2.4 - 8.06, 5))
    expect((failure as Error).message).toMatch(/ of the 5s extension, /)
  })

  it("a probe that fails is a plain, retryable error, not the short-extension refusal", async () => {
    mocks.mockProbeMatchedOrThrow.mockImplementation(async (path: string) => {
      if (path === PIXVERSE_PATH) throw Object.assign(new Error("ffprobe failed: killed"), { killed: true, timedOut: true })
      return sourceProbe
    })
    const failure = await failureOf()
    expect(failure).toBeInstanceOf(Error)
    expect(isDeterministicJobError(failure)).toBe(false)
    expect((failure as Error).message).not.toMatch(/The model returned only/)
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })
})
