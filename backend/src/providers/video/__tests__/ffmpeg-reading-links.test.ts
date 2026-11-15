/**
 * The toolkit's ffmpeg runners hand a local-path argv to the plain runner
 * exactly as given, and give a link's run the guard's options and the
 * guard's environment (`ffmpeg-reading-links.ts`). The real ffmpeg reads are
 * in `probe-guard.e2e.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../ffmpeg-utils.js", () => ({
  runFfmpeg: vi.fn(async () => "stdout"),
  runFfmpegCapture: vi.fn(async () => ({ stdout: "stdout", stderr: "stderr" })),
  transcodeToBrowserSafe: vi.fn(async (_input: string, output: string) => output),
  remuxToMp4: vi.fn(async () => undefined),
  probeVideoStreamSource: vi.fn(),
  probeFirstAudioCodecSource: vi.fn(),
  browserSafeTranscodeArgs: vi.fn(),
  buildRemuxArgs: vi.fn(),
  videoStreamNeedsTranscode: vi.fn(),
}))

import { probeFirstAudioCodecSource, probeVideoStreamSource, remuxToMp4, runFfmpeg, runFfmpegCapture, transcodeToBrowserSafe } from "../ffmpeg-utils.js"
import { ffmpegLinkInputArgs, isProbeGuardEnv, probeNetwork } from "../probe-guard.js"
import { remuxToMp4ReadingLinks, runFfmpegCaptureReadingLinks, runFfmpegReadingLinks, transcodeToBrowserSafeReadingLinks } from "../ffmpeg-reading-links.js"

beforeEach(() => {
  vi.spyOn(probeNetwork, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("toolkit ffmpeg runners", () => {
  it("a local-path argv reaches the plain runner untouched: the same arguments, its timeout, no environment of the guard's", async () => {
    const args = ["-y", "-protocol_whitelist", "file", "-i", "/tmp/in.mp4", "-vf", "hue=s=0", "/tmp/out.mp4"]
    expect(await runFfmpegReadingLinks(args, 5_000)).toBe("stdout")
    expect(vi.mocked(runFfmpeg).mock.calls).toEqual([[args, 5_000]])
    expect(await runFfmpegCaptureReadingLinks(args)).toEqual({ stdout: "stdout", stderr: "stderr" })
    expect(vi.mocked(runFfmpegCapture).mock.calls).toEqual([[args, undefined]])
    expect(probeNetwork.lookup).not.toHaveBeenCalled()
  })

  it("a link's run gets the guard's options right before its -i, and the guard's environment", async () => {
    const link = "https://cdn.example/clip.mov"
    expect(await runFfmpegReadingLinks(["-y", "-ss", "1", "-i", link, "-i", "/tmp/a.wav", "/tmp/out.mp4"], 9_000)).toBe("stdout")
    expect(runFfmpeg).not.toHaveBeenCalled()
    const [argv, timeoutMs, launch] = vi.mocked(runFfmpegCapture).mock.calls[0]!
    expect(argv).toEqual(["-y", "-ss", "1", ...ffmpegLinkInputArgs(), "-i", link, "-i", "/tmp/a.wav", "/tmp/out.mp4"])
    expect(timeoutMs).toBe(9_000)
    expect(isProbeGuardEnv(launch?.env)).toBe(true)
    expect(launch?.env?.http_proxy).toMatch(/^http:\/\/probe:[^@]+@127\.0\.0\.1:\d+$/)
  })

  it("the encoders hand local paths to the plain functions untouched, and refuse a link output before reading anything", async () => {
    expect(await transcodeToBrowserSafeReadingLinks("/tmp/in.webm", "/tmp/out.mp4")).toBe("/tmp/out.mp4")
    expect(vi.mocked(transcodeToBrowserSafe).mock.calls).toEqual([["/tmp/in.webm", "/tmp/out.mp4"]])
    await remuxToMp4ReadingLinks("/tmp/in.mkv", "/tmp/out.mp4")
    expect(vi.mocked(remuxToMp4).mock.calls).toEqual([["/tmp/in.mkv", "/tmp/out.mp4"]])
    expect(probeVideoStreamSource).not.toHaveBeenCalled()
    expect(probeFirstAudioCodecSource).not.toHaveBeenCalled()
    expect(runFfmpegCapture).not.toHaveBeenCalled()
    await expect(transcodeToBrowserSafeReadingLinks("/tmp/in.webm", "https://cdn.example/out.mp4")).rejects.toMatchObject({ reason: "link" })
    await expect(remuxToMp4ReadingLinks("/tmp/in.mkv", "https://cdn.example/out.mp4")).rejects.toMatchObject({ reason: "link" })
    expect(transcodeToBrowserSafe).toHaveBeenCalledTimes(1)
    expect(remuxToMp4).toHaveBeenCalledTimes(1)
  })
})
