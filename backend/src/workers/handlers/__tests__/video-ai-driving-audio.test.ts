import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The video worker's audio-to-video wiring (LTX 2.5 Fast — decided
 * 2026-11-23), on both lanes: the provider is asked for an audio-to-video run
 * and the render goes through the lay-on step with its driving clip, whose
 * url is what is stored. A job the server did not stamp never reaches it.
 * Harness: video-ai-i2v-mov.test.ts.
 */

const mocks = vi.hoisted(() => ({
  imageToVideo: vi.fn(),
  uploadToR2: vi.fn(),
  uploadVideoMaybeWatermark: vi.fn(),
  thumbnail: vi.fn(),
  finalize: vi.fn(),
  rewrite: vi.fn(),
  textToVideo: vi.fn(),
  lay: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) })) },
}))
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage.js")>()),
  uploadToR2: mocks.uploadToR2,
}))
vi.mock("@/providers/index.js", () => ({ imageToVideo: mocks.imageToVideo, textToVideo: mocks.textToVideo }))
vi.mock("@/lib/driving-audio-lay.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/driving-audio-lay.js")>()),
  layDrivingAudioIfSilent: mocks.lay,
}))
vi.mock("@/lib/content-policy-rewrite.js", () => ({ rewriteForContentPolicy: mocks.rewrite }))
vi.mock("../../shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared.js")>()),
  uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
  generateAndUploadThumbnail: mocks.thumbnail,
  setJobProgress: vi.fn(async () => {}),
  startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
}))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalize }))
vi.mock("@/lib/seedance2-ref-video-settle.js", () => ({
  measureSeedance2RefVideoBaseCredits: vi.fn(async () => undefined),
  measureSeedance2Settle: vi.fn(async () => ({ baseCredits: undefined, seconds: undefined })),
}))
vi.mock("@/lib/seedance-draft-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seedance-draft-finalize.js")>()),
  measureSeedanceDraftRenderSec: vi.fn(async () => undefined),
}))
vi.mock("@/lib/reconcile/persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reconcile/persistence.js")>()),
  makeOnTaskCreated: () => undefined,
}))

import { videoAIHandlers } from "../video-ai.js"

const OUT = { url: "https://provider.example.com/out/a2v.mp4", providerUsed: "kie", cost: 0.2, displayCost: 0.2 }
const AUDIO = "https://cdn.nodaro.ai/audio/song.mp3"
const A2V = { jobId: "job-1", prompt: "she sings", provider: "ltx-2.5-fast", duration: 7.15, resolution: "720p", referenceAudioUrls: [AUDIO], audioToVideo: true }

const job = (name: string, data: Record<string, unknown>) => ({ name, data, id: "bull-1", updateProgress: vi.fn() }) as never
const ctx = (watermark = false) => ({ jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: watermark }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.imageToVideo.mockResolvedValue(OUT)
  mocks.textToVideo.mockResolvedValue(OUT)
  mocks.lay.mockResolvedValue({ kind: "stored", url: "https://r2.example.com/videos/job-1.mp4" })
  mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.thumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
  mocks.finalize.mockResolvedValue({ ok: true })
})

describe("audio-to-video in the video worker", () => {
  it.each([
    ["image-to-video", () => mocks.imageToVideo.mock.calls[0]![5]],
    ["text-to-video", () => mocks.textToVideo.mock.calls[0]!.at(-2)],
  ] as const)("%s: asks for the audio run; a silent render's one stored (watermarked) file is the job's media, never uploaded again", async (lane, options) => {
    await videoAIHandlers[lane]!(job(lane, A2V), ctx(true))
    expect(JSON.stringify(options())).toContain('"audioToVideo":true')
    expect(mocks.lay).toHaveBeenCalledWith({ videoUrl: OUT.url, audioUrl: AUDIO, jobId: "job-1", userId: "user-1", watermark: true })
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.uploadToR2).not.toHaveBeenCalled()
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "https://r2.example.com/videos/job-1.mp4" }))
  })

  it("a render with its sound is stored as usual", async () => {
    mocks.lay.mockResolvedValue({ kind: "as-rendered" })
    await videoAIHandlers["image-to-video"]!(job("image-to-video", A2V), ctx())
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(OUT.url, "job-1", "user-1", false)
  })

  it("a job the server did not stamp audio-to-video never reaches the step", async () => {
    const { audioToVideo: _a, ...plain } = A2V
    await videoAIHandlers["image-to-video"]!(job("image-to-video", plain), ctx())
    expect(mocks.lay).not.toHaveBeenCalled()
    expect(mocks.uploadVideoMaybeWatermark.mock.calls[0]![0]).toBe(OUT.url)
  })
})

describe("LTX 2.5 Fast on Lip Sync in the video worker (decided 2026-11-23)", () => {
  const LS = { jobId: "job-1", provider: "ltx-2.5-fast", imageUrl: "https://cdn.nodaro.ai/images/face.png", audioUrl: AUDIO, resolution: "720p", seed: 7, referenceAudioUrls: [AUDIO], audioToVideo: true, duration: 4.25 }

  it("runs the audio-to-video endpoint from the stamp, and the laid-on file is stored once as the job's media", async () => {
    await videoAIHandlers["lip-sync"]!(job("lip-sync", LS), ctx(true))
    const [image, provider, , duration, , options] = mocks.imageToVideo.mock.calls[0]!
    expect([image, provider, duration]).toEqual([LS.imageUrl, "ltx-2.5-fast", 4.25])
    expect(options).toMatchObject({ audioToVideo: true, referenceAudioUrls: [AUDIO], resolution: "720p", seed: 7 })
    expect(mocks.lay).toHaveBeenCalledWith({ videoUrl: OUT.url, audioUrl: AUDIO, jobId: "job-1", userId: "user-1", watermark: true })
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "https://r2.example.com/videos/job-1.mp4" }))
  })

  it("a job without the server's stamp is never guessed: it fails before any provider call", async () => {
    const { duration: _d, ...unstamped } = LS
    await expect(videoAIHandlers["lip-sync"]!(job("lip-sync", unstamped), ctx())).rejects.toThrow(/no measured voice/)
    expect(mocks.imageToVideo).not.toHaveBeenCalled()
  })
})
