import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The image-to-video worker for a CHILD job's Seedance 2.5 mov container —
 * `/v1/generate-video` queues `outputFormat: "mov"` only when it honoured it
 * (a child on seedance-2-5, `seedance25OutputFormatFor`), as /v1/text-to-video
 * does. The provider is asked for mov, and a mov the provider returned is kept
 * as `.mov` (its parent re-encodes it) — never through the browser-safe
 * transcode. And this lane never rewords a refused prompt: the copyright
 * reword-once retry is the text-to-video worker's alone.
 */

const mocks = vi.hoisted(() => ({
  imageToVideo: vi.fn(),
  uploadToR2: vi.fn(),
  uploadVideoMaybeWatermark: vi.fn(),
  thumbnail: vi.fn(),
  finalize: vi.fn(),
  rewrite: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) })) },
}))
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage.js")>()),
  uploadToR2: mocks.uploadToR2,
}))
vi.mock("@/providers/index.js", () => ({ imageToVideo: mocks.imageToVideo, textToVideo: vi.fn() }))
vi.mock("@/lib/content-policy-rewrite.js", () => ({ rewriteForContentPolicy: mocks.rewrite }))
vi.mock("../../shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared.js")>()),
  uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
  generateAndUploadThumbnail: mocks.thumbnail,
  setJobProgress: vi.fn(async () => {}),
  startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
}))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalize }))
vi.mock("@/lib/seedance2-ref-video-settle.js", () => ({ measureSeedance2RefVideoBaseCredits: vi.fn(async () => undefined) }))
vi.mock("@/lib/seedance-draft-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seedance-draft-finalize.js")>()),
  measureSeedanceDraftRenderSec: vi.fn(async () => undefined),
}))
vi.mock("@/lib/reconcile/persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reconcile/persistence.js")>()),
  makeOnTaskCreated: () => undefined,
}))

import { videoAIHandlers } from "../video-ai.js"
import { KieError } from "../../../providers/kie/client.js"

const handler = videoAIHandlers["image-to-video"]!
const MP4 = { url: "https://provider.example.com/out/edit.mp4", providerUsed: "kie", cost: 0.4, displayCost: 0.5 }
const MOV = { ...MP4, url: "https://provider.example.com/out/edit.mov?sig=abc" }
/** A Nodaro Motion child: no start frame, one reference clip. */
const CHILD = {
  jobId: "job-1",
  prompt: "edit @video_1 as follows:\nUse the person from @image_1 as the singer.",
  provider: "seedance-2-5",
  referenceVideoUrls: ["https://cdn.nodaro.ai/videos/clip.mp4"],
  referenceImageUrls: ["https://cdn.nodaro.ai/images/face.jpg"],
}

const job = (data: Record<string, unknown>) => ({ name: "image-to-video", data, id: "bull-1", updateProgress: vi.fn() }) as never
const ctx = (over: Record<string, unknown> = {}) => ({ jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false, ...over }) as never
const providerOptions = () => mocks.imageToVideo.mock.calls[0]![5] as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.imageToVideo.mockResolvedValue(MP4)
  mocks.uploadToR2.mockResolvedValue("https://r2.example.com/videos/job-1.mov")
  mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.thumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
  mocks.finalize.mockResolvedValue({ ok: true })
})

describe("image-to-video — seedance 2.5 mov output (child jobs)", () => {
  it("asks the provider for mov and stores the mov result with ext mov", async () => {
    mocks.imageToVideo.mockResolvedValue(MOV)
    await handler(job({ ...CHILD, outputFormat: "mov" }), ctx())

    expect(mocks.imageToVideo.mock.calls[0]![0]).toBeUndefined()
    expect(providerOptions()).toMatchObject({ outputFormat: "mov" })
    expect(mocks.uploadToR2).toHaveBeenCalledWith(MOV.url, "job-1", "video", "user-1", { ext: "mov" })
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.thumbnail).toHaveBeenCalledWith("https://r2.example.com/videos/job-1.mov", "job-1", "user-1")
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ jobType: "image-to-video", mediaUrl: "https://r2.example.com/videos/job-1.mov" }))
  })

  it("watermarked: the watermark step writes the stored file (an mp4), never a mov", async () => {
    mocks.imageToVideo.mockResolvedValue(MOV)
    await handler(job({ ...CHILD, outputFormat: "mov" }), ctx({ shouldWatermark: true }))

    expect(providerOptions()).toMatchObject({ outputFormat: "mov" })
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(MOV.url, "job-1", "user-1", true)
    expect(mocks.uploadToR2).not.toHaveBeenCalled()
  })

  it("an mp4 answer to a mov request is stored as the mp4 it is", async () => {
    await handler(job({ ...CHILD, outputFormat: "mov" }), ctx())

    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(MP4.url, "job-1", "user-1", false)
    expect(mocks.uploadToR2).not.toHaveBeenCalled()
  })

  it("absent: the provider options are key-for-key today's, and the upload is today's", async () => {
    await handler(job(CHILD), ctx())
    const without = providerOptions()
    vi.clearAllMocks()
    mocks.imageToVideo.mockResolvedValue(MP4)
    mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
    mocks.finalize.mockResolvedValue({ ok: true })
    await handler(job({ ...CHILD, provider: "kling-4", outputFormat: "mov" }), ctx())

    expect(without).not.toHaveProperty("outputFormat")
    expect(Object.keys(providerOptions())).toEqual(Object.keys(without))
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(MP4.url, "job-1", "user-1", false)
  })

  it("another provider never asks for mov, whatever the payload says", async () => {
    mocks.imageToVideo.mockResolvedValue(MOV)
    await handler(job({ ...CHILD, provider: "kling-4", outputFormat: "mov" }), ctx())

    expect(providerOptions()).not.toHaveProperty("outputFormat")
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(MOV.url, "job-1", "user-1", false)
    expect(mocks.uploadToR2).not.toHaveBeenCalled()
  })
})

describe("image-to-video — never rewords", () => {
  it("a copyright refusal fails the job as it is: no reword, no second provider call", async () => {
    const refusal = new KieError("refused", "copyright", "Video generation", true, true, "copyright")
    mocks.imageToVideo.mockRejectedValue(refusal)
    mocks.rewrite.mockResolvedValue("a reworded prompt")

    await expect(handler(job({ ...CHILD, contentPolicyRewrite: true }), ctx())).rejects.toBe(refusal)
    expect(mocks.rewrite).not.toHaveBeenCalled()
    expect(mocks.imageToVideo).toHaveBeenCalledTimes(1)
    expect(mocks.finalize).not.toHaveBeenCalled()
  })
})
