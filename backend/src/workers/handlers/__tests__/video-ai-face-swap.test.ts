/**
 * Face Swap's worker handler. A job with no face or no video is refused at once
 * as a DeterministicJobError, so the worker fails and refunds it on that attempt,
 * and it never reaches the provider. A missing face used to crash inside the
 * provider on `undefined.slice` and burn all three attempts first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  replicateFaceSwap: vi.fn(),
  uploadSwapWithSourceAudio: vi.fn(),
  generateAndUploadThumbnail: vi.fn(),
  finalizeJobWithMedia: vi.fn(),
  setJobProgress: vi.fn(async () => {}),
  faceSwapSettle: vi.fn(async (_cost: unknown): Promise<Record<string, unknown>> => ({})),
  faceSwapFaceImage: vi.fn(async (url: string, _jobId: string) => url),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/storage.js", () => ({ uploadToR2: vi.fn() }))
vi.mock("@/providers/index.js", () => ({}))
vi.mock("../../../providers/replicate/face-swap.js", () => ({ replicateFaceSwap: mocks.replicateFaceSwap }))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeJobWithMedia }))
vi.mock("../face-swap-audio.js", () => ({ uploadSwapWithSourceAudio: mocks.uploadSwapWithSourceAudio }))
vi.mock("../../../lib/face-swap-input.js", () => ({ faceSwapSettle: mocks.faceSwapSettle }))
vi.mock("../../../lib/face-swap-face-image.js", () => ({ faceSwapFaceImage: mocks.faceSwapFaceImage }))
vi.mock("../../../lib/reconcile/persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/reconcile/persistence.js")>()),
  makeOnTaskCreated: vi.fn(() => vi.fn()),
}))
vi.mock("../../shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared.js")>()),
  generateAndUploadThumbnail: mocks.generateAndUploadThumbnail,
  setJobProgress: mocks.setJobProgress,
  withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
}))

import { videoAIHandlers } from "../video-ai.js"
import { DeterministicJobError } from "../../../lib/deterministic-job-error.js"

const FACE = "https://cdn.example/face.png"
const VIDEO = "https://cdn.example/clip.mp4"
const handler = videoAIHandlers["face-swap"]
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }

function job(data: Record<string, unknown>) {
  return { name: "face-swap", data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.replicateFaceSwap.mockResolvedValue({ videoUrl: "https://replicate.example/out.mp4", cost: 0.05 })
  mocks.uploadSwapWithSourceAudio.mockResolvedValue("https://r2.example/videos/job-1.mp4")
  mocks.generateAndUploadThumbnail.mockResolvedValue("https://r2.example/thumbnails/job-1.png")
  mocks.finalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.faceSwapFaceImage.mockImplementation(async (url: string) => url)
})

describe("face-swap handler", () => {
  it("swaps the face into the video and stores the result with the source's sound", async () => {
    await handler(job({ faceImageUrl: FACE, videoUrl: VIDEO }) as never, ctx as never)

    expect(mocks.replicateFaceSwap).toHaveBeenCalledWith(FACE, VIDEO, expect.objectContaining({ onTaskCreated: expect.any(Function) }))
    // The model returns the picture only; the source clip is where the sound comes from.
    expect(mocks.uploadSwapWithSourceAudio).toHaveBeenCalledWith("https://replicate.example/out.mp4", VIDEO, ctx)
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "https://r2.example/videos/job-1.mp4" }))
  })

  it("sends the face photo as fitted for the swap model (a large photo failed it)", async () => {
    mocks.faceSwapFaceImage.mockResolvedValueOnce("https://r2.example/tmp/provider-input/job-1/face-swap-face-x.jpg")
    await handler(job({ faceImageUrl: FACE, videoUrl: VIDEO }) as never, ctx as never)

    expect(mocks.faceSwapFaceImage).toHaveBeenCalledWith(FACE, "job-1")
    expect(mocks.replicateFaceSwap).toHaveBeenCalledWith(
      "https://r2.example/tmp/provider-input/job-1/face-swap-face-x.jpg",
      VIDEO,
      expect.anything(),
    )
  })

  it("a run within its row: finalize records what Replicate billed and commits the reserved tier", async () => {
    await handler(job({ faceImageUrl: FACE, videoUrl: VIDEO }) as never, ctx as never)

    expect(mocks.faceSwapSettle).toHaveBeenCalledWith(0.05)
    const input = mocks.finalizeJobWithMedia.mock.calls[0]![0] as Record<string, unknown> & { result: Record<string, unknown> }
    // Exactly these keys: no `meteredCost` / `collectOverHold` on the result and
    // no `meteredBaseCredits` on the input, so finalize commits the reserved tier.
    expect(input.result).toEqual({ url: "https://replicate.example/out.mp4", cost: 0.05, providerUsed: "roop" })
    expect(input).not.toHaveProperty("meteredBaseCredits")
  })

  it("a run Replicate billed past its row is charged what it cost, collected above the hold", async () => {
    mocks.replicateFaceSwap.mockResolvedValueOnce({ videoUrl: "https://replicate.example/out.mp4", cost: 0.42 })
    mocks.faceSwapSettle.mockResolvedValueOnce({ meteredCost: true, collectOverHold: true })
    await handler(job({ faceImageUrl: FACE, videoUrl: VIDEO }) as never, ctx as never)

    const input = mocks.finalizeJobWithMedia.mock.calls[0]![0] as Record<string, unknown> & { result: Record<string, unknown> }
    expect(input.result).toEqual({
      url: "https://replicate.example/out.mp4",
      cost: 0.42,
      providerUsed: "roop",
      meteredCost: true,
      collectOverHold: true,
    })
  })

  it.each([
    ["no face", { videoUrl: VIDEO }, /face image/],
    ["an empty face", { faceImageUrl: "   ", videoUrl: VIDEO }, /face image/],
    ["no video", { faceImageUrl: FACE }, /video/],
  ])("refuses a job with %s at once, before the provider", async (_label, data, message) => {
    const err = await handler(job(data) as never, ctx as never).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DeterministicJobError)
    expect((err as Error).message).toMatch(message)
    expect(mocks.replicateFaceSwap).not.toHaveBeenCalled()
  })
})
