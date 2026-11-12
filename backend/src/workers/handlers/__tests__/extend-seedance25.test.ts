import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// The tail-recipe extend providers (Seedance 2.5, Seedance 2.0, Kling 4): the
// job's provider id picks the model. Kling 4's own case is the last block.
//
// The contract this file exists to pin, in order of importance:
//   1. `seedance-2-0-extend` generates on Seedance 2.0 and `seedance-2-5-extend`
//      on Seedance 2.5, whatever the deployment's environment says; the retired
//      `seedance-2-extend` runs as `seedance-2-5-extend`. 2.0 keeps the options
//      object it has sent since the 2026-07-12 spike (deep-equal, no stray
//      keys), its 4–15s snap, KIE's own URL as `rawExtensionUrl`, no extra
//      storage write and no DB read.
//   2. On either model the deliverable is the stitched, watermarked clip (the
//      extend stitch, `stitchExtension`, never combineVideos), and the KIE
//      task is NOT persisted (a reconcile finalize would ship the unstitched
//      extension).
//   3. The mov chain: a 2.5 raw extension is kept as OUR R2 `.mov` object and
//      persisted as `rawExtensionUrl`, so the next extension can reference it
//      in its own container. A KIE temp URL must never be what we persist.
//   4. The next extension sends only that clip's last 2 s (cut to a MOV that
//      keeps its pixel format and PCM, uploaded to the job's scratch folder),
//      never the whole clip.
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
vi.mock("@/lib/discard-job-copies.js", () => ({ discardFailedRunCopies: mocks.mockDiscardFailedRunCopies }))

import { videoAIHandlers } from "../video-ai.js"
import { extendSourceTooShortMessage, tailRecipeSeconds } from "../../../lib/extend-recipe.js"
import { extendTailPicture } from "@/providers/video/extend-stitch.js"

const SOURCE_URL = "https://r2.example.com/videos/prev-job.mp4"
const KIE_MP4 = "https://kie.example.com/extension.mp4"
const KIE_MOV = "https://kie.example.com/extension.mov?token=abc"
const R2_MOV = "https://r2.example.com/videos/9f2c-raw.mov"
const CHAINED_MOV = "https://r2.example.com/videos/aaaa-raw.mov"
const CHAIN_CUT_PATH = "/tmp/test-workdir/chain-tail.mov"
const TAIL_URL = "https://r2.example.com/tmp/provider-input/job-1/extend-tail-aaaaaaaa.mp4"
const LAST_FRAME_URL = "https://r2.example.com/tmp/provider-input/job-1/extend-last-frame-bbbbbbbb.png"
const CHAIN_CUT_URL = "https://r2.example.com/tmp/provider-input/job-1/extend-chain-tail-cccccccc.mov"
/** The prep folder (the source's local copy, its tail, a chained cut) and the stitch's own. */
const PREP_DIR = "/tmp/test-workdir"
const STITCH_DIR = "/tmp/extend-stitch-x"
const STITCHED_PATH = `${STITCH_DIR}/stitched.mp4`
const STITCHED_R2 = "https://r2.example.com/videos/job-1.mp4"
/** A boundary where the matcher found no genuine match: the fixed trims, with the search's PSNR and windows. */
const BOUNDARY = { matched: false, psnrDb: 19.4, trimEndFrames: 4, trimStartFrames: 3, searchedPrevFrames: 8, searchedNextFrames: 8 }

/** What each scratch upload answers, by the name the worker gives it. */
const SCRATCH_URLS: Record<string, string> = {
  "extend-tail": TAIL_URL,
  "extend-last-frame": LAST_FRAME_URL,
  "extend-chain-tail": CHAIN_CUT_URL,
}

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "extend-video",
    data: {
      jobId: "job-1",
      provider: "seedance-2-5-extend",
      video: SOURCE_URL,
      prompt: "she opens the door",
      ...data,
    },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
const handler = () => videoAIHandlers["extend-video"]!
const run = (data: Record<string, unknown> = {}) => handler()(makeJob(data) as never, ctx as never)

