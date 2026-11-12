import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// The Seedance extend worker branch, on Seedance 2.0 (seedance-2-0-extend):
// bare-template continuation generation via the seedance-2 reference-video
// transport + the extend stitch (`stitchExtension`: the source's size, frame
// rate and quality; never combineVideos). Template phrasing, trim counts,
// and "stitch failure = job failure" are all spike-validated invariants —
// these tests pin them. The Seedance 2.5 provider and the mov chain:
// extend-seedance25.test.ts.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockTextToVideo = vi.fn()
  const mockImageToVideo = vi.fn()
  const mockCombineVideos = vi.fn()
  const mockStitchExtension = vi.fn()
  const mockCreateWorkDir = vi.fn()
  const mockCleanupWorkDir = vi.fn()
  const mockDownloadFile = vi.fn()
  const mockProbeVideoSource = vi.fn()
  const mockExtractTailToFile = vi.fn().mockResolvedValue("/tmp/test-workdir/source.mp4.tail.mp4")
  const mockExtractFrame = vi.fn().mockResolvedValue({ imagePath: "/tmp/extract-frame-x/frame.png" })
  const mockUploadJobScratchFile = vi.fn()

  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockFinalizeJobWithMedia = vi.fn().mockResolvedValue({ ok: true })
  const mockUploadVideoMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  const mockWatermarkLocalVideoAndUpload = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
  const mockSetJobProgress = vi.fn(async () => {})

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockTextToVideo,
    mockImageToVideo,
    mockCombineVideos,
    mockStitchExtension,
    mockCreateWorkDir,
    mockCleanupWorkDir,
    mockDownloadFile,
    mockProbeVideoSource,
    mockExtractTailToFile,
    mockExtractFrame,
    mockUploadJobScratchFile,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockFinalizeJobWithMedia,
    mockUploadVideoMaybeWatermark,
    mockWatermarkLocalVideoAndUpload,
    mockGenerateAndUploadThumbnail,
    mockSetJobProgress,
    mockFrom,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/lib/storage.js", () => ({
  mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}`,
  uploadToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/raw.mp4"),
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/buf.mp4"),
}))
// The tail and the last frame are provider inputs: the job's scratch folder (decided 2026-10-09).
vi.mock("@/lib/job-scratch.js", () => ({ uploadJobScratchFile: mocks.mockUploadJobScratchFile }))

vi.mock("@/providers/video/extract-tail.js", () => ({
  extractTailToFile: mocks.mockExtractTailToFile,
}))

vi.mock("@/providers/video/extract-frame.js", () => ({
  extractFrame: mocks.mockExtractFrame,
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: mocks.mockTextToVideo,
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
}))

// Kept mocked so a regression back to the general combine is caught, never run.
vi.mock("@/providers/video/combine-videos.js", () => ({
  combineVideos: mocks.mockCombineVideos,
}))

// The tail's picture rule is the real one (`extendTailPicture`); the stitch itself is mocked.
vi.mock("@/providers/video/extend-stitch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/extend-stitch.js")>()),
  stitchExtension: mocks.mockStitchExtension,
}))
// The source's colour probe: an SDR source, so its tail is cut exactly as it always was.
vi.mock("@/providers/video/matched-encode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/matched-encode.js")>()),
  probeMatched: vi.fn(async () => ({ width: 1920, height: 1080, videoCodec: "h264" })),
}))

vi.mock("@/providers/video/merge-video-audio.js", () => ({
  mergeVideoAudio: vi.fn(),
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  createWorkDir: mocks.mockCreateWorkDir,
  downloadFile: mocks.mockDownloadFile,
  stripAudio: vi.fn().mockResolvedValue(undefined),
  probeVideoSource: mocks.mockProbeVideoSource,
}))

// KIE clients: keep the legacy veo/runway extend paths inert so a regression
// that routes seedance into them fails loudly instead of hitting the network.
vi.mock("@/providers/kie/client.js", () => ({
  runVeoExtendTask: vi.fn(),
  runVeo1080pTask: vi.fn(),
  runVeo4kTask: vi.fn(),
}))

vi.mock("@/providers/kie/runway-client.js", () => ({
  runRunwayExtendTask: vi.fn(),
}))

vi.mock("@/providers/kie/video.js", () => ({
  KieVideoProvider: class {},
}))

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: mocks.mockCommitJobCredits,
    shouldSaveJobResult: mocks.mockShouldSaveJobResult,
    markJobCompleted: mocks.mockMarkJobCompleted,
    uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
    watermarkLocalVideoAndUpload: mocks.mockWatermarkLocalVideoAndUpload,
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: mocks.mockSetJobProgress,
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia,
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { videoAIHandlers } from "../video-ai.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_URL = "https://cdn.example.com/source.mp4"
const EXTENSION_URL = "https://kie.example.com/extension.mp4"
/** The prep folder: the source's local copy, its tail and its last frame. */
const PREP_DIR = "/tmp/test-workdir"
/** The stitch's own folder: the extension's download, the stitch's proxies, passes and result. */
const STITCH_DIR = "/tmp/extend-stitch-x"
const STITCHED_PATH = `${STITCH_DIR}/stitched.mp4`
/** A matched boundary, as `stitchExtension` reports it. */
const BOUNDARY = { matched: true, psnrDb: 41.27, trimEndFrames: 2, trimStartFrames: 3, searchedPrevFrames: 8, searchedNextFrames: 8 }
const TAIL_URL = "https://r2.example.com/tmp/provider-input/job-1/extend-tail-aaaaaaaa.mp4"
const LAST_FRAME_URL = "https://r2.example.com/tmp/provider-input/job-1/extend-last-frame-bbbbbbbb.png"

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "extend-video",
    data: {
      jobId: "job-1",
      provider: "seedance-2-0-extend",
      video: SOURCE_URL,
      prompt: "the ball keeps rolling until it hits a cup",
      ...data,
    },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobUserId: "user-1",
    usageLogId: "usage-1",
    shouldWatermark: false,
    ...overrides,
  }
}

const handler = () => videoAIHandlers["extend-video"]!

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 4.0 })
  mocks.mockImageToVideo.mockResolvedValue({
    url: EXTENSION_URL,
    cost: 0.2,
    displayCost: 0.25,
    providerUsed: "kie",
    kieTaskId: "kie-task-9",
  })
  mocks.mockExtractTailToFile.mockResolvedValue("/tmp/test-workdir/source.mp4.tail.mp4")
  mocks.mockExtractFrame.mockResolvedValue({ imagePath: "/tmp/extract-frame-x/frame.png" })
  // First upload = the tail video, second = the last-frame image.
  mocks.mockUploadJobScratchFile.mockResolvedValueOnce(TAIL_URL).mockResolvedValueOnce(LAST_FRAME_URL)
  mocks.mockCreateWorkDir.mockImplementation(async (prefix: string) => (prefix === "extend-stitch" ? STITCH_DIR : PREP_DIR))
  mocks.mockCleanupWorkDir.mockResolvedValue(undefined)
  mocks.mockDownloadFile.mockResolvedValue(undefined)
  mocks.mockStitchExtension.mockResolvedValue({ outputPath: STITCHED_PATH, boundary: BOUNDARY })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extend-video / seedance-2-0-extend", () => {
  it("generates via i2v: last-frame anchor + 2s tail reference + the EXACT extend template", async () => {
    await handler()(makeJob({ duration: 6, resolution: "480p", generateAudio: false }) as never, makeCtx() as never)

    // Prep: tail extracted from the downloaded source at the recipe's tail
    // length (2s — KIE rejects r2v reference videos under 1.8s), then
    // uploaded; the frame-exact extractor reads the tail's R2 copy (its last
    // frame IS the source's last frame).
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", 2, { measureFrom: "picture" })
    expect(mocks.mockExtractFrame).toHaveBeenCalledWith({ videoUrl: TAIL_URL, mode: "last" })

    expect(mocks.mockImageToVideo).toHaveBeenCalledTimes(1)
    expect(mocks.mockTextToVideo).not.toHaveBeenCalled()
    const [imageUrl, provider, prompt, duration, endFrameUrl, opts, reconcileOpts] = mocks.mockImageToVideo.mock.calls[0]!
    // Spike-validated (2026-07-12): the extension must be anchored on the
    // source's last frame and reference ONLY the last moments (2s tail).
    expect(imageUrl).toBe(LAST_FRAME_URL)
    expect(provider).toBe("seedance-2")
    expect(prompt).toBe("extend @video_1 as follows:\nthe ball keeps rolling until it hits a cup")
    expect(duration).toBe(6)
    expect(endFrameUrl).toBeUndefined()
    expect(opts).toMatchObject({
      referenceVideoUrls: [TAIL_URL],
      resolution: "480p",
      generateAudio: false,
      // Native token (live-verified to adopt the ref video's ratio) — no
      // ffprobe round-trip; see source-matched-aspect.test.ts for fallbacks.
      aspectRatio: "adaptive",
    })
    // NO onTaskCreated by design: persisting the KIE task would let the
    // reconcile cron finalize this job with the UNSTITCHED extension clip.
    expect(reconcileOpts).toBeUndefined()
  })

  it("cuts the tail from the picture's end", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledTimes(1)
    expect(mocks.mockExtractTailToFile.mock.calls[0]![2]).toEqual({ measureFrom: "picture" })
  })

  it("trims user prompt whitespace inside the template", async () => {
    await handler()(makeJob({ prompt: "  she opens the door  " }) as never, makeCtx() as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![2]).toBe("extend @video_1 as follows:\nshe opens the door")
  })

  it("defaults duration to the 8s pricing tier, 720p, audio on — and NO reference images key when none were sent", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    const [, , , duration, , opts] = mocks.mockImageToVideo.mock.calls[0]!
    expect(duration).toBe(8)
    expect(opts).toMatchObject({ resolution: "720p", generateAudio: true })
    // Refs are additive: their absence keeps the spike-validated opts shape
    // byte-identical (no stray undefined key reaching the provider layer).
    expect("referenceImageUrls" in (opts as Record<string, unknown>)).toBe(false)
  })

  it("passes route-assembled referenceImageUrls through to the i2v transport alongside the tail", async () => {
    const REF_A = "https://r2.example.com/images/ref-a.png"
    const REF_B = "https://r2.example.com/images/ref-b.png"
    await handler()(makeJob({ referenceImageUrls: [REF_A, REF_B] }) as never, makeCtx() as never)

    const [imageUrl, provider, , , , opts] = mocks.mockImageToVideo.mock.calls[0]!
    // The anchor + tail transport is unchanged; user refs ride IN ADDITION.
    expect(imageUrl).toBe(LAST_FRAME_URL)
    expect(provider).toBe("seedance-2")
    expect(opts).toMatchObject({
      referenceImageUrls: [REF_A, REF_B],
      referenceVideoUrls: [TAIL_URL],
    })
  })

  it("snaps out-of-range durations into seedance's native 4–15s window", async () => {
    await handler()(makeJob({ duration: 20 }) as never, makeCtx() as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(15)

    vi.clearAllMocks()
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 4.0 })
    mocks.mockImageToVideo.mockResolvedValue({ url: EXTENSION_URL, cost: 0.1, displayCost: 0.12, providerUsed: "kie" })
    mocks.mockUploadJobScratchFile.mockResolvedValueOnce(TAIL_URL).mockResolvedValueOnce(LAST_FRAME_URL)
    mocks.mockExtractFrame.mockResolvedValue({ imagePath: "/tmp/extract-frame-x/frame.png" })
    mocks.mockExtractTailToFile.mockResolvedValue("/tmp/test-workdir/source.mp4.tail.mp4")
    mocks.mockStitchExtension.mockResolvedValue({ outputPath: STITCHED_PATH, boundary: BOUNDARY })
    await handler()(makeJob({ duration: 1 }) as never, makeCtx() as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(4)
  })

  it("probes ONLY the local download (short-source guard) — never the remote URL; aspect stays native 'adaptive' with no remote round-trip", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    expect(mocks.mockProbeVideoSource).toHaveBeenCalledTimes(1)
    expect(mocks.mockProbeVideoSource).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4")
    expect(mocks.mockProbeVideoSource).not.toHaveBeenCalledWith(SOURCE_URL)
  })

  it("source shorter than the 1.8s r2v floor → friendly error BEFORE any tail extract or provider call", async () => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 1.2 })
    await expect(
      handler()(makeJob() as never, makeCtx() as never),
    ).rejects.toThrow(/too short to extend.*1\.8s.*got 1\.20s/)
    expect(mocks.mockExtractTailToFile).not.toHaveBeenCalled()
    expect(mocks.mockImageToVideo).not.toHaveBeenCalled()
  })

  it("the short-source floor reads the picture's length, not the container's", async () => {
    // 2 s of container, but the picture ends at 1.6 s (the sound runs past it).
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 2, videoDurationSeconds: 1.6 })
    await expect(
      handler()(makeJob() as never, makeCtx() as never),
    ).rejects.toThrow(/too short to extend.*got 1\.60s/)
    expect(mocks.mockImageToVideo).not.toHaveBeenCalled()
  })

  it("stitches with stitchExtension, never combineVideos (the spike-validated recipe: −4 tail / −3 head fallback, 8/8 smart cut, 0.15s fade)", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    expect(mocks.mockCombineVideos).not.toHaveBeenCalled()
    expect(mocks.mockStitchExtension).toHaveBeenCalledTimes(1)
    expect(mocks.mockStitchExtension).toHaveBeenCalledWith({
      // The source's local copy the tail was cut from: no second download.
      sourcePath: `${PREP_DIR}/source.mp4`,
      extensionPath: `${STITCH_DIR}/extension.mp4`,
      workDir: STITCH_DIR,
      // The extension is generated FROM the source's tail — the exact
      // continuation case smart cut solves. PSNR-match the boundary.
      smartCut: { framesFromPrev: 8, framesFromNext: 8 },
      // Fixed recipe trims stay as the smart-cut FALLBACK: trimEndFrames
      // hits the source's tail, trimStartFrames the extension's head.
      fallbackTrims: { trimEndFrames: 4, trimStartFrames: 3 },
      audioFadeSec: 0.15,
    })
  })

  it("downloads the source once (the prep's copy is the stitch's source) and the extension into the stitch's own folder", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    expect(mocks.mockDownloadFile.mock.calls).toEqual([
      [SOURCE_URL, `${PREP_DIR}/source.mp4`],
      [EXTENSION_URL, `${STITCH_DIR}/extension.mp4`],
    ])
  })

  it("a mov extension is downloaded as a .mov", async () => {
    const KIE_MOV = "https://kie.example.com/extension.mov?token=abc"
    mocks.mockImageToVideo.mockResolvedValue({ url: KIE_MOV, cost: 0.2, providerUsed: "kie" })
    await handler()(makeJob() as never, makeCtx() as never)
    expect(mocks.mockDownloadFile).toHaveBeenCalledWith(KIE_MOV, `${STITCH_DIR}/extension.mov`)
    expect(mocks.mockStitchExtension.mock.calls[0]![0]).toMatchObject({ extensionPath: `${STITCH_DIR}/extension.mov` })
  })

  it("keeps the source on disk until the stitch has read it, then removes both folders", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    const cleanups = mocks.mockCleanupWorkDir.mock.calls.map((c) => c[0])
    expect(cleanups).toContain(PREP_DIR)
    expect(cleanups).toContain(STITCH_DIR)
    const order = (dir: string) => mocks.mockCleanupWorkDir.mock.invocationCallOrder[cleanups.indexOf(dir)]!
    const stitched = mocks.mockStitchExtension.mock.invocationCallOrder[0]!
    const uploaded = mocks.mockWatermarkLocalVideoAndUpload.mock.invocationCallOrder[0]!
    // The prep folder holds the stitch's source: removed only after the stitch.
    expect(order(PREP_DIR)).toBeGreaterThan(stitched)
    // The stitch folder holds the result: removed only after it is uploaded.
    expect(order(STITCH_DIR)).toBeGreaterThan(uploaded)
  })

  it.each([
    ["the stitch", () => mocks.mockStitchExtension.mockRejectedValue(new Error("Extend stitch: the extension has no video stream"))],
    ["the extension's download", () => mocks.mockDownloadFile.mockImplementation(async (url: string) => {
      if (url === EXTENSION_URL) throw new Error("Failed to download video: 404")
    })],
    ["the upload", () => mocks.mockWatermarkLocalVideoAndUpload.mockRejectedValueOnce(new Error("upload failed"))],
  ])("%s fails: both folders are still removed", async (_step, breakIt) => {
    breakIt()
    await expect(handler()(makeJob() as never, makeCtx() as never)).rejects.toThrow()
    const cleanups = mocks.mockCleanupWorkDir.mock.calls.map((c) => c[0])
    expect(cleanups).toContain(PREP_DIR)
    expect(cleanups).toContain(STITCH_DIR)
  })

  it("the generation fails: the prep folder is still removed", async () => {
    mocks.mockImageToVideo.mockRejectedValue(new Error("generation failed"))
    await expect(handler()(makeJob() as never, makeCtx() as never)).rejects.toThrow("generation failed")
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith(PREP_DIR)
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
  })

  it("a source refused as too short: the prep folder is still removed", async () => {
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 1.2 })
    await expect(handler()(makeJob() as never, makeCtx() as never)).rejects.toThrow(/too short/)
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith(PREP_DIR)
  })

  it("output_data.smartCuts keeps its shape: one boundary, combineVideos' fields in combineVideos' order", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    const { smartCuts } = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData
    expect(smartCuts).toEqual([{
      boundary: 0,
      prevClipEndTrimFrames: 2,
      nextClipStartTrimFrames: 3,
      psnrDb: 41.27,
      matched: true,
      searchedPrevFrames: 8,
      searchedNextFrames: 8,
    }])
    expect(Object.keys(smartCuts[0])).toEqual([
      "boundary", "prevClipEndTrimFrames", "nextClipStartTrimFrames", "psnrDb", "matched", "searchedPrevFrames", "searchedNextFrames",
    ])
  })

  it("output_data.smartCuts reports the fixed trims and nulls when no search ran (no matcher)", async () => {
    mocks.mockStitchExtension.mockResolvedValue({
      outputPath: STITCHED_PATH,
      boundary: { matched: false, psnrDb: null, trimEndFrames: 4, trimStartFrames: 3, searchedPrevFrames: null, searchedNextFrames: null },
    })
    await handler()(makeJob() as never, makeCtx() as never)
    expect(mocks.mockFinalizeJobWithMedia.mock.calls[0]![0].extraOutputData.smartCuts).toEqual([{
      boundary: 0,
      prevClipEndTrimFrames: 4,
      nextClipStartTrimFrames: 3,
      psnrDb: null,
      matched: false,
      searchedPrevFrames: null,
      searchedNextFrames: null,
    }])
  })

  it("uploads the stitched LOCAL file (watermark-aware) and finalizes as seedance-2-0-extend", async () => {
    await handler()(makeJob() as never, makeCtx({ shouldWatermark: true }) as never)

    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(STITCHED_PATH, "job-1", "user-1", true)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      jobType: "extend-video",
      mediaUrl: "https://r2.example.com/videos/job-1.mp4",
      result: expect.objectContaining({ providerUsed: "seedance-2-0-extend", cost: 0.2 }),
      extraOutputData: expect.objectContaining({
        thumbnailUrl: "https://r2.example.com/thumbnails/job-1.png",
      }),
    }))
  })

  it("stitch failure fails the job — never delivers the bare extension", async () => {
    mocks.mockStitchExtension.mockRejectedValue(new Error("ffmpeg exited with code 1"))
    await expect(handler()(makeJob() as never, makeCtx() as never)).rejects.toThrow("ffmpeg exited with code 1")
    expect(mocks.mockWatermarkLocalVideoAndUpload).not.toHaveBeenCalled()
    expect(mocks.mockUploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })
})
