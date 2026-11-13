// @test-units-by-name runs only the Extend Video providers it names (Seedance 2.5, Seedance 2.0, Kling 4)
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
//      storage write and no DB read. 2.5 runs the provider guide's recipe
//      (decided 2026-11-12): the source's last 10 s, declared as an extension,
//      no start image, through the text-to-video transport.
//   2. On either model the deliverable is the stitched, watermarked clip (the
//      extend stitch, `stitchExtension`, never combineVideos), and the KIE
//      task is NOT persisted (a reconcile finalize would ship the unstitched
//      extension).
//   3. The mov chain: a 2.5 raw extension is kept as OUR R2 `.mov` object and
//      persisted as `rawExtensionUrl`, so the next extension can reference it
//      in its own container. A KIE temp URL must never be what we persist.
//   4. The next extension sends that clip's last 10 s — the seconds the run
//      sends (cut to a MOV that keeps its pixel format and PCM, uploaded to the
//      job's scratch folder); a mov shorter than them falls back to the tail.
//   5. A 2.5 run settles on the source it measured: (sent + added) ÷ 2 of its
//      resolution's two-second row.
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
  }
})
vi.mock("@/lib/discard-job-copies.js", () => ({ discardFailedRunCopies: mocks.mockDiscardFailedRunCopies }))

import { videoAIHandlers } from "../video-ai.js"
import { TAIL_RECIPES, extendSourceTooShortMessage, extensionTooShortMessage, tailRecipeSeconds } from "../../../lib/extend-recipe.js"
import { extendTailPicture } from "@/providers/video/extend-stitch.js"
import { defaultLaunchPeakMiB } from "@/providers/video/ffmpeg-admission-instance.js"
import type { MatchedProbe } from "@/providers/video/matched-encode.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

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

/** What `probeMatched` reads of the source: its colour decides the tail's picture. */
let sourceProbe: MatchedProbe
/** What the extension's probe (`probeMatchedOrThrow`) reads: 30 s of picture, never short of half the longest run (30 s). */
let extensionProbe: MatchedProbe

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

/** The i2v options the Seedance 2.0 extend transport has sent since the 2026-07-12 spike. */
const OPTIONS_TODAY = {
  resolution: "720p",
  generateAudio: true,
  referenceVideoUrls: [TAIL_URL],
  aspectRatio: "adaptive",
}

/** The t2v options Seedance 2.5 sends: the tail as @video_1, declared as an extension, at "adaptive". */
const OPTIONS_25 = {
  resolution: "720p",
  generateAudio: true,
  referenceVideoUrls: [TAIL_URL],
  aspectRatio: "adaptive",
  referenceTaskType: "extend",
}

/** The generation call of a run, whichever transport its recipe uses: [model, prompt, seconds, options]. */
function generation(): { model: unknown; prompt: unknown; seconds: unknown; options: Record<string, unknown> } {
  const t2v = mocks.mockTextToVideo.mock.calls[0]
  if (t2v) return { model: t2v[1], prompt: t2v[0], seconds: t2v[2], options: t2v[4] }
  const i2v = mocks.mockImageToVideo.mock.calls[0]!
  return { model: i2v[1], prompt: i2v[2], seconds: i2v[3], options: i2v[5] }
}

/** The number of generations a run asked for, on either transport. */
const generations = (): number => mocks.mockTextToVideo.mock.calls.length + mocks.mockImageToVideo.mock.calls.length

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
  mocks.mockTextToVideo.mockResolvedValue({ url: KIE_MP4, cost: 0.2, providerUsed: "kie", kieTaskId: "kie-9" })
  mocks.mockCreateWorkDir.mockImplementation(async (prefix: string) => (prefix === "extend-stitch" ? STITCH_DIR : PREP_DIR))
  mocks.mockCleanupWorkDir.mockResolvedValue(undefined)
  mocks.mockDownloadFile.mockResolvedValue(undefined)
  mocks.mockStitchExtension.mockResolvedValue({ outputPath: STITCHED_PATH, boundary: BOUNDARY })
  mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue(STITCHED_R2)
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/images/thumb.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockDiscardFailedRunCopies.mockResolvedValue(undefined)
  sourceProbe = { width: 1920, height: 1080, videoCodec: "h264" }
  extensionProbe = { width: 1920, height: 1080, videoCodec: "h264", durationSec: 30, videoDurationSec: 30 }
  mocks.mockProbeMatched.mockImplementation(async () => sourceProbe)
  mocks.mockProbeMatchedOrThrow.mockImplementation(async () => extensionProbe)
})

