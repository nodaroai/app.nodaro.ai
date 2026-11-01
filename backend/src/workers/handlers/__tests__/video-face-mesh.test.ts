import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  createWorkDir: vi.fn(),
  downloadFile: vi.fn(),
  cleanupWorkDir: vi.fn(),
  drawFaceMeshVideo: vi.fn(),
  uploadFileToR2: vi.fn(),
  generateAndUploadThumbnail: vi.fn(),
  setJobProgress: vi.fn(),
  shouldSaveJobResult: vi.fn(),
  markJobCompleted: vi.fn(),
  commitJobCredits: vi.fn(),
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: mocks.createWorkDir,
  downloadFile: mocks.downloadFile,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))
vi.mock("../../../services/face-mesh/draw-face-mesh.js", () => ({
  drawFaceMeshVideo: mocks.drawFaceMeshVideo,
  faceMeshOutputPath: (dir: string) => `${dir}/face-mesh.mp4`,
}))
vi.mock("../../../lib/storage.js", () => ({ uploadFileToR2: mocks.uploadFileToR2 }))
vi.mock("../../shared.js", () => ({
  generateAndUploadThumbnail: mocks.generateAndUploadThumbnail,
  setJobProgress: mocks.setJobProgress,
  shouldSaveJobResult: mocks.shouldSaveJobResult,
  markJobCompleted: mocks.markJobCompleted,
  commitJobCredits: mocks.commitJobCredits,
}))

import type { Job } from "bullmq"
import { VIDEO_FACE_MESH_RECIPE } from "@nodaro/shared/media"
import { DeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { handleVideoFaceMesh, videoFaceMeshHandlers } from "../video-face-mesh.js"

const job = (data: Record<string, unknown>) =>
  ({ name: "video-face-mesh", id: "bull-1", data: { jobId: "job-1", ...data }, updateProgress: vi.fn() }) as unknown as Job
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: true } as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/w")
  mocks.downloadFile.mockResolvedValue(undefined)
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
  mocks.drawFaceMeshVideo.mockResolvedValue({ outputPath: "/w/face-mesh.mp4", width: 720, height: 1280, frames: 505, framesWithFaces: 491, facesDrawn: 841, cpuMs: 20_000 })
  mocks.uploadFileToR2.mockResolvedValue("https://r2/mesh.mp4")
  mocks.generateAndUploadThumbnail.mockResolvedValue("https://r2/thumb.jpg")
  mocks.shouldSaveJobResult.mockResolvedValue(true)
  mocks.markJobCompleted.mockResolvedValue(true)
})

describe("videoFaceMeshHandlers", () => {
  it("registers the handler under the job name", () => {
    expect(videoFaceMeshHandlers["video-face-mesh"]).toBe(handleVideoFaceMesh)
  })
})

