import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The video-upscale handler's Seedance draft finalize: the 1080p render gets
 * the draft's post-render audio mux re-applied (decided 2026-10-12) — a voiced
 * or audio-merged draft's HD carries its audio — while a plain draft's HD is
 * uploaded as rendered, with no audio added.
 */
const mocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  apply: vi.fn(),
  upload: vi.fn(),
  finalizeJob: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) },
}))
vi.mock("../../../providers/kie/seedance-draft.js", () => ({ runSeedanceDraftFinalize: mocks.finalize }))
vi.mock("../../../lib/seedance-draft-audio-apply.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/seedance-draft-audio-apply.js")>()),
  applyDraftAudioMux: mocks.apply,
}))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeJob }))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.upload,
    generateAndUploadThumbnail: vi.fn().mockResolvedValue(null),
    setJobProgress: vi.fn(async () => {}),
    withProgressRamp: vi.fn(async (_j: unknown, _i: unknown, _o: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

import { videoAIHandlers } from "../video-ai.js"

const ctx = { jobId: "job-hd", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: true }
const job = (data: Record<string, unknown>) => ({ name: "video-upscale", data: { jobId: "job-hd", provider: "seedance-2-5-hd", kieTaskId: "task-draft", ...data }, id: "b", updateProgress: vi.fn() })
const HD = "https://kie.example/hd.mp4"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.finalize.mockResolvedValue({ url: HD, kieTaskId: "task-final" })
  mocks.apply.mockResolvedValue({ url: "https://r2.example/hd-with-audio.mp4" })
  mocks.upload.mockResolvedValue("https://r2.example/hd.mp4")
  mocks.finalizeJob.mockResolvedValue({ ok: true })
})

describe("video-upscale seedance-2-5-hd — the draft's audio mux", () => {
  it("re-applies a voiced draft's voice track to the 1080p render (watermark honoured) and delivers that clip", async () => {
    const mux = { kind: "voice-track", audioUrl: "https://r2.example/track.mp3" }
    await videoAIHandlers["video-upscale"](job({ draftAudioMux: mux, draftVideoUrl: "https://r2.example/draft.mp4" }) as never, ctx as never)
    expect(mocks.finalize).toHaveBeenCalledWith("task-draft", expect.anything())
    expect(mocks.apply).toHaveBeenCalledWith({
      videoUrl: HD, mux, draftVideoUrl: "https://r2.example/draft.mp4", jobId: "job-hd", userId: "user-1", watermark: true,
    })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.finalizeJob.mock.calls[0]![0]).toMatchObject({ mediaUrl: "https://r2.example/hd-with-audio.mp4" })
  })

  it("re-applies an audioUrl merge with its own settings", async () => {
    const mux = { kind: "audio-track", audioUrl: "https://a/vo.mp3", voiceoverVolume: 100, backgroundVolume: 30, keepOriginalAudio: true }
    await videoAIHandlers["video-upscale"](job({ draftAudioMux: mux }) as never, ctx as never)
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ mux }))
  })

  it("audio that could not be re-applied: the silent HD is delivered (job completes, charged) with a visible warning", async () => {
    mocks.apply.mockResolvedValueOnce({
      url: "https://r2.example/hd-silent.mp4",
      warning: { code: "draft_audio_not_reapplied", message: "The 1080p video was delivered without the draft's audio" },
    })
    await videoAIHandlers["video-upscale"](job({ draftAudioMux: { kind: "voice-track", audioUrl: "https://r2/t.mp3" } }) as never, ctx as never)
    const arg = mocks.finalizeJob.mock.calls[0]![0] as { mediaUrl: string; extraOutputData: Record<string, unknown> }
    expect(arg.mediaUrl).toBe("https://r2.example/hd-silent.mp4")
    expect(arg.extraOutputData).toMatchObject({ warningCode: "draft_audio_not_reapplied", warningMessage: expect.stringContaining("without the draft's audio") })
  })

  it("a plain draft's 1080p render is uploaded as rendered — no audio added", async () => {
    await videoAIHandlers["video-upscale"](job({}) as never, ctx as never)
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.upload).toHaveBeenCalledWith(HD, "job-hd", "user-1", true)
    expect(mocks.finalizeJob.mock.calls[0]![0]).toMatchObject({ mediaUrl: "https://r2.example/hd.mp4" })
    expect((mocks.finalizeJob.mock.calls[0]![0] as { extraOutputData: Record<string, unknown> }).extraOutputData).not.toHaveProperty("warningCode")
  })

  it("ignores a malformed recipe (never trusts the payload's shape)", async () => {
    await videoAIHandlers["video-upscale"](job({ draftAudioMux: { kind: "voice-track" } }) as never, ctx as never)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
