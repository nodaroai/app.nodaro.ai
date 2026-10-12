import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A failed audio re-apply never discards the paid 1080p render (decided
 * 2026-10-12): transient failures get a short bounded retry, deterministic ones
 * none; either way the picture is then delivered silent with a warning.
 */
const m = vi.hoisted(() => ({
  merge: vi.fn(),
  streams: vi.fn(),
  dur: vi.fn(),
  assertSafe: vi.fn(),
  upload: vi.fn(),
  wmUpload: vi.fn(),
}))
vi.mock("../../providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: m.merge }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: vi.fn(async () => {}),
  probeMediaStreams: m.streams,
  getVideoStreamDuration: m.dur,
  assertSafeProbeSource: m.assertSafe,
}))
vi.mock("../../workers/shared.js", () => ({ uploadVideoMaybeWatermark: m.upload, watermarkLocalVideoAndUpload: m.wmUpload }))

import { applyDraftAudioMux, DRAFT_AUDIO_NOT_REAPPLIED, isTransientMuxError, TRANSIENT_RETRY_DELAYS_MS } from "../seedance-draft-audio-apply.js"

const sleeps: number[] = []
const base = {
  videoUrl: "https://kie/hd.mp4",
  jobId: "job-hd",
  userId: "u",
  watermark: false,
  sleep: async (ms: number) => { sleeps.push(ms) },
}
const voice = { kind: "voice-track" as const, audioUrl: "https://r2/t.mp3" }

beforeEach(() => {
  vi.clearAllMocks()
  sleeps.length = 0
  m.merge.mockResolvedValue("/tmp/w/merged.mp4")
  m.streams.mockResolvedValue({ hasVideo: true, hasAudio: true })
  m.dur.mockResolvedValue(4.04)
  m.assertSafe.mockResolvedValue(undefined)
  m.upload.mockResolvedValue("https://r2/hd-silent.mp4")
  m.wmUpload.mockResolvedValue("https://r2/hd-audio.mp4")
})

describe("applyDraftAudioMux failure handling", () => {
  it("success: the muxed clip, no warning", async () => {
    expect(await applyDraftAudioMux({ ...base, mux: voice })).toEqual({ url: "https://r2/hd-audio.mp4" })
  })

  it("deterministic failure (and the copy fallback too): no retry, silent HD + warning", async () => {
    m.merge.mockRejectedValue(new Error("ffmpeg exited with code 1: Invalid data found when processing input"))
    const r = await applyDraftAudioMux({ ...base, mux: voice, draftVideoUrl: "https://r2/draft.mp4" })
    expect(r).toEqual({ url: "https://r2/hd-silent.mp4", warning: expect.objectContaining({ code: "draft_audio_not_reapplied" }) })
    expect(sleeps).toEqual([])
    expect(m.upload).toHaveBeenCalledWith("https://kie/hd.mp4", "job-hd", "u", false)
  })

  it("transient failure: short bounded retry, then success", async () => {
    m.merge.mockRejectedValueOnce(new Error("Download failed: fetch failed (ECONNRESET)")).mockResolvedValueOnce("/tmp/w/merged.mp4")
    const r = await applyDraftAudioMux({ ...base, mux: voice })
    expect(r).toEqual({ url: "https://r2/hd-audio.mp4" })
    expect(sleeps).toEqual([TRANSIENT_RETRY_DELAYS_MS[0]])
  })

  it("transient failure that persists: the bounded retries, then silent HD + warning (seconds, not ~90 min)", async () => {
    m.merge.mockRejectedValue(new Error("socket hang up"))
    const r = await applyDraftAudioMux({ ...base, mux: voice })
    expect(r.warning?.code).toBe("draft_audio_not_reapplied")
    expect(sleeps).toEqual([...TRANSIENT_RETRY_DELAYS_MS])
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThan(10_000)
  })

  it("a copy from a stored draft with no audio stream: the picture as rendered, NO warning (nothing to keep)", async () => {
    m.streams.mockResolvedValue({ hasVideo: true, hasAudio: false })
    const r = await applyDraftAudioMux({ ...base, mux: { kind: "copy-draft-audio", draftVideoUrl: "https://r2/draft.mp4" } })
    expect(r).toStrictEqual({ url: "https://r2/hd-silent.mp4" })
    expect(m.merge).not.toHaveBeenCalled()
    expect(m.dur).not.toHaveBeenCalled()
  })


  it("classifies network / storage hiccups as transient, ffmpeg refusals as deterministic", () => {
    expect(isTransientMuxError(new Error("connect ETIMEDOUT 1.2.3.4:443"))).toBe(true)
    expect(isTransientMuxError(new Error("Output file #0 does not contain any stream"))).toBe(false)
    expect(isTransientMuxError(new Error("Invalid data found when processing input"))).toBe(false)
  })

  it("a 5xx counts only in HTTP-status context, in the exact formats the downloads and probes throw", () => {
    // downloadFile → saveResponse, re-tagged by mergeVideoAudio's runPostProcessing (message copied).
    expect(isTransientMuxError(new Error("Failed to download: https://r2.example/videos/job-1.mp4 (503)"))).toBe(true)
    // ffprobe of a remote URL (probeMediaStreams / getVideoStreamDuration): libavformat's 5xx string.
    expect(isTransientMuxError(new Error("ffprobe failed: https://r2.example/d.mp4: Server returned 5XX Server Error reply\n"))).toBe(true)
    // A number that merely starts with 5 is not a status.
    expect(isTransientMuxError(new Error("Invalid frame size 544x960"))).toBe(false)
    expect(isTransientMuxError(new Error("ffmpeg exited with code 1: frame=512 fps=0.0 Error while filtering"))).toBe(false)
    // A deterministic 4xx whose URL happens to contain a 5xx-looking number.
    expect(isTransientMuxError(new Error("Failed to download: https://cdn.example/x-512.mp4 (404)"))).toBe(false)
    expect(isTransientMuxError(new Error("ffprobe failed: https://cdn.example/clip-503.mp4: Server returned 404 Not Found"))).toBe(false)
  })
})

