/**
 * Bringing a relayed RENDER home (SV13, decided 2026-10-06). A Speaker View
 * final can be hours long and several GB: the generic relay path
 * (`uploadVideoMaybeWatermark`) downloads it under the flat 120-second limit
 * and then watermarks or transcodes it, so it times out or re-encodes. A
 * render of the user's own footage is copied as it is — under the big-media
 * download limits, with no transcode and no watermark — and its thumbnail is
 * cut from the local copy, never by downloading the file a second time.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  createWorkDir: vi.fn(async () => "/tmp/relay-render-1"),
  cleanupWorkDir: vi.fn(async () => {}),
  downloadFile: vi.fn(async () => {}),
  uploadFileToR2: vi.fn(async () => "https://local.r2/videos/job-1.mp4"),
  uploadBufferToR2: vi.fn(async () => "https://local.r2/thumbnails/job-1.png"),
  thumbnailFromLocalVideo: vi.fn(async () => Buffer.from("PNG")),
  runPostProcessing: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  watermark: vi.fn(),
  transcode: vi.fn(),
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  BIG_MEDIA_DOWNLOAD_LIMITS: { tag: "big-media" },
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
  downloadFile: mocks.downloadFile,
  applyVideoWatermark: mocks.watermark,
  transcodeToBrowserSafe: mocks.transcode,
}))
vi.mock("../../../lib/storage.js", () => ({
  uploadFileToR2: mocks.uploadFileToR2,
  uploadBufferToR2: mocks.uploadBufferToR2,
}))
vi.mock("../../../utils/thumbnail.js", () => ({ thumbnailFromLocalVideo: mocks.thumbnailFromLocalVideo }))
vi.mock("../../../lib/post-processing-error.js", () => ({ runPostProcessing: mocks.runPostProcessing }))

import { bringRenderHome } from "../relay-render-home.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.thumbnailFromLocalVideo.mockResolvedValue(Buffer.from("PNG"))
})

describe("bringRenderHome", () => {
  it("copies the file as it is: big-media limits, no watermark, no transcode, thumbnail from the local copy", async () => {
    const out = await bringRenderHome("https://cloud.r2/videos/sv-1.mp4", "job-1", "user-1")
    expect(out).toEqual({ videoUrl: "https://local.r2/videos/job-1.mp4", thumbnailUrl: "https://local.r2/thumbnails/job-1.png" })
    expect(mocks.downloadFile).toHaveBeenCalledWith(
      "https://cloud.r2/videos/sv-1.mp4",
      "/tmp/relay-render-1/render.mp4",
      { limits: { tag: "big-media" } },
    )
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith("/tmp/relay-render-1/render.mp4", "job-1", "video", "user-1")
    expect(mocks.thumbnailFromLocalVideo).toHaveBeenCalledWith("/tmp/relay-render-1/render.mp4")
    expect(mocks.uploadBufferToR2).toHaveBeenCalledWith(Buffer.from("PNG"), "thumbnails/job-1.png", "image/png", "user-1")
    expect(mocks.watermark).not.toHaveBeenCalled()
    expect(mocks.transcode).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/relay-render-1")
  })

  it("is post-provider work: the far end has already billed, so a failure here never refunds", async () => {
    await bringRenderHome("https://cloud.r2/videos/sv-1.mp4", "job-1", "user-1")
    expect(mocks.runPostProcessing).toHaveBeenCalledTimes(1)
    expect(mocks.downloadFile.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.runPostProcessing.mock.invocationCallOrder[0]!)
  })

  it("a thumbnail that fails is no thumbnail, never a failed render", async () => {
    mocks.thumbnailFromLocalVideo.mockRejectedValueOnce(new Error("no frame"))
    const out = await bringRenderHome("https://cloud.r2/videos/sv-1.mp4", "job-1", "user-1")
    expect(out).toEqual({ videoUrl: "https://local.r2/videos/job-1.mp4", thumbnailUrl: null })
  })

  it("cleans up its work dir when the copy fails, and rethrows", async () => {
    mocks.downloadFile.mockRejectedValueOnce(new Error("Download timeout: no response within 120 s"))
    await expect(bringRenderHome("https://cloud.r2/videos/sv-1.mp4", "job-1", "user-1")).rejects.toThrow(/Download timeout/)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/relay-render-1")
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled()
  })
})