/** The i2v options the extend transport has sent since the 2026-07-12 spike. */
const OPTIONS_TODAY = {
  resolution: "720p",
  generateAudio: true,
  referenceVideoUrls: [TAIL_URL],
  aspectRatio: "adaptive",
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 6 })
  mocks.mockExtractTailToFile.mockResolvedValue("/tmp/test-workdir/source.mp4.tail.mp4")
  mocks.mockExtractFrame.mockResolvedValue({ imagePath: "/tmp/extract-frame-x/frame.png" })
  mocks.mockUploadJobScratchFile.mockImplementation(async (_path: string, name: string) => SCRATCH_URLS[name])
  mocks.mockUploadToR2.mockResolvedValue(R2_MOV)
  mocks.mockFindChainedMovReference.mockResolvedValue(undefined)
  mocks.mockCutChainedMovTail.mockResolvedValue(CHAIN_CUT_PATH)
  mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MP4, cost: 0.2, providerUsed: "kie", kieTaskId: "kie-9" })
  mocks.mockCreateWorkDir.mockImplementation(async (prefix: string) => (prefix === "extend-stitch" ? STITCH_DIR : PREP_DIR))
  mocks.mockCleanupWorkDir.mockResolvedValue(undefined)
  mocks.mockDownloadFile.mockResolvedValue(undefined)
  mocks.mockStitchExtension.mockResolvedValue({ outputPath: STITCHED_PATH, boundary: BOUNDARY })
  mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue(STITCHED_R2)
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/images/thumb.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockDiscardFailedRunCopies.mockResolvedValue(undefined)
  mocks.mockProbeMatched.mockResolvedValue({ width: 1920, height: 1080, videoCodec: "h264" })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("the job's provider picks the model", () => {
  it("a seedance-2-5-extend job generates on seedance-2-5", async () => {
    await run({ provider: "seedance-2-5-extend" })
    expect(mocks.mockImageToVideo.mock.calls[0]![1]).toBe("seedance-2-5")
  })

  it("a seedance-2-0-extend job generates on seedance-2", async () => {
    await run({ provider: "seedance-2-0-extend" })
    expect(mocks.mockImageToVideo.mock.calls[0]![1]).toBe("seedance-2")
  })

  it("the retired seedance-2-extend runs as seedance-2-5-extend", async () => {
    await run({ provider: "seedance-2-extend" })
    expect(mocks.mockImageToVideo.mock.calls[0]![1]).toBe("seedance-2-5")
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].result).toMatchObject({ providerUsed: "seedance-2-5-extend" })
  })

  it.each(["seedance-2-5-extend", "seedance-2-0-extend"])("providerUsed is the job's provider id (%s)", async (provider) => {
    await run({ provider })
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].result).toMatchObject({ url: STITCHED_R2, providerUsed: provider })
  })

  it.each(["seedance-2-5-extend", "seedance-2-0-extend", "seedance-2-extend"])(
    "an unset duration renders the provider's 8 s default (%s)",
    async (provider) => {
      await run({ provider })
      expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(8)
    },
  )

  it.each(["seedance-2-5-extend", "seedance-2-0-extend"] as const)(
    "generates the seconds the route queues and the output length records (tailRecipeSeconds, %s)",
    async (provider) => {
      for (const duration of [undefined, 1, 4, 7.6, "12", 15, 16, 25, 30, 45]) {
        mocks.mockImageToVideo.mockClear()
        await run({ provider, duration })
        expect(mocks.mockImageToVideo.mock.calls[0]![3], String(duration)).toBe(tailRecipeSeconds(provider, duration))
      }
    },
  )

  // A job carries the resolution its row was priced at; one that names a
  // resolution the model does not offer (a hand-written queue entry, an older
  // payload) renders at the 720p it would have been priced at, never above it.
  it.each(["seedance-2-5-extend", "seedance-2-0-extend", "seedance-2-extend"])(
    "renders a resolution the model offers as sent, and any other at 720p (%s)",
    async (provider) => {
      for (const [sent, rendered] of [["480p", "480p"], ["1080p", "1080p"], [undefined, "720p"], ["4k", "720p"], ["2160p", "720p"]] as const) {
        mocks.mockImageToVideo.mockClear()
        await run({ provider, resolution: sent })
        expect(mocks.mockImageToVideo.mock.calls[0]![5], String(sent)).toMatchObject({ resolution: rendered })
      }
    },
  )

  // The route refuses the same sources with the same words (one floor, one
  // message: extend-recipe.ts) — this is the backstop for a probe that failed there.
  it.each(["seedance-2-5-extend", "seedance-2-0-extend"] as const)(
    "floors the source at the recipe's minSourceSec: 1.97 s runs, 1.5 s is refused before any provider call (%s)",
    async (provider) => {
      mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 1.97, videoDurationSeconds: 1.97 })
      await run({ provider })
      expect(mocks.mockImageToVideo).toHaveBeenCalledTimes(1)
      mocks.mockImageToVideo.mockClear()
      mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 1.5, videoDurationSeconds: 1.5 })
      await expect(run({ provider })).rejects.toThrow(extendSourceTooShortMessage(provider, 1.5))
      expect(mocks.mockImageToVideo).not.toHaveBeenCalled()
    },
  )

  it.each(["seedance-2-5-extend", "seedance-2-0-extend"])("cuts a 2 s tail from the picture's end (%s)", async (provider) => {
    await run({ provider })
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", 2, { measureFrom: "picture" })
  })
})