afterEach(() => {
  vi.unstubAllEnvs()
  mocks.priceReadFails.current = false
})

describe("the job's provider picks the model", () => {
  it("a seedance-2-5-extend job generates on seedance-2-5", async () => {
    await run({ provider: "seedance-2-5-extend" })
    expect(generation().model).toBe("seedance-2-5")
  })

  it("a seedance-2-0-extend job generates on seedance-2", async () => {
    await run({ provider: "seedance-2-0-extend" })
    expect(mocks.mockImageToVideo.mock.calls[0]![1]).toBe("seedance-2")
  })

  it("the retired seedance-2-extend runs as seedance-2-5-extend", async () => {
    await run({ provider: "seedance-2-extend" })
    expect(generation().model).toBe("seedance-2-5")
    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(1)
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
      expect(generation().seconds).toBe(8)
    },
  )

  it.each(["seedance-2-5-extend", "seedance-2-0-extend"] as const)(
    "generates the seconds the route queues and the output length records (tailRecipeSeconds, %s)",
    async (provider) => {
      for (const duration of [undefined, 1, 4, 7.6, "12", 15, 16, 25, 30, 45]) {
        mocks.mockImageToVideo.mockClear()
        mocks.mockTextToVideo.mockClear()
        await run({ provider, duration })
        expect(generation().seconds, String(duration)).toBe(tailRecipeSeconds(provider, duration))
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
        mocks.mockTextToVideo.mockClear()
        await run({ provider, resolution: sent })
        expect(generation().options, String(sent)).toMatchObject({ resolution: rendered })
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
      expect(generations()).toBe(1)
      mocks.mockImageToVideo.mockClear()
      mocks.mockTextToVideo.mockClear()
      mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 1.5, videoDurationSeconds: 1.5 })
      await expect(run({ provider })).rejects.toThrow(extendSourceTooShortMessage(provider, 1.5))
      expect(generations()).toBe(0)
    },
  )

  // The cut is the recipe's tail, or all of a shorter picture (`tailCutSec`):
  // the default source here is 6 s, so Seedance 2.5 sends it whole, and a 25 s
  // source sends its last 10 s.
  it.each([["seedance-2-5-extend", 6], ["seedance-2-0-extend", 2]] as const)(
    "cuts the recipe's tail from the picture's end (%s: %s s of a 6 s source)",
    async (provider, seconds) => {
      await run({ provider })
      expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", seconds, { measureFrom: "picture" })
    },
  )

  it("seedance-2-5-extend cuts the last 10 s of a longer source", async () => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 25.2, videoDurationSeconds: 25 })
    await run({ provider: "seedance-2-5-extend" })
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", 10, { measureFrom: "picture" })
  })
})

describe("seedance-2-0-extend — today's transport, unchanged", () => {
  const run20 = (data: Record<string, unknown> = {}) => run({ provider: "seedance-2-0-extend", ...data })

  beforeEach(() => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
  })

  it("same model, same options object, same 4–15s snap", async () => {
    await run20({ duration: 40 })
    expect(mocks.mockTextToVideo).not.toHaveBeenCalled()
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

  it("commits its row: no settlement of its own", async () => {
    await run20()
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]).not.toHaveProperty("meteredBaseCredits")
  })
})

