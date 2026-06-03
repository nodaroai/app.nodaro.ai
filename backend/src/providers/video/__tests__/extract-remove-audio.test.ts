/**
 * Tests for the two audio-demux node providers:
 *  - extract-audio.ts → video in → MP3 out (`-vn`, fails on silent clips)
 *  - remove-audio.ts  → video in → silent video out (`-c:v copy -an`, lossless)
 *
 * Mocks ffmpeg-utils at the module boundary (same shape as the batch tests).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  runFfmpeg: vi.fn().mockResolvedValue(""),
  hasAudioStream: vi.fn().mockResolvedValue(true),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/work"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  hasAudioStream: mocks.hasAudioStream,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))

import { extractAudio } from "../extract-audio.js"
import { removeAudio } from "../remove-audio.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
  mocks.hasAudioStream.mockResolvedValue(true)
  mocks.runFfmpeg.mockResolvedValue("")
})

const ffargs = (): string[] => (mocks.runFfmpeg.mock.calls.at(-1)?.[0] as string[]) ?? []

describe("extractAudio", () => {
  it("returns the extracted mp3 path", async () => {
    const result = await extractAudio({ videoUrl: "https://x/v.mp4" })
    expect(result.audioPath).toBe("/tmp/work/audio.mp3")
  })

  it("emits -vn (strip video) with libmp3lame, never -an", async () => {
    await extractAudio({ videoUrl: "u" })
    const args = ffargs()
    expect(args).toContain("-vn")
    expect(args).toContain("libmp3lame")
    expect(args).not.toContain("-an")
  })

  it("throws + cleans up + skips ffmpeg when the video has no audio track", async () => {
    mocks.hasAudioStream.mockResolvedValueOnce(false)
    await expect(extractAudio({ videoUrl: "u" })).rejects.toThrow(/no audio track/i)
    expect(mocks.runFfmpeg).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })

  it("cleans up the work dir on ffmpeg failure", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(new Error("boom"))
    await expect(extractAudio({ videoUrl: "u" })).rejects.toThrow("boom")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })
})

describe("removeAudio", () => {
  it("returns the silent video path", async () => {
    const result = await removeAudio({ videoUrl: "https://x/v.mp4" })
    expect(result.videoPath).toBe("/tmp/work/silent.mp4")
  })

  it("stream-copies the video and drops audio (-c:v copy -an, no re-encode)", async () => {
    await removeAudio({ videoUrl: "u" })
    const args = ffargs()
    expect(args).toContain("-an")
    const ci = args.indexOf("-c:v")
    expect(args[ci + 1]).toBe("copy")
    expect(args).not.toContain("libx264")
  })

  it("does not probe for an audio stream (works on silent clips too)", async () => {
    await removeAudio({ videoUrl: "u" })
    expect(mocks.hasAudioStream).not.toHaveBeenCalled()
  })

  it("cleans up the work dir on ffmpeg failure", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(new Error("boom"))
    await expect(removeAudio({ videoUrl: "u" })).rejects.toThrow("boom")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })
})
