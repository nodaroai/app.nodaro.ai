import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `characterReferences` is a SILENT-DROP hazard: if a handler forgets to hand
 * the field to the provider, the run still completes — with a different face,
 * which is exactly what the field exists to prevent. The route tests stop at the
 * queue payload and the provider tests call `KieVideoProvider` directly, so this
 * pins the middle hop: queue payload → handler → `imageToVideo` / `textToVideo`
 * options (including the content-policy resubmit).
 */

const mocks = vi.hoisted(() => ({
  mockImageToVideo: vi.fn(),
  mockTextToVideo: vi.fn(),
  mockRewrite: vi.fn(),
  mockFinalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }),
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
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/workdir"),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  stripAudio: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia }))
vi.mock("../../../lib/content-policy-rewrite.js", () => ({ rewriteForContentPolicy: mocks.mockRewrite }))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: vi.fn().mockResolvedValue(undefined),
    shouldSaveJobResult: vi.fn().mockResolvedValue(true),
    markJobCompleted: vi.fn().mockResolvedValue(true),
    uploadVideoMaybeWatermark: vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4"),
    watermarkLocalVideoAndUpload: vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1-merged.mp4"),
    generateAndUploadThumbnail: vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/job-1.png"),
    setJobProgress: vi.fn(async () => {}),
    refundLoopTrimAddon: vi.fn().mockResolvedValue(undefined),
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

import { videoAIHandlers } from "../video-ai.js"
import { KieError } from "../../../providers/kie/client.js"

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: false }
const RESULT = { url: "https://kie.example/out.mp4", providerUsed: "gemini-omni-video", cost: 1, displayCost: 1 }

const CHARACTERS = [
  { imageUrl: "https://cdn.example/a.png", description: "A woman with silver hair", name: "Ava" },
  { imageUrl: "https://cdn.example/b.png", bodyImageUrl: "https://cdn.example/b-body.png", description: "A tall man" },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockImageToVideo.mockResolvedValue(RESULT)
  mocks.mockTextToVideo.mockResolvedValue(RESULT)
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
})

describe("characterReferences — queue payload → provider options", () => {
  it("image-to-video: reaches imageToVideo's options (arg 6), with no start frame", async () => {
    await videoAIHandlers["image-to-video"](
      makeJob("image-to-video", {
        provider: "gemini-omni-video", prompt: "she speaks", duration: 8, characterReferences: CHARACTERS,
        referenceVideoUrls: ["https://x/black-with-voice.mp4"],
      }) as never,
      ctx as never,
    )
    expect(mocks.mockImageToVideo).toHaveBeenCalledOnce()
    const opts = mocks.mockImageToVideo.mock.calls[0]![5] as Record<string, unknown>
    expect(opts.characterReferences).toEqual(CHARACTERS)
    expect(opts.referenceVideoUrls).toEqual(["https://x/black-with-voice.mp4"])
  })

  it("text-to-video: reaches textToVideo's options (arg 5)", async () => {
    await videoAIHandlers["text-to-video"](
      makeJob("text-to-video", { provider: "gemini-omni-flash", prompt: "she speaks", duration: 8, characterReferences: CHARACTERS }) as never,
      ctx as never,
    )
    expect(mocks.mockTextToVideo).toHaveBeenCalledOnce()
    expect((mocks.mockTextToVideo.mock.calls[0]![4] as Record<string, unknown>).characterReferences).toEqual(CHARACTERS)
  })

  it("text-to-video: the content-policy rewrite-once resubmit carries the SAME characters", async () => {
    mocks.mockTextToVideo
      .mockRejectedValueOnce(new KieError("blocked", "copyright block", "Video generation", true, true, "copyright"))
      .mockResolvedValueOnce(RESULT)
    mocks.mockRewrite.mockResolvedValueOnce("a rewritten prompt")
    await videoAIHandlers["text-to-video"](
      makeJob("text-to-video", { provider: "gemini-omni-video", prompt: "she speaks", duration: 8, characterReferences: CHARACTERS }) as never,
      ctx as never,
    )
    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(2)
    expect(mocks.mockTextToVideo.mock.calls[1]![0]).toBe("a rewritten prompt")
    expect((mocks.mockTextToVideo.mock.calls[1]![4] as Record<string, unknown>).characterReferences).toEqual(CHARACTERS)
  })

  it("absent characterReferences stay absent (no phantom empty list)", async () => {
    await videoAIHandlers["text-to-video"](
      makeJob("text-to-video", { provider: "gemini-omni-video", prompt: "x", duration: 8 }) as never,
      ctx as never,
    )
    expect((mocks.mockTextToVideo.mock.calls[0]![4] as Record<string, unknown>).characterReferences).toBeUndefined()
  })
})