describe("copying the stored draft's audio: only onto a take of the same length", () => {
  const copy = { kind: "copy-draft-audio" as const, draftVideoUrl: "https://r2/draft.mp4" }
  const lengths = (take: number, stored: number) =>
    m.dur.mockImplementation(async (url: string) => (url === "https://r2/draft.mp4" ? stored : take))

  it("same length (within a frame or two — video streams, not containers): the audio is copied", async () => {
    lengths(4.04, 4.0)
    const r = await applyDraftAudioMux({ ...base, mux: copy })
    expect(r).toStrictEqual({ url: "https://r2/hd-audio.mp4" })
    expect(m.merge.mock.calls).toStrictEqual([[{
      videoUrl: "https://kie/hd.mp4",
      audioTracks: [{ url: "https://r2/draft.mp4", startTime: 0, volume: 100, sourceType: "video" }],
      keepOriginalAudio: false,
    }]])
    // Both remote probes are SSRF-checked first.
    expect(m.assertSafe).toHaveBeenCalledWith("https://kie/hd.mp4")
    expect(m.assertSafe).toHaveBeenCalledWith("https://r2/draft.mp4")
  })

  it("a stored clip SHORTER than the take (Smart Loop Cut, a trim): the picture silent, WITH the warning — never truncated audio", async () => {
    lengths(4.04, 3.2)
    const r = await applyDraftAudioMux({ ...base, mux: copy })
    expect(r).toStrictEqual({ url: "https://r2/hd-silent.mp4", warning: { ...DRAFT_AUDIO_NOT_REAPPLIED } })
    expect(m.merge).not.toHaveBeenCalled()
    expect(sleeps).toEqual([]) // a length mismatch is an outcome, not a failure to retry
  })

  it("the same check guards the copy FALLBACK of a recipe whose own source failed", async () => {
    lengths(8.0, 6.5)
    m.merge.mockRejectedValueOnce(new Error("Failed to download: https://a/gone.mp3 (404)"))
    const r = await applyDraftAudioMux({ ...base, mux: voice, draftVideoUrl: "https://r2/draft.mp4" })
    expect(r).toStrictEqual({ url: "https://r2/hd-silent.mp4", warning: { ...DRAFT_AUDIO_NOT_REAPPLIED } })
    expect(m.merge).toHaveBeenCalledTimes(1) // the recipe's own try; the copy never ran
  })

  it("no audio stream (silent, no warning) and a length mismatch (silent, warning) stay distinguishable", async () => {
    m.streams.mockResolvedValue({ hasVideo: true, hasAudio: false })
    lengths(4.04, 3.2)
    expect(await applyDraftAudioMux({ ...base, mux: copy })).toStrictEqual({ url: "https://r2/hd-silent.mp4" })
    m.streams.mockResolvedValue({ hasVideo: true, hasAudio: true })
    expect((await applyDraftAudioMux({ ...base, mux: copy })).warning).toStrictEqual({ ...DRAFT_AUDIO_NOT_REAPPLIED })
  })
})