describe("seedance-2-0-extend — today's transport, unchanged", () => {
  const run20 = (data: Record<string, unknown> = {}) => run({ provider: "seedance-2-0-extend", ...data })

  beforeEach(() => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
  })

  it("same model, same options object, same 4–15s snap", async () => {
    await run20({ duration: 40 })
    const [imageUrl, provider, prompt, duration, endFrame, opts, reconcileOpts] =
      mocks.mockImageToVideo.mock.calls[0]!
    expect(imageUrl).toBe(LAST_FRAME_URL)
    expect(provider).toBe("seedance-2")
    expect(prompt).toBe("extend @video_1 as follows:\nshe opens the door")
    expect(duration).toBe(15)
    expect(endFrame).toBeUndefined()
    // Deep equality, not a subset: no `outputFormat` key may appear.
    expect(opts).toEqual(OPTIONS_TODAY)
    expect(reconcileOpts).toBeUndefined()
  })

  it("the tail and the last frame go to the job's scratch folder, on no one's quota (decided 2026-10-09)", async () => {
    await run20()
    expect(mocks.mockUploadJobScratchFile.mock.calls).toEqual([
      ["/tmp/test-workdir/source.mp4.tail.mp4", "extend-tail", "mp4", "video/mp4", "job-1"],
      ["/tmp/extract-frame-x/frame.png", "extend-last-frame", "png", "image/png", "job-1"],
    ])
  })

  it("never looks up a chained mov and never writes an extra R2 object", async () => {
    await run20()
    expect(mocks.mockFindChainedMovReference).not.toHaveBeenCalled()
    expect(mocks.mockCutChainedMovTail).not.toHaveBeenCalled()
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
  })

  it("persists KIE's own URL as rawExtensionUrl, exactly as today", async () => {
    await run20()
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData).toMatchObject({
      rawExtensionUrl: KIE_MP4,
    })
  })

  it("even with KIE_SEEDANCE_25_OUTPUT_FORMAT=mov, a 2.0 dispatch is untouched", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    await run20()
    const [, provider, , , , opts] = mocks.mockImageToVideo.mock.calls[0]!
    expect(provider).toBe("seedance-2")
    expect(opts).toEqual(OPTIONS_TODAY)
  })
})

