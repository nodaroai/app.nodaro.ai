import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// seedance-2-extend worker branch: bare-template continuation generation via
// the seedance-2 reference-video transport + trim-stitch via combineVideos.
// Template phrasing, trim counts, and "stitch failure = job failure" are all
// spike-validated invariants — these tests pin them.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockTextToVideo = vi.fn()
  const mockImageToVideo = vi.fn()
  const mockCombineVideos = vi.fn()
  const mockProbeVideoSource = vi.fn()
  const mockExtractTailToFile = vi.fn().mockResolvedValue("/tmp/test-workdir/source.mp4.tail.mp4")
  const mockExtractFrame = vi.fn().mockResolvedValue({ imagePath: "/tmp/extract-frame-x/frame.jpg" })
  const mockUploadFileToR2 = vi.fn()

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
    mockProbeVideoSource,
    mockExtractTailToFile,
    mockExtractFrame,
    mockUploadFileToR2,
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
  uploadToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/raw.mp4"),
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/buf.mp4"),
  uploadFileToR2: mocks.mockUploadFileToR2,
}))

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

vi.mock("@/providers/video/combine-videos.js", () => ({
  combineVideos: mocks.mockCombineVideos,
}))

vi.mock("@/providers/video/merge-video-audio.js", () => ({
  mergeVideoAudio: vi.fn(),
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/test-workdir"),
  downloadFile: vi.fn().mockResolvedValue(undefined),
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
const STITCHED_PATH = "/tmp/combine-abc/output.mp4"
const TAIL_URL = "https://r2.example.com/videos/tail-uuid.mp4"
const LAST_FRAME_URL = "https://r2.example.com/images/frame-uuid.png"

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "extend-video",
    data: {
      jobId: "job-1",
      provider: "seedance-2-extend",
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
  mocks.mockExtractFrame.mockResolvedValue({ imagePath: "/tmp/extract-frame-x/frame.jpg" })
  // First upload = the tail video, second = the last-frame image.
  mocks.mockUploadFileToR2.mockResolvedValueOnce(TAIL_URL).mockResolvedValueOnce(LAST_FRAME_URL)
  mocks.mockCombineVideos.mockResolvedValue({ outputPath: STITCHED_PATH })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extend-video / seedance-2-extend", () => {
  it("generates via i2v: last-frame anchor + 1s tail reference + the EXACT extend template", async () => {
    await handler()(makeJob({ duration: 6, resolution: "480p", generateAudio: false }) as never, makeCtx() as never)

    // Prep: tail extracted from the downloaded source at the spike-validated
    // 1s, then uploaded; the frame-exact extractor reads the tail's R2 copy
    // (its last frame IS the source's last frame).
    expect(mocks.mockExtractTailToFile).toHaveBeenCalledWith("/tmp/test-workdir/source.mp4", 1)
    expect(mocks.mockExtractFrame).toHaveBeenCalledWith({ videoUrl: TAIL_URL, mode: "last" })

    expect(mocks.mockImageToVideo).toHaveBeenCalledTimes(1)
    expect(mocks.mockTextToVideo).not.toHaveBeenCalled()
    const [imageUrl, provider, prompt, duration, endFrameUrl, opts, reconcileOpts] = mocks.mockImageToVideo.mock.calls[0]!
    // Spike-validated (2026-07-12): the extension must be anchored on the
    // source's last frame and reference ONLY the last second.
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

  it("trims user prompt whitespace inside the template", async () => {
    await handler()(makeJob({ prompt: "  she opens the door  " }) as never, makeCtx() as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![2]).toBe("extend @video_1 as follows:\nshe opens the door")
  })

  it("defaults duration to the 8s pricing tier, 720p, audio on", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    const [, , , duration, , opts] = mocks.mockImageToVideo.mock.calls[0]!
    expect(duration).toBe(8)
    expect(opts).toMatchObject({ resolution: "720p", generateAudio: true })
  })

  it("snaps out-of-range durations into seedance's native 4–15s window", async () => {
    await handler()(makeJob({ duration: 20 }) as never, makeCtx() as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(15)

    vi.clearAllMocks()
    mocks.mockImageToVideo.mockResolvedValue({ url: EXTENSION_URL, cost: 0.1, displayCost: 0.12, providerUsed: "kie" })
    mocks.mockUploadFileToR2.mockResolvedValueOnce(TAIL_URL).mockResolvedValueOnce(LAST_FRAME_URL)
    mocks.mockExtractFrame.mockResolvedValue({ imagePath: "/tmp/extract-frame-x/frame.jpg" })
    mocks.mockExtractTailToFile.mockResolvedValue("/tmp/test-workdir/source.mp4.tail.mp4")
    mocks.mockCombineVideos.mockResolvedValue({ outputPath: STITCHED_PATH })
    await handler()(makeJob({ duration: 1 }) as never, makeCtx() as never)
    expect(mocks.mockImageToVideo.mock.calls[0]![3]).toBe(4)
  })

  it("never probes the source — seedance's native adaptive needs no round-trip", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    expect(mocks.mockProbeVideoSource).not.toHaveBeenCalled()
  })

  it("trim-stitches with the spike-validated recipe (cut, −4 tail / −3 head, 0.15s anchored fades)", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    expect(mocks.mockCombineVideos).toHaveBeenCalledWith({
      videoUrls: [SOURCE_URL, EXTENSION_URL],
      transition: "cut",
      transitionDuration: 0.15,
      audioMode: "crossfade",
      audioCrossfadeCurve: "equal-power",
      // Fixed recipe trims stay as the smart-cut FALLBACK: trimEndFrames
      // hits the source's tail, trimStartFrames the extension's head.
      trimStartFrames: 3,
      trimEndFrames: 4,
      // The extension is generated FROM the source's tail — the exact
      // continuation case smart cut solves. PSNR-match the boundary.
      smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 },
    })
  })

  it("uploads the stitched LOCAL file (watermark-aware) and finalizes as seedance-2-extend", async () => {
    await handler()(makeJob() as never, makeCtx({ shouldWatermark: true }) as never)

    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(STITCHED_PATH, "job-1", "user-1", true)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      jobType: "extend-video",
      mediaUrl: "https://r2.example.com/videos/job-1.mp4",
      result: expect.objectContaining({ providerUsed: "seedance-2-extend", cost: 0.2 }),
      extraOutputData: expect.objectContaining({
        thumbnailUrl: "https://r2.example.com/thumbnails/job-1.png",
      }),
    }))
  })

  it("stitch failure fails the job — never delivers the bare extension", async () => {
    mocks.mockCombineVideos.mockRejectedValue(new Error("xfade: input streams mismatch"))
    await expect(handler()(makeJob() as never, makeCtx() as never)).rejects.toThrow("xfade")
    expect(mocks.mockWatermarkLocalVideoAndUpload).not.toHaveBeenCalled()
    expect(mocks.mockUploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })
})
