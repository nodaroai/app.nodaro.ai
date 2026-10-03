/**
 * Face Swap's upload keeps the source clip's sound. The swap model returns the
 * picture with NO audio stream, so every swapped clip lost its dialogue and
 * ambience. The mux itself (`restoreVideoAudioFromSource`) is covered against
 * real ffmpeg by caption-audio-restore.e2e; this pins which file is delivered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  createWorkDir: vi.fn(async () => "/tmp/face-swap-audio-1"),
  cleanupWorkDir: vi.fn(async () => {}),
  downloadFile: vi.fn(async () => {}),
  restoreVideoAudioFromSource: vi.fn(async () => true),
  watermarkLocalVideoAndUpload: vi.fn(async () => "https://r2.example/videos/job-1.mp4"),
  uploadVideoMaybeWatermark: vi.fn(async () => "https://r2.example/videos/job-1.mp4"),
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
  downloadFile: mocks.downloadFile,
  restoreVideoAudioFromSource: mocks.restoreVideoAudioFromSource,
}))
vi.mock("../../shared.js", () => ({
  watermarkLocalVideoAndUpload: mocks.watermarkLocalVideoAndUpload,
  uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
}))

import { uploadSwapWithSourceAudio } from "../face-swap-audio.js"

const SWAP = "https://replicate.example/out.mp4"
const SOURCE = "https://cdn.example/clip.mp4"
const target = { jobId: "job-1", jobUserId: "user-1", shouldWatermark: true }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("uploadSwapWithSourceAudio", () => {
  it("delivers the swap with the source's sound laid back on it", async () => {
    const url = await uploadSwapWithSourceAudio(SWAP, SOURCE, target)

    expect(mocks.downloadFile).toHaveBeenCalledWith(SWAP, "/tmp/face-swap-audio-1/swapped.mp4")
    expect(mocks.downloadFile).toHaveBeenCalledWith(SOURCE, "/tmp/face-swap-audio-1/source.mp4")
    expect(mocks.restoreVideoAudioFromSource).toHaveBeenCalledWith(
      "/tmp/face-swap-audio-1/swapped.mp4",
      "/tmp/face-swap-audio-1/source.mp4",
      "/tmp/face-swap-audio-1/with-audio.mp4",
    )
    expect(mocks.watermarkLocalVideoAndUpload).toHaveBeenCalledWith("/tmp/face-swap-audio-1/with-audio.mp4", "job-1", "user-1", true)
    expect(url).toBe("https://r2.example/videos/job-1.mp4")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/face-swap-audio-1")
  })

  it("delivers the swap as it came back when the source has no sound", async () => {
    mocks.restoreVideoAudioFromSource.mockResolvedValueOnce(false)

    await uploadSwapWithSourceAudio(SWAP, SOURCE, target)

    expect(mocks.watermarkLocalVideoAndUpload).toHaveBeenCalledWith("/tmp/face-swap-audio-1/swapped.mp4", "job-1", "user-1", true)
  })

  it("still delivers the swap, silent, when restoring the sound fails", async () => {
    // The swap downloads; the source does not.
    mocks.downloadFile
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => { throw new Error("404 Not Found") })

    const url = await uploadSwapWithSourceAudio(SWAP, SOURCE, target)

    expect(mocks.watermarkLocalVideoAndUpload).not.toHaveBeenCalled()
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(SWAP, "job-1", "user-1", true)
    expect(url).toBe("https://r2.example/videos/job-1.mp4")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/face-swap-audio-1")
  })

  it("cleans up even when the upload itself fails", async () => {
    mocks.watermarkLocalVideoAndUpload.mockRejectedValueOnce(new Error("R2 down"))

    await expect(uploadSwapWithSourceAudio(SWAP, SOURCE, target)).rejects.toThrow("R2 down")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/face-swap-audio-1")
  })
})
