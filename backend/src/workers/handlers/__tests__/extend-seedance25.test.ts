import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// seedance-2-extend on Seedance 2.5 (SEEDANCE_EXTEND_GENERATION_MODEL).
//
// The contract this file exists to pin, in order of importance:
//   1. LEVER OFF ⇒ byte-identical to today. Same model, same options object
//      (deep-equal, no stray keys), same 4–15s snap, same persisted
//      `rawExtensionUrl` (KIE's own URL), no extra storage write, no DB read.
//   2. LEVER ON ⇒ the generation moves to 2.5 and nothing else does: the
//      deliverable is still the stitched, watermarked mp4, and the KIE task is
//      still NOT persisted (a reconcile finalize would ship the unstitched
//      extension).
//   3. The mov chain: a 2.5 raw extension is kept as OUR R2 `.mov` object and
//      persisted as `rawExtensionUrl`, so the next extension can reference it
//      un-transcoded. A KIE temp URL must never be what we persist for that.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockTextToVideo: vi.fn(),
  mockImageToVideo: vi.fn(),
  mockCombineVideos: vi.fn(),
  mockProbeVideoSource: vi.fn(),
  mockExtractTailToFile: vi.fn(),
  mockExtractFrame: vi.fn(),
  mockUploadFileToR2: vi.fn(),
  mockUploadToR2: vi.fn(),
  mockFindChainedMovReference: vi.fn(),
  mockFinalizeJobWithMedia: vi.fn(),
  mockWatermarkLocalVideoAndUpload: vi.fn(),
  mockGenerateAndUploadThumbnail: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))