describe("seedance-2-5-extend — generation on 2.5", () => {
  it("snaps into ITS 4–30s window", async () => {
    await run({ duration: 24 })
    const [, provider, , duration] = mocks.mockImageToVideo.mock.calls[0]!
    expect(provider).toBe("seedance-2-5")
    expect(duration).toBe(24)
  })

  it("clamps above 30", async () => {
    await run({ duration: 45 })
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(30)
  })

  it("clamps below 4", async () => {
    await run({ duration: 1 })
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(4)
  })

  it("without the container lever, no output_format is requested", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
    await run()
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toEqual(OPTIONS_TODAY)
  })

  it("with the container lever, asks KIE for mov", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    await run()
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toEqual({ ...OPTIONS_TODAY, outputFormat: "mov" })
  })

  it("STILL persists no KIE task — the reconcile cron must never ship the raw extension", async () => {
    await run()
    expect(mocks.mockImageToVideo.mock.calls[0]![6]).toBeUndefined()
  })

  it("the deliverable: the extend stitch of source+extension, watermarked, finalized", async () => {
    await run()
    expect(mocks.mockCombineVideos).not.toHaveBeenCalled()
    expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
    expect(mocks.mockStitchExtension.mock.calls[0]![0]).toMatchObject({
      sourcePath: `${PREP_DIR}/source.mp4`,
      extensionPath: `${STITCH_DIR}/extension.mp4`,
      workDir: STITCH_DIR,
    })
    expect(mocks.mockDownloadFile).toHaveBeenCalledWith(KIE_MP4, `${STITCH_DIR}/extension.mp4`)
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(STITCHED_PATH, "job-1", "user-1", false)
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize.mediaUrl).toBe(STITCHED_R2)
    expect(finalize.result).toMatchObject({ url: STITCHED_R2, providerUsed: "seedance-2-5-extend" })
  })
})

describe("the extend stitch, on every Seedance provider", () => {
  it.each(["seedance-2-5-extend", "seedance-2-0-extend", "seedance-2-extend"])(
    "stitches with stitchExtension, never combineVideos, on the same recipe (%s)",
    async (provider) => {
      await run({ provider })
      expect(mocks.mockCombineVideos).not.toHaveBeenCalled()
      expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
      expect(mocks.mockStitchExtension).toHaveBeenCalledWith({
        sourcePath: `${PREP_DIR}/source.mp4`,
        extensionPath: `${STITCH_DIR}/extension.mp4`,
        workDir: STITCH_DIR,
        smartCut: { framesFromPrev: 8, framesFromNext: 8 },
        fallbackTrims: { trimEndFrames: 4, trimStartFrames: 3 },
        audioFadeSec: 0.15,
      })
      // The source is downloaded once, for the tail; the stitch reads that copy.
      expect(mocks.mockDownloadFile.mock.calls.filter(([url]) => url === SOURCE_URL)).toHaveLength(1)
    },
  )

  it.each(["seedance-2-5-extend", "seedance-2-0-extend"])(
    "output_data.smartCuts keeps its shape (%s)",
    async (provider) => {
      await run({ provider })
      const { smartCuts } = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData
      expect(smartCuts).toEqual([{
        boundary: 0,
        prevClipEndTrimFrames: 4,
        nextClipStartTrimFrames: 3,
        psnrDb: 19.4,
        matched: false,
        searchedPrevFrames: 8,
        searchedNextFrames: 8,
      }])
      expect(Object.keys(smartCuts[0])).toEqual([
        "boundary", "prevClipEndTrimFrames", "nextClipStartTrimFrames", "psnrDb", "matched", "searchedPrevFrames", "searchedNextFrames",
      ])
    },
  )
})

