import { describe, it, expect, vi, beforeEach } from "vitest"
import { AI_AVATAR_MAX_AUDIO_SEC } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Mocks — ffmpeg-utils (probe/download/trim) + storage upload
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockProbeMediaDuration: vi.fn<(src: string) => Promise<number>>(),
  mockDownloadFile: vi.fn<(url: string, dest: string) => Promise<void>>(async () => {}),
  mockRunFfmpeg: vi.fn<(args: readonly string[], timeoutMs?: number) => Promise<string>>(async () => ""),
  mockCreateWorkDir: vi.fn(async () => "/tmp/ai-avatar-audio-cap-test"),
  mockCleanupWorkDir: vi.fn(async () => {}),
  mockUploadFileWithKeyToR2: vi.fn(async () => "https://r2.example.com/audios/trimmed.m4a"),
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: mocks.mockProbeMediaDuration,
  downloadFile: mocks.mockDownloadFile,
  runFfmpeg: mocks.mockRunFfmpeg,
  createWorkDir: mocks.mockCreateWorkDir,
  cleanupWorkDir: mocks.mockCleanupWorkDir,
}))

vi.mock("../../../lib/storage.js", () => ({
  uploadFileWithKeyToR2: mocks.mockUploadFileWithKeyToR2,
}))

import { capAudioForAvatar } from "../heygen-avatar-audio-cap.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockUploadFileWithKeyToR2.mockResolvedValue("https://r2.example.com/audios/trimmed.m4a")
  mocks.mockCreateWorkDir.mockResolvedValue("/tmp/ai-avatar-audio-cap-test")
})

const URL_IN = "https://r2.example.com/audio/driving.mp3"

describe("capAudioForAvatar", () => {
  it("leaves a <=600s audio untouched (no download/trim/upload, no warning)", async () => {
    mocks.mockProbeMediaDuration.mockResolvedValueOnce(AI_AVATAR_MAX_AUDIO_SEC) // exactly at the cap

    const res = await capAudioForAvatar(URL_IN, "job-1", "user-1")

    expect(res).toEqual({ audioUrl: URL_IN })
    expect(res.warning).toBeUndefined()
    expect(mocks.mockDownloadFile).not.toHaveBeenCalled()
    expect(mocks.mockRunFfmpeg).not.toHaveBeenCalled()
    expect(mocks.mockUploadFileWithKeyToR2).not.toHaveBeenCalled()
  })

  it("trims a >600s audio to exactly the cap and returns the new url + warning", async () => {
    mocks.mockProbeMediaDuration.mockResolvedValueOnce(750) // 12:30

    const res = await capAudioForAvatar(URL_IN, "job-1", "user-1")

    // ffmpeg invoked with -t 600 (the cap) and an AAC re-encode.
    expect(mocks.mockRunFfmpeg).toHaveBeenCalledTimes(1)
    const ffmpegArgs = mocks.mockRunFfmpeg.mock.calls[0]![0] as readonly string[]
    const tIdx = ffmpegArgs.indexOf("-t")
    expect(tIdx).toBeGreaterThanOrEqual(0)
    expect(ffmpegArgs[tIdx + 1]).toBe(String(AI_AVATAR_MAX_AUDIO_SEC))
    expect(ffmpegArgs).toContain("-c:a")
    expect(ffmpegArgs).toContain("aac")

    // Trimmed file uploaded; trimmed url returned.
    expect(mocks.mockUploadFileWithKeyToR2).toHaveBeenCalledTimes(1)
    expect(res.audioUrl).toBe("https://r2.example.com/audios/trimmed.m4a")

    // Warning mentions both the source length and the cap (M:SS form).
    expect(res.warning).toContain("12:30")
    expect(res.warning).toContain("10:00")

    // Workdir cleaned up.
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledTimes(1)
  })

  it("reuses a passed-in probedDurationSec instead of probing again", async () => {
    const res = await capAudioForAvatar(URL_IN, "job-1", "user-1", 120)

    expect(mocks.mockProbeMediaDuration).not.toHaveBeenCalled()
    expect(res).toEqual({ audioUrl: URL_IN })
  })

  it("is best-effort: a trim/ffmpeg failure returns the ORIGINAL url with no warning", async () => {
    mocks.mockProbeMediaDuration.mockResolvedValueOnce(900)
    mocks.mockRunFfmpeg.mockRejectedValueOnce(new Error("ffmpeg blew up"))

    const res = await capAudioForAvatar(URL_IN, "job-1", "user-1")

    expect(res).toEqual({ audioUrl: URL_IN })
    expect(res.warning).toBeUndefined()
    // Even on failure the workdir is cleaned up.
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledTimes(1)
  })

  it("is best-effort: a probe failure returns the ORIGINAL url with no warning", async () => {
    mocks.mockProbeMediaDuration.mockRejectedValueOnce(new Error("probe failed"))

    const res = await capAudioForAvatar(URL_IN, "job-1", "user-1")

    expect(res).toEqual({ audioUrl: URL_IN })
    expect(res.warning).toBeUndefined()
    expect(mocks.mockDownloadFile).not.toHaveBeenCalled()
  })
})