describe("seedance-2-5-extend — the provider guide's recipe", () => {
  it("the source's last 10 s as @video_1, declared as an extension, no start image, the guide's prompt", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
    await run({ duration: 8 })
    expect(mocks.mockImageToVideo).not.toHaveBeenCalled()
    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(1)
    const [prompt, model, seconds, aspect, opts, reconcileOpts] = mocks.mockTextToVideo.mock.calls[0]!
    expect(prompt).toBe("Extend @video_1 forward by 8 seconds: she opens the door")
    expect(model).toBe("seedance-2-5")
    expect(seconds).toBe(8)
    expect(aspect).toBe("adaptive")
    // Deep equality, not a subset: no start image, no `outputFormat` without the lever.
    expect(opts).toEqual(OPTIONS_25)
    expect(reconcileOpts).toBeUndefined()
  })

  it("names the seconds it adds in the prompt", async () => {
    await run({ duration: 24 })
    expect(mocks.mockTextToVideo.mock.calls[0]![0]).toBe("Extend @video_1 forward by 24 seconds: she opens the door")
    expect(mocks.mockTextToVideo.mock.calls[0]![2]).toBe(24)
  })

  it("takes no last frame: only the tail goes to the job's scratch folder", async () => {
    await run()
    expect(mocks.mockExtractFrame).not.toHaveBeenCalled()
    expect(mocks.mockUploadJobScratchFile.mock.calls).toEqual([
      ["/tmp/test-workdir/source.mp4.tail.mp4", "extend-tail", "mp4", "video/mp4", "job-1"],
    ])
  })

  it("user references ride as @image_1…N beside the tail, and nothing else", async () => {
    const refs = ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"]
    await run({ referenceImageUrls: refs })
    expect(mocks.mockTextToVideo.mock.calls[0]![4]).toEqual({ ...OPTIONS_25, referenceImageUrls: refs })
  })

  it("snaps into ITS 4–30s window", async () => {
    await run({ duration: 24 })
    expect(generation()).toMatchObject({ model: "seedance-2-5", seconds: 24 })
  })

  it("clamps above 30", async () => {
    await run({ duration: 45 })
    expect(generation().seconds).toBe(30)
  })

  it("clamps below 4", async () => {
    await run({ duration: 1 })
    expect(generation().seconds).toBe(4)
  })

  it("without the container lever, no output_format is requested", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
    await run()
    expect(generation().options).toEqual(OPTIONS_25)
  })

  it("with the container lever, asks KIE for mov", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    await run()
    expect(generation().options).toEqual({ ...OPTIONS_25, outputFormat: "mov" })
  })

  it("STILL persists no KIE task — the reconcile cron must never ship the raw extension", async () => {
    await run()
    expect(mocks.mockTextToVideo.mock.calls[0]![5]).toBeUndefined()
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

  // Charged per second sent and added, on the source measured here: a hold
  // made without the source's length (the whole 10 s window) settles down to it.
  it.each([
    // [picture, container, seconds added, resolution, base]
    [6, 6, 8, "720p", 1330], // (6 + 8) ÷ 2 × 190
    [25, 25.2, 8, "720p", 1710], // the last 10 s: (10 + 8) ÷ 2 × 190
    [2, 2.3, 8, "720p", 950], // a 2 s source: (2 + 8) ÷ 2 × 190
    [4.37, 4.5, 5, "480p", 399], // ceil((4.37 + 5) ÷ 2 × 85) = ceil(398.225)
    [12, 12, 30, "1080p", 9500], // (10 + 30) ÷ 2 × 475
    // The container-overhang rule: 8.04 s is charged as 8 s, 8.3 s as 8.3 s.
    [8.04, 8.1, 8, "720p", 1520], // (8 + 8) ÷ 2 × 190
    [8.3, 8.4, 8, "720p", 1549], // ceil((8.3 + 8) ÷ 2 × 190) = ceil(1548.5)
  ] as const)("settles a %s s picture (container %s s) + %s s at %s on its measured seconds: base %s", async (picture, container, duration, resolution, base) => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: container, videoDurationSeconds: picture })
    await run({ duration, resolution })
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].meteredBaseCredits).toBe(base)
  })

  it("a price that cannot be read commits the hold as made: the run still completes", async () => {
    mocks.priceReadFails.current = true
    await run()
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize).not.toHaveProperty("meteredBaseCredits")
    expect(finalize.mediaUrl).toBe(STITCHED_R2)
  })

  it("the retired seedance-2-extend settles as Seedance 2.5", async () => {
    await run({ provider: "seedance-2-extend" })
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].meteredBaseCredits).toBe(1330)
  })

  // The route and a workflow run put the source length the hold was priced on
  // in the job (`sourcePictureSec`): a link that serves a longer file now than
  // it answered then is sent, and settled on, only what was held.
  it("sends and settles no more of the source than its hold was priced on", async () => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 30, videoDurationSeconds: 30 })
    await run({ sourcePictureSec: 2 })
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", 2, { measureFrom: "picture" })
    // (2 + 8) ÷ 2 × 190: what the hold was priced at.
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].meteredBaseCredits).toBe(950)
  })

  it("a held length longer than the file it downloads sends, and settles on, the file's own picture", async () => {
    await run({ sourcePictureSec: 9 })
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", 6, { measureFrom: "picture" })
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].meteredBaseCredits).toBe(1330)
  })

  it("a held length under the shortest source a run takes is refused before any provider call", async () => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 30, videoDurationSeconds: 30 })
    await expect(run({ sourcePictureSec: 1.5 })).rejects.toThrow(extendSourceTooShortMessage("seedance-2-5-extend", 1.5))
    expect(generations()).toBe(0)
  })

  it.each([undefined, null, 0, -3, "2", Number.NaN])("a held length that is not one (%s) is not read: the downloaded picture is sent", async (held) => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 25, videoDurationSeconds: 25 })
    await run({ sourcePictureSec: held })
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", 10, { measureFrom: "picture" })
  })

  it.each(["seedance-2-0-extend", "kling-4-extend"] as const)("%s reads no held length: it is priced on its own rows", async (provider) => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 30, videoDurationSeconds: 30 })
    await run({ provider, sourcePictureSec: 1 })
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", TAIL_RECIPES[provider].tailSec, { measureFrom: "picture" })
  })
})

