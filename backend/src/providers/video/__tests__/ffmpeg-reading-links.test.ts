// @test-reads-none reads only the option files it writes to its own temp dir, and the private copies the runners make of them
/**
 * The toolkit's ffmpeg runners hand a local-path argv to the plain runner
 * exactly as given, and give a link's run the guard's options and the
 * guard's environment (`ffmpeg-reading-links.ts`). The real ffmpeg reads are
 * in `probe-guard.e2e.test.ts`.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

const dir = mkdtempSync(join(tmpdir(), "reading-links-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const optionFile = (name: string, text: string) => {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

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

  it("a file an option reads its value from is checked on every run: a link in it is refused before any runner starts; a clean one runs exactly as given", async () => {
    const named = optionFile("named.txt", "movie='https\\://cdn.example/secret.mp4'[m];[0:v][m]overlay")
    const clean = optionFile("clean.txt", "movie=/tmp/local.mp4[m];[0:v][m]overlay")
    for (const option of ["-/filter_complex", "-filter_complex_script", "-/vf"]) {
      await expect(runFfmpegReadingLinks(["-y", "-i", "/tmp/in.mp4", option, named, "/tmp/out.mp4"])).rejects.toMatchObject({ reason: "link" })
      await expect(runFfmpegCaptureReadingLinks(["-y", "-i", "/tmp/in.mp4", option, named, "-f", "null", "-"])).rejects.toMatchObject({ reason: "link" })
    }
    // Not a plain local file: not checked, so refused.
    await expect(runFfmpegReadingLinks(["-y", "-i", "/tmp/in.mp4", "-/filter_complex", join(dir, "missing.txt"), "/tmp/out.mp4"])).rejects.toMatchObject({ reason: "link" })
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(runFfmpegCapture).not.toHaveBeenCalled()
    expect(probeNetwork.lookup).not.toHaveBeenCalled()
    // The run reads a private copy of the file it checked, never the plugin's own (which could change in between).
    let copied: { path: string; text: string; mode: number } | undefined
    vi.mocked(runFfmpeg).mockImplementationOnce(async (argv) => {
      const path = argv[4]!
      copied = { path, text: readFileSync(path, "utf8"), mode: statSync(path).mode & 0o777 }
      writeFileSync(clean, "movie='https\\://cdn.example/swapped.mp4'") // a swap after the check reaches nothing
      return "stdout"
    })
    const args = ["-y", "-i", "/tmp/in.mp4", "-/filter_complex", clean, "/tmp/out.mp4"]
    expect(await runFfmpegReadingLinks(args, 7_000)).toBe("stdout")
    const [[argv, timeoutMs]] = vi.mocked(runFfmpeg).mock.calls as unknown as [[string[], number]]
    expect(timeoutMs).toBe(7_000)
    expect(argv).toEqual(["-y", "-i", "/tmp/in.mp4", "-/filter_complex", copied!.path, "/tmp/out.mp4"])
    expect(copied!.path).not.toBe(clean)
    expect(copied!.text).toBe("movie=/tmp/local.mp4[m];[0:v][m]overlay")
    expect(copied!.mode).toBe(0o600)
    // Removed once the run settles.
    expect(existsSync(copied!.path)).toBe(false)
  })

  it("a run that reads a link cannot set the guard's options from a file either", async () => {
    const list = optionFile("list.txt", "file,http,https,tcp,tls")
    await expect(runFfmpegReadingLinks(["-y", "-/protocol_whitelist", list, "-i", "https://cdn.example/clip.mov", "/tmp/out.mp4"])).rejects.toThrow(/the probe guard's own options \(-\/protocol_whitelist\)/)
    expect(runFfmpegCapture).not.toHaveBeenCalled()
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
