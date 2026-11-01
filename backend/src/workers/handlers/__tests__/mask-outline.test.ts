/**
 * `mask-outline` worker handler (handlers/mask-outline.ts): validation (a
 * malformed outline fails the job rather than shifting which answer is
 * whose), the two downloads, the drawing, the upload as it is and the
 * completion with the route's answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  createWorkDir: vi.fn(),
  downloadFile: vi.fn(),
  cleanupWorkDir: vi.fn(),
  drawMaskOutlineVideo: vi.fn(),
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
vi.mock("../../../services/mask-outline/draw-mask-outline.js", () => ({
  MASK_OUTLINE_RECIPE: "mask-outline-test",
  drawMaskOutlineVideo: mocks.drawMaskOutlineVideo,
  maskOutlineOutputPath: (dir: string) => `${dir}/mask-outline.mp4`,
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
import { DeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { handleMaskOutline, maskOutlineHandlers } from "../mask-outline.js"
import { videoMaskHandlers } from "../video-mask.js"

const BOX = { fromFrame: 0, toFrame: 99, leftPct: 0, topPct: 0, rightPct: 50, bottomPct: 100 }
const OUTLINES = [{ colour: "#FF00FF", boxes: [BOX] }, { colour: "#FFE600", boxes: [{ ...BOX, leftPct: 50, rightPct: 100 }] }]
const job = (data: Record<string, unknown>) =>
  ({ name: "mask-outline", id: "bull-1", data: { jobId: "job-1", ...data }, updateProgress: vi.fn() }) as unknown as Job
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: true } as never
const BODY = { videoUrl: "https://x/filled.mp4", maskUrl: "https://x/mask.mp4", outlines: OUTLINES }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/w")
  mocks.downloadFile.mockResolvedValue(undefined)
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
  mocks.drawMaskOutlineVideo.mockResolvedValue({
    outputPath: "/w/mask-outline.mp4", width: 720, height: 1280, frames: 360,
    perOutline: [{ framesDrawn: 300, regionsDrawn: 310 }, { framesDrawn: 0, regionsDrawn: 0 }], ambiguous: 4, strokePx: 4,
  })
  mocks.uploadFileToR2.mockResolvedValue("https://r2/outlined.mp4")
  mocks.generateAndUploadThumbnail.mockResolvedValue("https://r2/thumb.jpg")
  mocks.shouldSaveJobResult.mockResolvedValue(true)
  mocks.markJobCompleted.mockResolvedValue(true)
})

describe("maskOutlineHandlers", () => {
  it("registers the handler under the job name, in the mask family's map the video worker spreads", () => {
    expect(maskOutlineHandlers["mask-outline"]).toBe(handleMaskOutline)
    expect(videoMaskHandlers["mask-outline"]).toBe(handleMaskOutline)
  })
})

describe("handleMaskOutline", () => {
  it("downloads the clip and its mask, draws, uploads as it is (never watermarked) and completes with the answer", async () => {
    await handleMaskOutline(job(BODY), ctx)
    expect(mocks.downloadFile.mock.calls).toEqual([
      ["https://x/filled.mp4", "/w/video.mp4"],
      ["https://x/mask.mp4", "/w/mask.mp4"],
    ])
    expect(mocks.drawMaskOutlineVideo).toHaveBeenCalledWith({
      videoPath: "/w/video.mp4", maskPath: "/w/mask.mp4", outlines: OUTLINES, outputPath: "/w/mask-outline.mp4",
    })
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith("/w/mask-outline.mp4", "job-1", "video", "user-1")
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: {
        videoUrl: "https://r2/outlined.mp4", thumbnailUrl: "https://r2/thumb.jpg", width: 720, height: 1280, frames: 360,
        perOutline: [{ framesDrawn: 300, regionsDrawn: 310 }, { framesDrawn: 0, regionsDrawn: 0 }], ambiguous: 4, strokePx: 4,
        recipe: "mask-outline-test",
      },
    })
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/w")
  })

  it("fails deterministically, drawing nothing, without a clip, a mask or an outline", async () => {
    for (const data of [{ ...BODY, videoUrl: undefined }, { ...BODY, maskUrl: "" }, { ...BODY, outlines: [] }, { ...BODY, outlines: undefined }]) {
      await expect(handleMaskOutline(job(data), ctx), JSON.stringify(data)).rejects.toBeInstanceOf(DeterministicJobError)
    }
    expect(mocks.drawMaskOutlineVideo).not.toHaveBeenCalled()
  })

  it("a malformed outline among good ones fails the job: never dropped, which would shift whose answer is whose", async () => {
    for (const bad of [{ colour: "magenta", boxes: [BOX] }, { colour: "#FF00FF", boxes: [] }, { colour: "#FF00FF" }]) {
      await expect(handleMaskOutline(job({ ...BODY, outlines: [OUTLINES[0], bad, OUTLINES[1]] }), ctx)).rejects.toBeInstanceOf(DeterministicJobError)
    }
    expect(mocks.drawMaskOutlineVideo).not.toHaveBeenCalled()
  })

  it("a cancelled job saves nothing and commits nothing; a drawing failure cleans the work dir", async () => {
    mocks.shouldSaveJobResult.mockResolvedValue(false)
    await handleMaskOutline(job(BODY), ctx)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
    mocks.drawMaskOutlineVideo.mockRejectedValue(new DeterministicJobError("mask outline: not this video's mask"))
    await expect(handleMaskOutline(job(BODY), ctx)).rejects.toBeInstanceOf(DeterministicJobError)
    expect(mocks.cleanupWorkDir).toHaveBeenCalledTimes(2)
  })
})