describe("the extend stitch, on every Seedance provider", () => {
  it.each(["seedance-2-5-extend", "seedance-2-0-extend", "seedance-2-extend"])(
    "stitches with stitchExtension, never combineVideos (%s)",
    async (provider) => {
      await run({ provider })
      expect(mocks.mockCombineVideos).not.toHaveBeenCalled()
      expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
      // The source is downloaded once, for the tail; the stitch reads that copy.
      expect(mocks.mockDownloadFile.mock.calls.filter(([url]) => url === SOURCE_URL)).toHaveLength(1)
    },
  )

  it("Seedance 2.0: the smart cut, the fixed trims as its fallback, the sound crossfaded", async () => {
    await run({ provider: "seedance-2-0-extend" })
    expect(mocks.mockStitchExtension).toHaveBeenCalledWith({
      sourcePath: `${PREP_DIR}/source.mp4`,
      extensionPath: `${STITCH_DIR}/extension.mp4`,
      workDir: STITCH_DIR,
      smartCut: { framesFromPrev: 8, framesFromNext: 8 },
      fallbackTrims: { trimEndFrames: 4, trimStartFrames: 3 },
      audioFadeSec: 0.15,
    })
  })

  // A declared extension is new footage only: nothing at the join repeats, so
  // nothing is searched for or trimmed — a hard cut at the source's end.
  it.each(["seedance-2-5-extend", "seedance-2-extend"])("Seedance 2.5: no smart cut, nothing trimmed, the sound crossfaded (%s)", async (provider) => {
    await run({ provider })
    expect(mocks.mockStitchExtension).toHaveBeenCalledWith({
      sourcePath: `${PREP_DIR}/source.mp4`,
      extensionPath: `${STITCH_DIR}/extension.mp4`,
      workDir: STITCH_DIR,
      fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 },
      audioFadeSec: 0.15,
    })
  })

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

// An extension whose picture is shorter than half the seconds the run is billed for fails the
// run, final on this attempt and refunded in full: neither the source alone nor the source with
// the short extension is delivered. It is measured before the stitch encodes anything.
describe("a short extension fails the run with a full refund", () => {
  const TAIL_PROVIDERS = ["seedance-2-5-extend", "seedance-2-0-extend", "kling-4-extend"] as const
  const withPicture = (seconds: number, containerSec = seconds): void => {
    extensionProbe = { width: 1920, height: 1080, videoCodec: "h264", durationSec: containerSec, videoDurationSec: seconds }
  }

  it.each(TAIL_PROVIDERS)("%s: a 5 s run whose extension has 2.0 s of picture fails with the message; nothing is stitched or delivered", async (provider) => {
    withPicture(2)
    const failure = await run({ provider, duration: 5 }).then(() => undefined, (err: unknown) => err)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(extensionTooShortMessage(2, 5))
    expect((failure as Error).message).toBe("The model returned only 2.0s of the 5s extension, so nothing was charged. Try again.")
    // Final now (failed and refunded on this attempt), never retried into a second generation.
    expect(isDeterministicJobError(failure)).toBe(true)
    // Measured on the extension's own download, before the stitch.
    expect(mocks.mockProbeMatchedOrThrow).toHaveBeenCalledWith(`${STITCH_DIR}/extension.mp4`)
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
    expect(mocks.mockWatermarkLocalVideoAndUpload).not.toHaveBeenCalled()
    expect(mocks.mockGenerateAndUploadThumbnail).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
    // Both folders are still removed.
    const cleanups = mocks.mockCleanupWorkDir.mock.calls.map((c) => c[0])
    expect(cleanups).toContain(PREP_DIR)
    expect(cleanups).toContain(STITCH_DIR)
  })

  it.each(TAIL_PROVIDERS)("%s: a 5 s run whose extension has 2.5 s of picture (exactly half) is stitched and delivered", async (provider) => {
    withPicture(2.5)
    await run({ provider, duration: 5 })
    expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].mediaUrl).toBe(STITCHED_R2)
  })

  it("reads the picture's length, not the container's (the sound may run past the last frame)", async () => {
    withPicture(3, 8)
    await expect(run({ duration: 8 })).rejects.toThrow(extensionTooShortMessage(3, 8))
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
  })

  it("a file that was read and has no video stream fails the same way, final", async () => {
    extensionProbe = { audioCodec: "aac", durationSec: 8 }
    const failure = await run({ duration: 8 }).then(() => undefined, (err: unknown) => err)
    expect((failure as Error).message).toBe(extensionTooShortMessage(undefined, 8))
    expect(isDeterministicJobError(failure)).toBe(true)
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
  })

  // A probe that failed says nothing about the extension's length: a plain error the queue
  // retries, never the short-extension refusal (and never final on this attempt).
  it.each([
    ["timed out", () => Object.assign(new Error("ffprobe failed: killed"), { killed: true, timedOut: true })],
    ["could not start", () => Object.assign(new Error("ffprobe failed: spawn ffprobe ENOENT"), { code: "ENOENT" })],
    ["could not read the file", () => new Error("ffprobe failed: /tmp/extend-stitch-x/extension.mp4: Invalid data found when processing input")],
  ])("a probe that %s fails the run as a plain, retryable error, not the short-extension message", async (_case, makeError) => {
    mocks.mockProbeMatchedOrThrow.mockRejectedValue(makeError())
    const failure = await run({ duration: 5 }).then(() => undefined, (err: unknown) => err)
    expect(failure).toBeInstanceOf(Error)
    expect(isDeterministicJobError(failure)).toBe(false)
    expect((failure as Error).message).not.toMatch(/The model returned only/)
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  // No duration in the job: the run is billed for the provider's default (Kling 4: 5 s,
  // Seedance: 8 s), and the extension is held to half of that.
  it("with no duration set, holds the extension to half the provider's default", async () => {
    withPicture(2.4)
    await expect(run({ provider: "kling-4-extend" })).rejects.toThrow(
      "The model returned only 2.4s of the 5s extension, so nothing was charged. Try again.",
    )
    withPicture(3.9)
    await expect(run({ provider: "seedance-2-0-extend" })).rejects.toThrow(
      "The model returned only 3.9s of the 8s extension, so nothing was charged. Try again.",
    )
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
    // Half of each default passes.
    withPicture(2.5)
    await run({ provider: "kling-4-extend" })
    withPicture(4)
    await run({ provider: "seedance-2-0-extend" })
    expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(2)
  })

  it("a short mov extension's raw copy is discarded, the run still failing", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    // Seedance 2.5 generates through the text-to-video transport (no start image).
    mocks.mockTextToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
    withPicture(1)
    await expect(run({ duration: 5 })).rejects.toThrow(extensionTooShortMessage(1, 5))
    expect(mocks.mockProbeMatchedOrThrow).toHaveBeenCalledWith(`${STITCH_DIR}/extension.mov`)
    expect(mocks.mockDiscardFailedRunCopies).toHaveBeenCalledWith("job-1", "user-1", [R2_MOV])
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
  })
})

