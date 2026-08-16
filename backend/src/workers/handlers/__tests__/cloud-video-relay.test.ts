/**
 * relayVideoJobToCloud — the fallthrough for vendor-direct video nodes
 * (HeyGen avatars, Beeble relight) on a keyless connected install. What it
 * must guarantee:
 *   - the job's own payload replays on the cloud as the SAME job type;
 *   - the cloud's finished video is brought home: re-hosted into this
 *     instance's storage with THIS instance's watermark decision, thumbnailed,
 *     and finalized as a local job — provider "nodaro", no local cost;
 *   - a cloud job with no video fails loudly instead of finalizing an empty
 *     result.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  runJobOnCloud: vi.fn(),
  uploadVideoMaybeWatermark: vi.fn(),
  generateAndUploadThumbnail: vi.fn(),
  setJobProgress: vi.fn(async () => {}),
  finalizeJobWithMedia: vi.fn(),
}))

vi.mock("../../../providers/nodaro/run-on-cloud.js", () => ({
  runJobOnCloud: mocks.runJobOnCloud,
}))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
    generateAndUploadThumbnail: mocks.generateAndUploadThumbnail,
    setJobProgress: mocks.setJobProgress,
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})
vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.finalizeJobWithMedia,
}))

import { relayVideoJobToCloud } from "../cloud-video-relay.js"

const job = {
  id: "bull-1",
  data: { jobId: "job-1", engine: "avatar-iv", avatarId: "a1", speechMode: "text", script: "hi", usageLogId: "u1" },
  updateProgress: vi.fn(),
} as never
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "u1", shouldWatermark: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runJobOnCloud.mockResolvedValue({ videoUrl: "https://cloud.r2/videos/cloud-job.mp4", durationSec: 6.5, thumbnailUrl: "https://cloud.r2/t.png" })
  mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://local.r2/videos/job-1.mp4")
  mocks.generateAndUploadThumbnail.mockResolvedValue("https://local.r2/thumbnails/job-1.png")
  mocks.finalizeJobWithMedia.mockResolvedValue({ ok: true })
})

describe("relayVideoJobToCloud", () => {
  it("replays the job's own payload on the cloud as the same job type", async () => {
    await relayVideoJobToCloud(job, ctx, "ai-avatar")
    expect(mocks.runJobOnCloud).toHaveBeenCalledWith("ai-avatar", (job as { data: unknown }).data, expect.any(Function))
  })

  it("brings the cloud video home — this instance's storage, this instance's watermark rule — and finalizes as a local job", async () => {
    await relayVideoJobToCloud(job, ctx, "ai-avatar")
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith("https://cloud.r2/videos/cloud-job.mp4", "job-1", "user-1", true)
    expect(mocks.generateAndUploadThumbnail).toHaveBeenCalledWith("https://local.r2/videos/job-1.mp4", "job-1", "user-1")
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        jobType: "ai-avatar",
        mediaUrl: "https://local.r2/videos/job-1.mp4",
        // Billed on the cloud side to the connected account — nothing local.
        result: { url: "https://cloud.r2/videos/cloud-job.mp4", cost: null, providerUsed: "nodaro" },
        extraOutputData: expect.objectContaining({
          thumbnailUrl: "https://local.r2/thumbnails/job-1.png", // OUR thumbnail, not the cloud's
          durationSec: 6.5,
          viaNodaroCloud: true,
        }),
      }),
    )
  })

  it("carries the cloud's warning through (a trimmed audio must still be said)", async () => {
    mocks.runJobOnCloud.mockResolvedValue({ videoUrl: "https://cloud.r2/v.mp4", warningMessage: "audio trimmed to 600s" })
    await relayVideoJobToCloud(job, ctx, "ai-avatar")
    const call = mocks.finalizeJobWithMedia.mock.calls[0]?.[0] as { extraOutputData: Record<string, unknown> }
    expect(call.extraOutputData.warningMessage).toBe("audio trimmed to 600s")
  })

  it("fails loudly when the cloud job finished without a video, and finalizes nothing", async () => {
    mocks.runJobOnCloud.mockResolvedValue({ status: "completed" })
    await expect(relayVideoJobToCloud(job, ctx, "switchx")).rejects.toThrow(/returned no video/)
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("propagates the cloud's refusal (insufficient credits, revoked connection) untouched — the caller's error path reports it", async () => {
    mocks.runJobOnCloud.mockRejectedValue(new Error("nodaro.ai: Insufficient nodaro.ai credits — top up or upgrade your connected account."))
    await expect(relayVideoJobToCloud(job, ctx, "cinematic-avatar")).rejects.toThrow(/Insufficient nodaro.ai credits/)
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })
})
