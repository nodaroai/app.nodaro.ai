import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn(),
  createWorkDir: vi.fn(),
  cleanupWorkDir: vi.fn(),
}))

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))

import { grayscaleVideo } from "../grayscale-video.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
  mocks.downloadFile.mockResolvedValue(undefined)
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
})

describe("grayscaleVideo", () => {
  it("downloads the source and re-encodes it gray → even size → yuv420p with the exact argv", async () => {
    const out = await grayscaleVideo("https://replicate.delivery/depth.mp4")

    expect(mocks.createWorkDir).toHaveBeenCalledWith("grayscale-video")
    expect(mocks.downloadFile).toHaveBeenCalledWith("https://replicate.delivery/depth.mp4", "/tmp/work/input.mp4")
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1)
    expect(mocks.runFfmpeg).toHaveBeenCalledWith([
      "-y", "-i", "/tmp/work/input.mp4",
      "-vf", "format=gray,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-an", "-movflags", "+faststart",
      "/tmp/work/output.mp4",
    ])
    expect(out).toEqual({ outputPath: "/tmp/work/output.mp4", workDir: "/tmp/work" })
    // The caller owns the work dir on success (it still has to upload the file).
    expect(mocks.cleanupWorkDir).not.toHaveBeenCalled()
  })

  it("cleans the work dir and rethrows when ffmpeg fails", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(new Error("ffmpeg failed: boom"))
    await expect(grayscaleVideo("https://x/v.mp4")).rejects.toThrow("ffmpeg failed: boom")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })

  it("cleans the work dir and rethrows when the download fails", async () => {
    mocks.downloadFile.mockRejectedValueOnce(new Error("Failed to download"))
    await expect(grayscaleVideo("https://x/v.mp4")).rejects.toThrow("Failed to download")
    expect(mocks.runFfmpeg).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })
})