// An HDR source (an iPhone's HLG, an HDR10 file's PQ) is delivered in SDR BT.709, so the
// model is sent its tail, and the last frame taken from it, in that same SDR picture.
describe("seedance extend — an HDR source's generation inputs", () => {
  const HLG = {
    width: 1920, height: 1080, videoCodec: "hevc", pixFmt: "yuv420p10le",
    colorPrimaries: "bt2020", colorTransfer: "arib-std-b67", colorSpace: "bt2020nc", colorRange: "tv",
  }

  it.each(["seedance-2-5-extend", "seedance-2-0-extend"])("%s: cuts the tail through the stitch's SDR conversion and takes the last frame from it", async (provider) => {
    mocks.mockProbeMatched.mockResolvedValue(HLG)
    await run({ provider })

    expect(mocks.mockProbeMatched).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4")
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledTimes(1)
    const [path, seconds, opts] = mocks.mockExtractTailToFile.mock.calls[0]!
    expect([path, seconds]).toEqual(["/tmp/test-workdir/source.mp4", 2])
    expect(opts).toEqual({ measureFrom: "picture", ...extendTailPicture(HLG) })
    expect(opts.pictureFilter).toContain("setparams=color_primaries=bt2020:color_trc=arib-std-b67:")
    expect(opts.pictureFilter).toContain("tonemap=tonemap=hable")
    expect(opts.launch.peakMemoryMiB).toBeGreaterThan(0)
    // The last frame comes from that converted tail, and both are what the model is sent.
    expect(mocks.mockExtractFrame).toHaveBeenCalledWith({ videoUrl: TAIL_URL, mode: "last" })
    expect(mocks.mockImageToVideo.mock.calls[0]![0]).toBe(LAST_FRAME_URL)
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toMatchObject({ referenceVideoUrls: [TAIL_URL] })
  })

  it("cuts a chained 2.5 MOV reference exactly as before: Seedance made that clip in SDR", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    mocks.mockProbeMatched.mockResolvedValue(HLG)
    mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
    await run()

    expect(mocks.mockCutChainedMovTail).toHaveBeenCalledTimes(1)
    expect(mocks.mockCutChainedMovTail.mock.calls[0]).toEqual([CHAINED_MOV, 2, PREP_DIR])
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toMatchObject({ referenceVideoUrls: [CHAIN_CUT_URL] })
  })

  it("cuts an SDR or untagged source's tail exactly as before", async () => {
    for (const probe of [{}, { width: 1920, height: 1080, videoCodec: "h264", colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709" }]) {
      mocks.mockExtractTailToFile.mockClear()
      mocks.mockProbeMatched.mockResolvedValue(probe)
      await run()
      expect(mocks.mockExtractTailToFile.mock.calls).toEqual([["/tmp/test-workdir/source.mp4", 2, { measureFrom: "picture" }]])
    }
  })
})

describe("seedance-2-5-extend — the mov reference chain", () => {
  beforeEach(() => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
  })

  it("no prior mov ⇒ the 2s tail, exactly as today, and nothing cut", async () => {
    mocks.mockFindChainedMovReference.mockResolvedValue(undefined)
    await run()
    expect(mocks.mockFindChainedMovReference).toHaveBeenCalledWith(SOURCE_URL, "user-1")
    expect(mocks.mockCutChainedMovTail).not.toHaveBeenCalled()
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toMatchObject({ referenceVideoUrls: [TAIL_URL] })
  })

  it("a chained 2.5 extend sends the previous MOV's last 2 s, not the whole clip", async () => {
    mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
    await run()

    // Cut from the previous raw mov, into the run's own work dir…
    expect(mocks.mockCutChainedMovTail).toHaveBeenCalledWith(CHAINED_MOV, 2, PREP_DIR)
    // …uploaded to the job's scratch folder, as a mov…
    expect(mocks.mockUploadJobScratchFile).toHaveBeenCalledWith(CHAIN_CUT_PATH, "extend-chain-tail", "mov", "video/quicktime", "job-1")
    // …and that cut is the generation's @video_1, never the whole clip.
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toMatchObject({ referenceVideoUrls: [CHAIN_CUT_URL] })
    // The whole clip is copied nowhere (an mp4 result: no raw copy either).
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
    // Cut BEFORE the generation reads it.
    expect(mocks.mockCutChainedMovTail.mock.invocationCallOrder[0]!).toBeLessThan(mocks.mockImageToVideo.mock.invocationCallOrder[0]!)
    // The cut lives in the job's scratch folder, emptied when the job ends: nothing to name in the output.
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData.chainReferenceUrl).toBeUndefined()
  })

  it("a failed cut falls back to the tail, still completing", async () => {
    mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
    mocks.mockCutChainedMovTail.mockRejectedValue(new Error("Failed to download video: 404"))
    await run()

    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toMatchObject({ referenceVideoUrls: [TAIL_URL] })
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].mediaUrl).toBe(STITCHED_R2)
  })

  it("a mov result is stored as OUR R2 .mov and persisted — never KIE's expiring URL", async () => {
    mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
    await run()

    expect(mocks.mockUploadToR2).toHaveBeenCalledTimes(1)
    const [srcUrl, keyId, type, userId, opts] = mocks.mockUploadToR2.mock.calls[0]!
    expect(srcUrl).toBe(KIE_MOV)
    expect(type).toBe("video")
    expect(userId).toBe("user-1")
    expect(opts).toEqual({ ext: "mov" })
    // In the job's own family (`<jobId>-raw`), so the job's expiry finds it
    // (decided 2026-10-08) — but never the job's bare id: that slot is the
    // deliverable's, and reusing it would let this object masquerade as the result.
    expect(keyId).toBe("job-1-raw")
    expect(keyId).not.toBe("job-1")

    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData).toMatchObject({
      rawExtensionUrl: R2_MOV,
    })
    // The stitch reads KIE's mov, downloaded as a .mov into the stitch's own folder.
    expect(mocks.mockDownloadFile).toHaveBeenCalledWith(KIE_MOV, `${STITCH_DIR}/extension.mov`)
    expect(mocks.mockStitchExtension.mock.calls[0]![0]).toMatchObject({ extensionPath: `${STITCH_DIR}/extension.mov` })
  })

  it("an mp4 result (KIE ignored the field) falls back to today's persistence", async () => {
    mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MP4, cost: 0.3 })
    await run()
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData).toMatchObject({
      rawExtensionUrl: KIE_MP4,
    })
  })

  it("a failed mov copy does NOT fail the job — the deliverable is the stitch", async () => {
    mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
    mocks.mockUploadToR2.mockRejectedValue(new Error("R2 down"))
    await run()
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize.mediaUrl).toBe(STITCHED_R2)
    // Chain broken (next extension falls back to the tail), job still correct.
    expect(finalize.extraOutputData.rawExtensionUrl).toBe(KIE_MOV)
  })

  // Independent review round: the raw copy is written after the generation,
  // but only a completed job's output names it — a run that fails after it
  // discards it, or nothing ever would.
  describe("a run that fails after its raw copy discards it", () => {
    function chainWithRawMov(): void {
      mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
      mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
    }

    it.each([
      ["the stitch", () => mocks.mockStitchExtension.mockRejectedValue(new Error("stitch failed"))],
      ["the watermark upload", () => mocks.mockWatermarkLocalVideoAndUpload.mockRejectedValue(new Error("upload failed"))],
      ["the finalize", () => mocks.mockFinalizeJobWithMedia.mockRejectedValue(new Error("finalize failed"))],
    ])("%s fails: the raw copy is discarded, and the job still fails", async (_step, breakIt) => {
      chainWithRawMov()
      breakIt()

      await expect(run()).rejects.toThrow(/failed/)

      expect(mocks.mockDiscardFailedRunCopies).toHaveBeenCalledWith("job-1", "user-1", [R2_MOV])
    })

    it("the generation fails: nothing was copied yet", async () => {
      mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
      mocks.mockImageToVideo.mockRejectedValue(new Error("generation failed"))

      await expect(run()).rejects.toThrow(/generation failed/)

      expect(mocks.mockDiscardFailedRunCopies).toHaveBeenCalledWith("job-1", "user-1", [undefined])
    })

    it("a completed run discards nothing", async () => {
      chainWithRawMov()
      await run()
      expect(mocks.mockDiscardFailedRunCopies).not.toHaveBeenCalled()
    })

    it("a url that is not our copy (KIE's own) is never handed over", async () => {
      // An mp4 result: no copy was made.
      mocks.mockStitchExtension.mockRejectedValue(new Error("stitch failed"))
      await expect(run()).rejects.toThrow(/stitch failed/)
      expect(mocks.mockDiscardFailedRunCopies).toHaveBeenCalledWith("job-1", "user-1", [undefined])
    })
  })
})

