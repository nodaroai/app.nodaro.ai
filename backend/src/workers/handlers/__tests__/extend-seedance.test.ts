import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// seedance-2-extend worker branch: bare-template continuation generation via
// the seedance-2 reference-video transport + trim-stitch via combineVideos.
// Template phrasing, trim counts, and "stitch failure = job failure" are all
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockTextToVideo = vi.fn()
  const mockCombineVideos = vi.fn()
  const mockProbeVideoSource = vi.fn()

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
    mockCombineVideos,
    mockProbeVideoSource,
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
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: vi.fn(),
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
  mocks.mockTextToVideo.mockResolvedValue({
    url: EXTENSION_URL,
    cost: 0.2,
    displayCost: 0.25,
    providerUsed: "kie",
    kieTaskId: "kie-task-9",
  })
  mocks.mockCombineVideos.mockResolvedValue(STITCHED_PATH)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extend-video / seedance-2-extend", () => {
  it("generates via the EXACT bare temporal template on the seedance-2 ref-video transport", async () => {
    await handler()(makeJob({ duration: 6, resolution: "480p", generateAudio: false }) as never, makeCtx() as never)

    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(1)
    const [prompt, provider, duration, aspectRatio, opts, reconcileOpts] = mocks.mockTextToVideo.mock.calls[0]!
    // Spike phrasing matrix: the bare template is the ONLY form proven on
    // both tiers (36.7–38.1dB handoff); "reference"-keyword phrasings and
    // meta-instructions re-stage the scene. Pin the string verbatim.
    expect(prompt).toBe("Generate the content after Video 1: the ball keeps rolling until it hits a cup")
    expect(provider).toBe("seedance-2")
    expect(duration).toBe(6)
    // Native token (live-verified to adopt the ref video's ratio) — no
    // ffprobe round-trip; see source-matched-aspect.test.ts for fallbacks.
    expect(aspectRatio).toBe("adaptive")
    expect(opts).toMatchObject({
      referenceVideoUrls: [SOURCE_URL],
      resolution: "480p",
      generateAudio: false,
    })
    // NO onTaskCreated by design: persisting the KIE task would let the
    // reconcile cron finalize this job with the UNSTITCHED extension clip.
    expect(reconcileOpts).toBeUndefined()
  })

  it("trims user prompt whitespace inside the template", async () => {
    await handler()(makeJob({ prompt: "  she opens the door  " }) as never, makeCtx() as never)
    expect(mocks.mockTextToVideo.mock.calls[0]![0]).toBe("Generate the content after Video 1: she opens the door")
  })

  it("defaults duration to the 8s pricing tier, 720p, audio on", async () => {
    await handler()(makeJob() as never, makeCtx() as never)
    const [, , duration, , opts] = mocks.mockTextToVideo.mock.calls[0]!
    expect(duration).toBe(8)
    expect(opts).toMatchObject({ resolution: "720p", generateAudio: true })
  })

  it("snaps out-of-range durations into seedance's native 4–15s window", async () => {
    await handler()(makeJob({ duration: 20 }) as never, makeCtx() as never)
    expect(mocks.mockTextToVideo.mock.calls[0]![2]).toBe(15)

    vi.clearAllMocks()
    mocks.mockTextToVideo.mockResolvedValue({ url: EXTENSION_URL, cost: 0.1, displayCost: 0.12, providerUsed: "kie" })
    mocks.mockCombineVideos.mockResolvedValue(STITCHED_PATH)
    await handler()(makeJob({ duration: 1 }) as never, makeCtx() as never)
    expect(mocks.mockTextToVideo.mock.calls[0]![2]).toBe(4)
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
      // combineVideos trims only at clip BOUNDARIES: trimEndFrames hits the
      // source's tail, trimStartFrames the extension's head — the recipe.
      trimStartFrames: 3,
      trimEndFrames: 4,
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
