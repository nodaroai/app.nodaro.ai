/**
 * LTX 2.3 settles at the RESERVED tier, never at the host's GPU-time figure.
 *
 * LTX is priced by its output (the official per-(band × seconds) rows the
 * reservation names — `ltx-2.3-<v>:<band>:<s>s`), while `result.cost` from the
 * Replicate runner is `predict_time × a per-second GPU rate`: a small fraction
 * of the tier. Finalizing with `meteredCost: true` therefore charged 8 of a
 * 264-credit hold and 5 of 198 (prod 2026-10-28). The finalize must commit the
 * reservation (`meteredCost: false`) on every LTX lane: text-to-video,
 * image-to-video and the Pro extend.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  mockRunLtxTextToVideo: vi.fn(),
  mockRunLtxImageToVideo: vi.fn(),
  mockRunLtxAudioToVideo: vi.fn(),
  mockRunLtxExtend: vi.fn(),
  mockRunLtxRetake: vi.fn(),
  mockFinalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }),
  mockUploadVideoMaybeWatermark: vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4"),
  mockGenerateAndUploadThumbnail: vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/job-1.png"),
  mockSetJobProgress: vi.fn(async () => {}),
  mockEq: vi.fn().mockResolvedValue({ data: null, error: null }),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: mocks.mockEq }) }) },
}))
vi.mock("@/lib/storage.js", () => ({ uploadToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/raw.mp4") }))
vi.mock("@/providers/index.js", () => ({
  imageToVideo: vi.fn(),
  textToVideo: vi.fn(),
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  lipSyncVideo: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
  speechToVideo: vi.fn(),
}))
vi.mock("../../../providers/replicate/ltx-video.js", () => ({
  runLtxTextToVideo: mocks.mockRunLtxTextToVideo,
  runLtxImageToVideo: mocks.mockRunLtxImageToVideo,
  runLtxAudioToVideo: mocks.mockRunLtxAudioToVideo,
  runLtxExtend: mocks.mockRunLtxExtend,
  runLtxRetake: mocks.mockRunLtxRetake,
}))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: mocks.mockSetJobProgress,
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})
vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia,
}))
vi.mock("../../../lib/reconcile/persistence.js", () => ({
  makeOnTaskCreated: vi.fn(() => vi.fn(async () => {})),
}))
// The i2v lane fits the start frame before the run (a real media fetch
// otherwise): answer with a shaped address and assert the runner got it.
vi.mock("../../../lib/video-frame-dispatch.js", () => ({
  applyFrameFitAndDelivery: vi.fn(async (input: { imageUrl: string; endFrameUrl?: string }) => ({
    imageUrl: `${input.imageUrl}#fitted`,
    endFrameUrl: input.endFrameUrl,
  })),
}))

import { videoAIHandlers } from "../video-ai.js"

/** What the Replicate runner answers: the host's GPU-time figure, far below the tier. */
const LTX_RESULT = { predictionId: "p-1", videoUrl: "https://replicate.delivery/out.mp4", cost: 0.0315 }

function makeJob(name: string, data: Record<string, unknown>) {
  return { name, data: { jobId: "job-1", usageLogId: "usage-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockRunLtxTextToVideo.mockResolvedValue(LTX_RESULT)
  mocks.mockRunLtxImageToVideo.mockResolvedValue(LTX_RESULT)
  mocks.mockRunLtxExtend.mockResolvedValue(LTX_RESULT)
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
})

function finalizeResult(): Record<string, unknown> {
  expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
  return (mocks.mockFinalizeJobWithMedia.mock.calls[0]![0] as { result: Record<string, unknown> }).result
}

describe("LTX 2.3 settles at the reserved tier", () => {
  it("text-to-video (ltx-2.3-pro): finalize commits the reservation, not the host's GPU-time cost", async () => {
    await videoAIHandlers["text-to-video"]!(
      makeJob("text-to-video", { provider: "ltx-2.3-pro", task: "text_to_video", prompt: "a dog", resolution: "1080p", duration: 6, aspect_ratio: "16:9", fps: 24 }) as never,
      ctx as never,
    )
    const result = finalizeResult()
    expect(result.providerUsed).toBe("ltx-2.3-pro")
    expect(result.meteredCost).toBe(false)
    // The host's figure is still recorded as provider cost, for the audit.
    expect(result.cost).toBe(LTX_RESULT.cost)
  })

  it("image-to-video (ltx-2.3-fast): the same", async () => {
    await videoAIHandlers["image-to-video"]!(
      makeJob("image-to-video", { provider: "ltx-2.3-fast", task: "image_to_video", image: "https://cdn.example.com/start.png", prompt: "move", resolution: "1080p", duration: 6, aspect_ratio: "9:16", fps: 24 }) as never,
      ctx as never,
    )
    const result = finalizeResult()
    expect(result.providerUsed).toBe("ltx-2.3-fast")
    expect(result.meteredCost).toBe(false)
    // The fitted frame, not the raw upload, reached the runner.
    expect(mocks.mockRunLtxImageToVideo).toHaveBeenCalledWith(expect.objectContaining({ image: "https://cdn.example.com/start.png#fitted" }))
  })

  it("extend-video (ltx-2.3-pro): the same", async () => {
    await videoAIHandlers["extend-video"]!(
      makeJob("extend-video", { provider: "ltx-2.3-pro", videoUrl: "https://cdn.example.com/clip.mp4", prompt: "keep going", duration: 6 }) as never,
      ctx as never,
    )
    const result = finalizeResult()
    expect(result.providerUsed).toBe("ltx-2.3-pro")
    expect(result.meteredCost).toBe(false)
  })
})