describe("kling-4-extend — the tail recipe on Kling 4", () => {
  const runKling = (data: Record<string, unknown> = {}) => run({ provider: "kling-4-extend", ...data })
  const KLING_PROMPT = "Continue @video_1 as one continuous shot, starting exactly where it ends: she opens the door"

  it("a kling-4-extend job generates on kling-4 with a 3 s picture tail and the Kling prompt", async () => {
    await runKling({ duration: 8 })
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith(`${PREP_DIR}/source.mp4`, 3, { measureFrom: "picture" })
    const [imageUrl, model, prompt, duration, endFrame, opts, reconcileOpts] = mocks.mockImageToVideo.mock.calls[0]!
    expect(imageUrl).toBe(LAST_FRAME_URL)
    expect(model).toBe("kling-4")
    expect(prompt).toBe(KLING_PROMPT)
    expect(duration).toBe(8)
    expect(endFrame).toBeUndefined()
    // Deep equality: the tail as @video_1, the source's shape (a 16:9 source
    // snapped to Kling's 16:9), the priced resolution — and no sound switch
    // (Kling 4.0's sound is always on) and no container lever.
    expect(opts).toEqual({ resolution: "720p", referenceVideoUrls: [TAIL_URL], aspectRatio: "16:9" })
    // No KIE task persisted: a reconcile finalize would ship the unstitched extension.
    expect(reconcileOpts).toBeUndefined()
  })

  it("renders its 5 s default when no length is set, and the seconds the route queues", async () => {
    await runKling()
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(5)
    for (const duration of [undefined, 1, 3, 7.6, "12", 30, 45]) {
      mocks.mockImageToVideo.mockClear()
      await runKling({ duration })
      expect(mocks.mockImageToVideo.mock.calls[0]![3], String(duration)).toBe(tailRecipeSeconds("kling-4-extend", duration))
    }
  })

  it("renders 720p or 1080p as sent, and anything else at the 720p it is priced at", async () => {
    for (const [sent, rendered] of [["720p", "720p"], ["1080p", "1080p"], [undefined, "720p"], ["480p", "720p"], ["4k", "720p"]] as const) {
      mocks.mockImageToVideo.mockClear()
      await runKling({ resolution: sent })
      expect(mocks.mockImageToVideo.mock.calls[0]![5], String(sent)).toMatchObject({ resolution: rendered })
    }
  })

  it("a sound switch in the job is not sent (Kling 4.0 has none)", async () => {
    await runKling({ generateAudio: false })
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).not.toHaveProperty("generateAudio")
  })

  it("refuses a source with less than 2 s of picture before any provider call", async () => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 2.2, videoDurationSeconds: 1.9 })
    await expect(runKling()).rejects.toThrow(extendSourceTooShortMessage("kling-4-extend", 1.9))
    expect(mocks.mockImageToVideo).not.toHaveBeenCalled()
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 2, videoDurationSeconds: 2 })
    await runKling()
    expect(mocks.mockImageToVideo).toHaveBeenCalledTimes(1)
  })

  it("a Kling source between 2 and 3 s sends its whole picture as the tail", async () => {
    // Its sound runs past the last frame: the tail is the picture, ending on that frame.
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 2.6, videoDurationSeconds: 2.5 })
    await runKling()
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith(`${PREP_DIR}/source.mp4`, 2.5, { measureFrom: "picture" })
    // The tail is the reference, its last frame the opening frame, as on a longer source.
    const [imageUrl, model, , , , opts] = mocks.mockImageToVideo.mock.calls[0]!
    expect(imageUrl).toBe(LAST_FRAME_URL)
    expect(model).toBe("kling-4")
    expect(opts).toMatchObject({ referenceVideoUrls: [TAIL_URL] })
  })

  it("a source of 3 s or more still sends a 3 s tail", async () => {
    for (const picture of [3, 3.4, 10]) {
      mocks.mockExtractTailToFile.mockClear()
      mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: picture, videoDurationSeconds: picture })
      await runKling()
      expect(mocks.mockExtractTailToFile, String(picture)).toHaveBeenCalledWith(`${PREP_DIR}/source.mp4`, 3, { measureFrom: "picture" })
    }
  })

  it("never looks up a chained mov (that is Seedance 2.5's own chain)", async () => {
    await runKling()
    expect(mocks.mockFindChainedMovReference).not.toHaveBeenCalled()
    expect(mocks.mockCutChainedMovTail).not.toHaveBeenCalled()
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
  })

  it("delivers the extend stitch of source and extension, as its own provider", async () => {
    await runKling()
    expect(mocks.mockCombineVideos).not.toHaveBeenCalled()
    expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
    expect(mocks.mockStitchExtension.mock.calls[0]![0]).toMatchObject({
      sourcePath: `${PREP_DIR}/source.mp4`,
      extensionPath: `${STITCH_DIR}/extension.mp4`,
      workDir: STITCH_DIR,
    })
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize.mediaUrl).toBe(STITCHED_R2)
    expect(finalize.result).toMatchObject({ url: STITCHED_R2, providerUsed: "kling-4-extend" })
  })
})