describe("handleVideoFaceMesh", () => {
  it("downloads the three clips, draws, uploads as it is (never watermarked) and completes with the spec's answer", async () => {
    await handleVideoFaceMesh(job({
      videoUrl: "https://x/clip.mp4", drawOnUrl: "https://x/masked.mp4", maskUrl: "https://x/mask.mp4",
      minFaceHeightPct: 4, maxFaceHeightPct: 0, zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 },
    }), ctx)
    expect(mocks.downloadFile.mock.calls).toEqual([
      ["https://x/clip.mp4", "/w/video.mp4"],
      ["https://x/masked.mp4", "/w/draw-on.mp4"],
      ["https://x/mask.mp4", "/w/mask.mp4"],
    ])
    expect(mocks.drawFaceMeshVideo).toHaveBeenCalledWith({
      videoPath: "/w/video.mp4", drawOnPath: "/w/draw-on.mp4", maskPath: "/w/mask.mp4",
      filters: { minFaceHeightPct: 4, maxFaceHeightPct: 0, zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } },
      outputPath: "/w/face-mesh.mp4",
    })
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith("/w/face-mesh.mp4", "job-1", "video", "user-1")
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: {
        videoUrl: "https://r2/mesh.mp4", thumbnailUrl: "https://r2/thumb.jpg",
        width: 720, height: 1280, frames: 505, framesWithFaces: 491, facesDrawn: 841, recipe: VIDEO_FACE_MESH_RECIPE,
      },
    })
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/w")
  })

  it("no drawOnUrl (or the same clip): drawn on the clip itself, downloaded once; no zone = null", async () => {
    await handleVideoFaceMesh(job({ videoUrl: "https://x/clip.mp4", drawOnUrl: "https://x/clip.mp4", zone: null }), ctx)
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
    expect(mocks.drawFaceMeshVideo).toHaveBeenCalledWith(expect.objectContaining({
      videoPath: "/w/video.mp4", drawOnPath: "/w/video.mp4", filters: { minFaceHeightPct: 0, maxFaceHeightPct: 0, zone: null },
    }))
    expect(mocks.drawFaceMeshVideo.mock.calls[0]![0]).not.toHaveProperty("maskPath")
  })

  it("a coloured depth map: the gray depth render downloaded and drawn from with the map; the output names the map", async () => {
    await handleVideoFaceMesh(job({
      videoUrl: "https://x/clip.mp4", drawOnUrl: "https://x/turbo.mp4", colormap: "turbo", depthUrl: "https://x/depth-gray.mp4",
    }), ctx)
    expect(mocks.downloadFile.mock.calls).toEqual([
      ["https://x/clip.mp4", "/w/video.mp4"],
      ["https://x/turbo.mp4", "/w/draw-on.mp4"],
      ["https://x/depth-gray.mp4", "/w/depth.mp4"],
    ])
    expect(mocks.drawFaceMeshVideo).toHaveBeenCalledWith(expect.objectContaining({
      drawOnPath: "/w/draw-on.mp4", depth: { path: "/w/depth.mp4", colormap: "turbo" },
    }))
    expect(mocks.markJobCompleted.mock.calls[0]![1].output_data).toMatchObject({ colormap: "turbo", recipe: VIDEO_FACE_MESH_RECIPE })
  })

  it("a depth render with no (or an unknown) colormap is grayscale; no depth render: gray tones, no colormap in the output", async () => {
    await handleVideoFaceMesh(job({ videoUrl: "https://x/clip.mp4", depthUrl: "https://x/depth-gray.mp4", colormap: "jet" }), ctx)
    expect(mocks.drawFaceMeshVideo).toHaveBeenCalledWith(expect.objectContaining({ depth: { path: "/w/depth.mp4", colormap: "grayscale" } }))
    vi.clearAllMocks()
    mocks.createWorkDir.mockResolvedValue("/w")
    mocks.drawFaceMeshVideo.mockResolvedValue({ outputPath: "/w/face-mesh.mp4", width: 720, height: 1280, frames: 505, framesWithFaces: 491, facesDrawn: 841, cpuMs: 20_000 })
    mocks.shouldSaveJobResult.mockResolvedValue(true)
    mocks.markJobCompleted.mockResolvedValue(true)
    await handleVideoFaceMesh(job({ videoUrl: "https://x/clip.mp4", colormap: "grayscale" }), ctx)
    expect(mocks.drawFaceMeshVideo.mock.calls[0]![0]).not.toHaveProperty("depth")
    expect(mocks.markJobCompleted.mock.calls[0]![1].output_data).not.toHaveProperty("colormap")
  })

  it("a coloured map with no depth render fails deterministically, before anything is downloaded", async () => {
    await expect(handleVideoFaceMesh(job({ videoUrl: "https://x/clip.mp4", colormap: "inferno" }), ctx)).rejects.toBeInstanceOf(DeterministicJobError)
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it("a cancelled job saves nothing and commits nothing; the work dir is always cleaned", async () => {
    mocks.shouldSaveJobResult.mockResolvedValue(false)
    await handleVideoFaceMesh(job({ videoUrl: "https://x/clip.mp4" }), ctx)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
    mocks.drawFaceMeshVideo.mockRejectedValue(new DeterministicJobError("face mesh: frame counts differ"))
    await expect(handleVideoFaceMesh(job({ videoUrl: "https://x/clip.mp4" }), ctx)).rejects.toBeInstanceOf(DeterministicJobError)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledTimes(2)
  })

  it("a job with no clip fails deterministically", async () => {
    await expect(handleVideoFaceMesh(job({}), ctx)).rejects.toBeInstanceOf(DeterministicJobError)
  })
})