// An HDR source (an iPhone's HLG, an HDR10 file's PQ) is delivered in SDR BT.709, so the
// model is sent its tail (and, on Seedance 2.0, the last frame taken from it) in that same SDR picture.
describe("seedance extend — an HDR source's generation inputs", () => {
  const HLG = {
    width: 1920, height: 1080, videoCodec: "hevc", pixFmt: "yuv420p10le",
    colorPrimaries: "bt2020", colorTransfer: "arib-std-b67", colorSpace: "bt2020nc", colorRange: "tv",
  }

  it.each([["seedance-2-5-extend", 6], ["seedance-2-0-extend", 2]] as const)("%s: cuts the tail through the stitch's SDR conversion (%s s of a 6 s source)", async (provider, seconds) => {
    sourceProbe = HLG
    await run({ provider })

    expect(mocks.mockProbeMatched).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4")
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledTimes(1)
    const [path, cut, opts] = mocks.mockExtractTailToFile.mock.calls[0]!
    expect([path, cut]).toEqual(["/tmp/test-workdir/source.mp4", seconds])
    expect(opts).toEqual({ measureFrom: "picture", ...extendTailPicture(HLG) })
    expect(opts.pictureFilter).toContain("setparams=color_primaries=bt2020:color_trc=arib-std-b67:")
    expect(opts.pictureFilter).toContain("tonemap=tonemap=hable")
    expect(opts.launch.peakMemoryMiB).toBeGreaterThan(0)
    expect(generation().options).toMatchObject({ referenceVideoUrls: [TAIL_URL] })
  })

  it("seedance-2-0-extend: the last frame comes from that converted tail, and is the start image", async () => {
    sourceProbe = HLG
    await run({ provider: "seedance-2-0-extend" })
    expect(mocks.mockExtractFrame).toHaveBeenCalledWith({ videoUrl: TAIL_URL, mode: "last" })
    expect(mocks.mockImageToVideo.mock.calls[0]![0]).toBe(LAST_FRAME_URL)
  })

  it("cuts a chained 2.5 MOV reference exactly as before: Seedance made that clip in SDR", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    sourceProbe = HLG
    mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
    await run()

    expect(mocks.mockCutChainedMovTail).toHaveBeenCalledTimes(1)
    // No HDR conversion of its own; the cut is the seconds the run sends (all of this 6 s source).
    expect(mocks.mockCutChainedMovTail.mock.calls[0]).toEqual([CHAINED_MOV, 6, PREP_DIR, { coverSec: 6 }])
    expect(generation().options).toMatchObject({ referenceVideoUrls: [CHAIN_CUT_URL] })
  })

  it("cuts an SDR or untagged source's tail at or below 1080p exactly as before", async () => {
    for (const probe of [{ width: 1920, height: 1080 }, { width: 1920, height: 1080, videoCodec: "h264", colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709" }]) {
      mocks.mockExtractTailToFile.mockClear()
      sourceProbe = probe
      await run()
      // The default 6 s source: Seedance 2.5 cuts all of it (`tailCutSec`).
      expect(mocks.mockExtractTailToFile.mock.calls).toEqual([["/tmp/test-workdir/source.mp4", 6, { measureFrom: "picture" }]])
    }
  })

  // The tail cut re-encodes the source's picture: a 4K one (or one whose size is not read) is
  // admitted at a 4K estimate, above the default, with no filter of its own.
  it("admits a 4K SDR source's tail cut, or one whose size is not read, at its size's estimate", async () => {
    for (const probe of [{ width: 3840, height: 2160, videoCodec: "h264", colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709" }, {}]) {
      mocks.mockExtractTailToFile.mockClear()
      sourceProbe = probe
      await run()
      const [path, cut, opts] = mocks.mockExtractTailToFile.mock.calls[0]!
      expect([path, cut]).toEqual(["/tmp/test-workdir/source.mp4", 6])
      expect(opts).toEqual({ measureFrom: "picture", ...extendTailPicture(probe) })
      expect(opts.pictureFilter).toBeUndefined()
      expect(opts.launch.peakMemoryMiB).toBeGreaterThan(defaultLaunchPeakMiB())
    }
  })
})

describe("seedance-2-5-extend — the mov reference chain", () => {
  beforeEach(() => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
  })

  it("no prior mov ⇒ the tail, exactly as today, and nothing cut", async () => {
    mocks.mockFindChainedMovReference.mockResolvedValue(undefined)
    await run()
    expect(mocks.mockFindChainedMovReference).toHaveBeenCalledWith(SOURCE_URL, "user-1")
    expect(mocks.mockCutChainedMovTail).not.toHaveBeenCalled()
    expect(generation().options).toMatchObject({ referenceVideoUrls: [TAIL_URL] })
  })

  it("a chained 2.5 extend sends the previous MOV's last 10 s, covering the seconds the run sends", async () => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 18, videoDurationSeconds: 18 })
    mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
    await run()

    // Cut from the previous raw mov, into the run's own work dir: the last 10 s,
    // which must hold all 10 s the run sends (an 18 s source sends 10)…
    expect(mocks.mockCutChainedMovTail).toHaveBeenCalledWith(CHAINED_MOV, 10, PREP_DIR, { coverSec: 10 })
    // …uploaded to the job's scratch folder, as a mov…
    expect(mocks.mockUploadJobScratchFile).toHaveBeenCalledWith(CHAIN_CUT_PATH, "extend-chain-tail", "mov", "video/quicktime", "job-1")
    // …and that cut is the generation's @video_1.
    expect(generation().options).toMatchObject({ referenceVideoUrls: [CHAIN_CUT_URL] })
    // The whole clip is copied nowhere (an mp4 result: no raw copy either).
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
    // Cut BEFORE the generation reads it.
    expect(mocks.mockCutChainedMovTail.mock.invocationCallOrder[0]!).toBeLessThan(mocks.mockTextToVideo.mock.invocationCallOrder[0]!)
    // The cut lives in the job's scratch folder, emptied when the job ends: nothing to name in the output.
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData.chainReferenceUrl).toBeUndefined()
  })

  it("the chained cut is the seconds the run sends: a held length shorter than the source included", async () => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 18, videoDurationSeconds: 18 })
    mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
    await run({ sourcePictureSec: 6 })
    expect(mocks.mockCutChainedMovTail).toHaveBeenCalledWith(CHAINED_MOV, 6, PREP_DIR, { coverSec: 6 })
  })

  it("a failed cut (a mov shorter than the seconds sent, an expired clip) falls back to the tail, still completing", async () => {
    mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
    mocks.mockCutChainedMovTail.mockRejectedValue(new Error("chained mov holds 8.000s of picture, less than the 10.000s the run sends"))
    await run()

    expect(generation().options).toMatchObject({ referenceVideoUrls: [TAIL_URL] })
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].mediaUrl).toBe(STITCHED_R2)
  })

  it("a mov result is stored as OUR R2 .mov and persisted — never KIE's expiring URL", async () => {
    mocks.mockTextToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
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
    mocks.mockTextToVideo.mockResolvedValue({ url: KIE_MP4, cost: 0.3 })
    await run()
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData).toMatchObject({
      rawExtensionUrl: KIE_MP4,
    })
  })

  it("a failed mov copy does NOT fail the job — the deliverable is the stitch", async () => {
    mocks.mockTextToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
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
      mocks.mockTextToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
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
      mocks.mockTextToVideo.mockRejectedValue(new Error("generation failed"))

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