vi.mock("@/lib/storage.js", () => ({
  mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}`,
  uploadToR2: mocks.mockUploadToR2,
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/buf.mp4"),
  uploadFileToR2: mocks.mockUploadFileToR2,
}))

vi.mock("@/lib/seedance-extend-mov-chain.js", () => ({
  findChainedMovReference: mocks.mockFindChainedMovReference,
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

vi.mock("@/providers/video/combine-videos.js", () => ({ combineVideos: mocks.mockCombineVideos }))
vi.mock("@/providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: vi.fn() }))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/test-workdir"),
  downloadFile: vi.fn().mockResolvedValue(undefined),
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

import { videoAIHandlers } from "../video-ai.js"

const SOURCE_URL = "https://r2.example.com/videos/prev-job.mp4"
const KIE_MP4 = "https://kie.example.com/extension.mp4"
const KIE_MOV = "https://kie.example.com/extension.mov?token=abc"
const R2_MOV = "https://r2.example.com/videos/9f2c-raw.mov"
const CHAINED_MOV = "https://r2.example.com/videos/aaaa-raw.mov"
const TAIL_URL = "https://r2.example.com/videos/tail-uuid.mp4"
const LAST_FRAME_URL = "https://r2.example.com/images/frame-uuid.png"
const STITCHED_PATH = "/tmp/combine-abc/output.mp4"
const STITCHED_R2 = "https://r2.example.com/videos/job-1.mp4"

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "extend-video",
    data: {
      jobId: "job-1",
      provider: "seedance-2-extend",
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
  mocks.mockUploadFileToR2.mockResolvedValueOnce(TAIL_URL).mockResolvedValueOnce(LAST_FRAME_URL)
  mocks.mockUploadToR2.mockResolvedValue(R2_MOV)
  mocks.mockFindChainedMovReference.mockResolvedValue(undefined)
  mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MP4, cost: 0.2, providerUsed: "kie", kieTaskId: "kie-9" })
  mocks.mockCombineVideos.mockResolvedValue({ outputPath: STITCHED_PATH })
  mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue(STITCHED_R2)
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/images/thumb.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("lever OFF — byte-identical to today", () => {
  beforeEach(() => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", undefined as unknown as string)
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
  })

  it("same model, same options object, same 4–15s snap", async () => {
    await handler()(makeJob({ duration: 40 }) as never, ctx as never)
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

  it("never looks up a chained mov and never writes an extra R2 object", async () => {
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockFindChainedMovReference).not.toHaveBeenCalled()
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
  })

  it("persists KIE's own URL as rawExtensionUrl, exactly as today", async () => {
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData).toMatchObject({
      rawExtensionUrl: KIE_MP4,
    })
  })

  it("even with KIE_SEEDANCE_25_OUTPUT_FORMAT=mov, a 2.0 dispatch is untouched", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    await handler()(makeJob() as never, ctx as never)
    const [, provider, , , , opts] = mocks.mockImageToVideo.mock.calls[0]!
    expect(provider).toBe("seedance-2")
    expect(opts).toEqual(OPTIONS_TODAY)
  })
})

describe("lever ON — generation moves to 2.5", () => {
  beforeEach(() => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
  })

  it("dispatches on seedance-2-5 and snaps into ITS 4–30s window", async () => {
    await handler()(makeJob({ duration: 24 }) as never, ctx as never)
    const [, provider, , duration] = mocks.mockImageToVideo.mock.calls[0]!
    expect(provider).toBe("seedance-2-5")
    expect(duration).toBe(24)
  })

  it("clamps above 30 and below 4", async () => {
    await handler()(makeJob({ duration: 45 }) as never, ctx as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(30)
    vi.clearAllMocks()
    mocks.mockUploadFileToR2.mockResolvedValueOnce(TAIL_URL).mockResolvedValueOnce(LAST_FRAME_URL)
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 6 })
    mocks.mockExtractTailToFile.mockResolvedValue("/tmp/test-workdir/source.mp4.tail.mp4")
    mocks.mockExtractFrame.mockResolvedValue({ imagePath: "/tmp/extract-frame-x/frame.png" })
    mocks.mockFindChainedMovReference.mockResolvedValue(undefined)
    mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MP4, cost: 0.2 })
    mocks.mockCombineVideos.mockResolvedValue({ outputPath: STITCHED_PATH })
    mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue(STITCHED_R2)
    mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
    await handler()(makeJob({ duration: 1 }) as never, ctx as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(4)
  })

  it("without the container lever, no output_format is requested", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toEqual(OPTIONS_TODAY)
  })

  it("with the container lever, asks KIE for mov", async () => {
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toEqual({ ...OPTIONS_TODAY, outputFormat: "mov" })
  })

  it("STILL persists no KIE task — the reconcile cron must never ship the raw extension", async () => {
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![6]).toBeUndefined()
  })

  it("the deliverable path is unchanged: stitch source+extension, watermark, finalize", async () => {
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockCombineVideos).toHaveBeenCalledTimes(1)
    expect(mocks.mockCombineVideos.mock.calls[0]![0]).toMatchObject({
      videoUrls: [SOURCE_URL, KIE_MP4],
      transition: "cut",
    })
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(STITCHED_PATH, "job-1", "user-1", false)
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize.mediaUrl).toBe(STITCHED_R2)
    expect(finalize.result).toMatchObject({ url: STITCHED_R2, providerUsed: "seedance-2-extend" })
  })
})

describe("lever ON — the mov reference chain", () => {
  beforeEach(() => {
    vi.stubEnv("SEEDANCE_EXTEND_GENERATION_MODEL", "seedance-2-5")
    vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", "mov")
  })

  it("no prior mov ⇒ the 2s tail, exactly as today", async () => {
    mocks.mockFindChainedMovReference.mockResolvedValue(undefined)
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockFindChainedMovReference).toHaveBeenCalledWith(SOURCE_URL, "user-1")
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toMatchObject({ referenceVideoUrls: [TAIL_URL] })
  })

  it("a prior mov ⇒ referenced un-transcoded instead of the re-encoded tail", async () => {
    mocks.mockFindChainedMovReference.mockResolvedValue(CHAINED_MOV)
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![5]).toMatchObject({ referenceVideoUrls: [CHAINED_MOV] })
  })

  it("a mov result is stored as OUR R2 .mov and persisted — never KIE's expiring URL", async () => {
    mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
    await handler()(makeJob() as never, ctx as never)

    expect(mocks.mockUploadToR2).toHaveBeenCalledTimes(1)
    const [srcUrl, keyId, type, userId, opts] = mocks.mockUploadToR2.mock.calls[0]!
    expect(srcUrl).toBe(KIE_MOV)
    expect(type).toBe("video")
    expect(userId).toBe("user-1")
    expect(opts).toEqual({ ext: "mov" })
    // A throwaway key: the job's own key is reserved for the deliverable, and
    // reusing it would let this object masquerade as the result.
    expect(keyId).not.toBe("job-1")
    expect(keyId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)

    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData).toMatchObject({
      rawExtensionUrl: R2_MOV,
    })
  })

  it("an mp4 result (KIE ignored the field) falls back to today's persistence", async () => {
    mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MP4, cost: 0.3 })
    await handler()(makeJob() as never, ctx as never)
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData).toMatchObject({
      rawExtensionUrl: KIE_MP4,
    })
  })

  it("a failed mov copy does NOT fail the job — the deliverable is the stitch", async () => {
    mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.3 })
    mocks.mockUploadToR2.mockRejectedValue(new Error("R2 down"))
    await handler()(makeJob() as never, ctx as never)
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize.mediaUrl).toBe(STITCHED_R2)
    // Chain broken (next extension falls back to the tail), job still correct.
    expect(finalize.extraOutputData.rawExtensionUrl).toBe(KIE_MOV)
  })
})
