import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A run a plugin's alternate route made (lib/alternate-route.ts) reaches the
 * video handlers as a router result with `routedVia`. Its `cost` is the
 * route's own figure and is recorded as it is — never re-derived from the
 * default upstream's rates — the job names a generic provider, and the
 * person's charge is settled exactly as for any other run (the measured base
 * credits still reach finalize). Both handlers opt the job in with `routeJob`.
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

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: false }
const REFS = ["https://r2.example.com/videos/ref.mp4"]
const ROUTED = { url: "https://out.example/v.mp4", providerUsed: "kie", cost: 0.42, routedVia: "route-1", providerMs: 900 }
const DEFAULT = { url: "https://default.example/v.mp4", providerUsed: "kie", cost: 1.25 }
const SETTLED = { baseCredits: 321, seconds: { outputSec: 8, inputSec: 8 }, deliveredSec: 8 }
const finalizeArg = () => mocks.mockFinalizeJobWithMedia.mock.calls[0]![0] as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockMeasure.mockResolvedValue(SETTLED)
  mocks.mockDraftMeasure.mockResolvedValue(undefined)
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
})

const lanes = [
  { name: "image-to-video", router: () => mocks.mockImageToVideo, reconcileArg: 6 },
  { name: "text-to-video", router: () => mocks.mockTextToVideo, reconcileArg: 5 },
] as const

describe.each(lanes)("$name handler", ({ name, router, reconcileArg }) => {
  const handler = videoAIHandlers[name]
  const data = { provider: "seedance-2-5", resolution: "720p", duration: -1, referenceVideoUrls: REFS, referenceTaskType: "edit" }

  it("opts the job in with routeJob naming this job and lane", async () => {
    router().mockResolvedValue(DEFAULT)
    await handler(makeJob(name, data) as never, ctx as never)
    expect(router().mock.calls[0]![reconcileArg]).toMatchObject({ routeJob: { jobId: "job-1", jobType: name } })
  })

  it("a routed run keeps the route's figure, names a generic provider, and settles the person's charge as usual", async () => {
    router().mockResolvedValue(ROUTED)
    await handler(makeJob(name, data) as never, ctx as never)
    const arg = finalizeArg()
    const result = arg.result as Record<string, unknown>
    expect(result.cost).toBe(0.42)
    expect(result.providerUsed).toBe("alternate")
    expect(result).not.toHaveProperty("kieTaskId")
    expect(arg.meteredBaseCredits).toBe(321)
    const extra = arg.extraOutputData as Record<string, unknown>
    expect(extra).not.toHaveProperty("kieTaskId")
    expect(extra).not.toHaveProperty("providerTaskId")
  })

  it("an ordinary run still takes the default cost rule and keeps its provider", async () => {
    router().mockResolvedValue(DEFAULT)
    await handler(makeJob(name, data) as never, ctx as never)
    const result = finalizeArg().result as Record<string, unknown>
    expect(result.providerUsed).toBe("kie")
    expect(result.cost).not.toBe(1.25)
  })
})
