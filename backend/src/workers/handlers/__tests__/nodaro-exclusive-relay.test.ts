/**
 * The exclusive-node relay (4b): what it must guarantee on a self-host —
 *   - the enqueued payload replays on the cloud at the type's own wire path,
 *     with instance-only bookkeeping stripped and media URLs re-hosted;
 *   - the CLOUD job id is persisted BEFORE polling (stall-retry resumes via
 *     reconcile instead of paying for a second generation) and a persist
 *     failure aborts the run rather than running unrecoverable;
 *   - a stop stamped before the cloud job existed is forwarded right after
 *     creation; a continue replays against the cloud's own /continue;
 *   - per-type output adaptation: JSON producers land verbatim, gvp/evp
 *     videos come home via finalizeJobWithMedia (with gvp's `pro` checkpoint
 *     carried — stop/continue read it), vcp lands audio or video.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const jobsUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const jobsUpdate = vi.fn(() => ({ eq: jobsUpdateEq }))
  const maybeSingle = vi.fn().mockResolvedValue({ data: { stop_requested_at: null } })
  const selectEq = vi.fn(() => ({ maybeSingle }))
  const jobsSelect = vi.fn(() => ({ eq: selectEq }))
  return {
    markJobCompleted: vi.fn().mockResolvedValue(true),
    generateAndUploadThumbnail: vi.fn().mockResolvedValue("https://local.r2/thumbnails/job-1.png"),
    setJobProgress: vi.fn(async () => {}),
    uploadVideoMaybeWatermark: vi.fn().mockResolvedValue("https://local.r2/videos/job-1.mp4"),
    uploadToR2: vi.fn().mockResolvedValue("https://local.r2/audio/job-1.mp3"),
    finalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }),
    createCloudJob: vi.fn().mockResolvedValue("cloud-job-1"),
    waitForCloudJob: vi.fn(),
    nodaroCloudFetch: vi.fn().mockResolvedValue({ ok: true }),
    rehostIfUrlField: vi.fn(async (_key: string, value: unknown) => value),
    jobsUpdate,
    jobsUpdateEq,
    jobsSelect,
    maybeSingle,
    from: vi.fn(() => ({ update: jobsUpdate, select: jobsSelect })),
  }
})

vi.mock("../../shared.js", () => ({
  markJobCompleted: mocks.markJobCompleted,
  generateAndUploadThumbnail: mocks.generateAndUploadThumbnail,
  setJobProgress: mocks.setJobProgress,
  uploadVideoMaybeWatermark: mocks.uploadVideoMaybeWatermark,
}))
vi.mock("../../../lib/storage.js", () => ({ uploadToR2: mocks.uploadToR2 }))
vi.mock("../../../lib/post-processing-error.js", () => ({
  // Passthrough: post-provider semantics are the callee's own tested concern.
  runPostProcessing: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeJobWithMedia }))
vi.mock("../../../providers/nodaro/client.js", () => ({
  createCloudJob: mocks.createCloudJob,
  waitForCloudJob: mocks.waitForCloudJob,
  NodaroCloudError: class NodaroCloudError extends Error {},
}))
vi.mock("../../../lib/nodaro-connect.js", () => ({ nodaroCloudFetch: mocks.nodaroCloudFetch }))
vi.mock("../../../providers/nodaro/run-on-cloud.js", () => ({
  INSTANCE_ONLY_FIELDS: new Set(["jobId", "usageLogId", "userId", "workflowId", "nodeId"]),
  rehostIfUrlField: mocks.rehostIfUrlField,
}))

import {
  nodaroExclusiveRelayHandlers,
  isNodaroExclusiveJobType,
  finalizeExclusiveCloudOutput,
} from "../nodaro-exclusive-relay.js"

const EXCLUSIVES = [
  "voice-changer-pro",
  "generate-video-pro",
  "edit-video-pro",
  "video-analysis",
  "video-audit",
] as const

const bullJob = (data: Record<string, unknown>) =>
  ({ id: "bull-1", data, updateProgress: vi.fn() }) as never
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: null, shouldWatermark: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCloudJob.mockResolvedValue("cloud-job-1")
  mocks.waitForCloudJob.mockResolvedValue({
    id: "cloud-job-1",
    status: "completed",
    output_data: { videoUrl: "https://cloud.r2/videos/cloud-job-1.mp4" },
  })
  mocks.uploadVideoMaybeWatermark.mockResolvedValue("https://local.r2/videos/job-1.mp4")
  mocks.generateAndUploadThumbnail.mockResolvedValue("https://local.r2/thumbnails/job-1.png")
  mocks.uploadToR2.mockResolvedValue("https://local.r2/audio/job-1.mp3")
  mocks.finalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.markJobCompleted.mockResolvedValue(true)
  mocks.jobsUpdateEq.mockResolvedValue({ error: null })
  mocks.maybeSingle.mockResolvedValue({ data: { stop_requested_at: null } })
  mocks.rehostIfUrlField.mockImplementation(async (_key: string, value: unknown) => value)
  mocks.nodaroCloudFetch.mockResolvedValue({ ok: true })
})

describe("handler registry", () => {
  it("serves exactly the five exclusive types", () => {
    expect(Object.keys(nodaroExclusiveRelayHandlers).sort()).toEqual([...EXCLUSIVES].sort())
    for (const t of EXCLUSIVES) expect(isNodaroExclusiveJobType(t)).toBe(true)
    expect(isNodaroExclusiveJobType("generate-image")).toBe(false)
    expect(isNodaroExclusiveJobType("generative-pipeline")).toBe(false)
  })
})

describe("relay to the cloud", () => {
  it("posts the payload at the type's wire path, stripping instance-only + __ fields and re-hosting URL fields", async () => {
    mocks.rehostIfUrlField.mockImplementation(async (key: string, value: unknown) =>
      key.endsWith("Url") ? `https://cloud-reachable/${key}` : value,
    )
    await nodaroExclusiveRelayHandlers["edit-video-pro"](
      bullJob({
        jobId: "job-1",
        usageLogId: "u-1",
        userId: "00000000-0000-4000-8000-000000000001", // local Supabase id must never ride to the cloud
        __internalFlag: true,
        videoUrl: "http://localhost:9000/v.mp4",
        instructions: "remove the boom mic",
      }),
      ctx,
    )
    expect(mocks.createCloudJob).toHaveBeenCalledWith("/v1/edit-video-pro", {
      videoUrl: "https://cloud-reachable/videoUrl",
      instructions: "remove the boom mic",
    })
  })

  it("persists provider_kind + the CLOUD job id BEFORE polling — the stall-retry resume contract", async () => {
    const order: string[] = []
    mocks.jobsUpdateEq.mockImplementation(async () => {
      order.push("persist")
      return { error: null }
    })
    mocks.waitForCloudJob.mockImplementation(async () => {
      order.push("poll")
      return { id: "cloud-job-1", status: "completed", output_data: { videoUrl: "https://c/v.mp4" } }
    })
    await nodaroExclusiveRelayHandlers["generate-video-pro"](bullJob({ prompt: "p" }), ctx)
    expect(order).toEqual(["persist", "poll"])
    expect(mocks.jobsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_kind: "nodaro-cloud",
        provider_task_id: "cloud-job-1",
        provider_call_started_at: expect.any(String),
      }),
    )
  })

  it("aborts (throws) when the task id cannot be persisted — better refunded than unrecoverable", async () => {
    mocks.jobsUpdateEq.mockResolvedValue({ error: { message: "db down" } })
    await expect(
      nodaroExclusiveRelayHandlers["video-analysis"](bullJob({ videoUrl: "https://x/v.mp4" }), ctx),
    ).rejects.toThrow(/persist cloud task id/)
    expect(mocks.waitForCloudJob).not.toHaveBeenCalled()
  })

  it("forwards a stop stamped before the cloud job existed (gvp), right after creation", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { stop_requested_at: "2026-08-18T10:00:00Z" } })
    await nodaroExclusiveRelayHandlers["generate-video-pro"](bullJob({ prompt: "p" }), ctx)
    expect(mocks.nodaroCloudFetch).toHaveBeenCalledWith("/v1/generate-video-pro/cloud-job-1/stop", {
      method: "POST",
    })
  })

  it("continue: replays against the cloud's /continue with the CLOUD parent id, never re-creating from scratch", async () => {
    await nodaroExclusiveRelayHandlers["generate-video-pro"](
      bullJob({
        prompt: "continue it",
        __nodaroContinue: { cloudFromJobId: "cloud-parent-9", fromSegment: 3 },
      }),
      ctx,
    )
    expect(mocks.createCloudJob).toHaveBeenCalledWith("/v1/generate-video-pro/continue", {
      prompt: "continue it",
      fromJobId: "cloud-parent-9",
      fromSegment: 3,
    })
  })

  it("polls with the type's own budget (gvp gets the hour-plus budget)", async () => {
    await nodaroExclusiveRelayHandlers["generate-video-pro"](bullJob({ prompt: "p" }), ctx)
    expect(mocks.waitForCloudJob).toHaveBeenCalledWith("cloud-job-1", expect.any(Function), {
      budgetMs: 85 * 60 * 1000,
    })
    vi.clearAllMocks()
    mocks.waitForCloudJob.mockResolvedValue({
      id: "c",
      status: "completed",
      output_data: { analysis: {} },
    })
    mocks.createCloudJob.mockResolvedValue("c")
    mocks.jobsUpdateEq.mockResolvedValue({ error: null })
    await nodaroExclusiveRelayHandlers["video-analysis"](bullJob({ videoUrl: "https://x/v.mp4" }), ctx)
    expect(mocks.waitForCloudJob).toHaveBeenCalledWith("c", expect.any(Function), {
      budgetMs: 30 * 60 * 1000,
    })
  })
})

describe("finalizeExclusiveCloudOutput — per-type output adaptation", () => {
  it("JSON producers (video-analysis/audit): the cloud's output lands verbatim + viaNodaroCloud, provider nodaro", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "video-audit",
      cloudJob: { id: "cloud-job-1", status: "completed", output_data: { report: { score: 9 } } } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: { report: { score: 9 }, viaNodaroCloud: true },
      provider: "nodaro",
      provider_task_id: "cloud-job-1",
    })
    expect(mocks.uploadVideoMaybeWatermark).not.toHaveBeenCalled()
  })

  it("gvp video: comes home under THIS instance's key + watermark rule, finalized with the `pro` checkpoint carried", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "generate-video-pro",
      cloudJob: {
        id: "cloud-job-1",
        status: "completed",
        output_data: { videoUrl: "https://cloud.r2/v.mp4", pro: { segments: [1, 2] } },
      } as never,
      jobUserId: "user-1",
      shouldWatermark: true,
    })
    expect(mocks.uploadVideoMaybeWatermark).toHaveBeenCalledWith(
      "https://cloud.r2/v.mp4",
      "job-1",
      "user-1",
      true,
    )
    expect(mocks.finalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        jobType: "text-to-video", // storage classification: a video deliverable
        mediaUrl: "https://local.r2/videos/job-1.mp4",
        result: { url: "https://cloud.r2/v.mp4", cost: null, providerUsed: "nodaro" },
        extraOutputData: expect.objectContaining({
          pro: { segments: [1, 2] }, // stop/continue read this checkpoint
          viaNodaroCloud: true,
          thumbnailUrl: "https://local.r2/thumbnails/job-1.png",
        }),
      }),
    )
  })

  it("vcp audio mode: re-hosts to R2 and completes with provider nodaro", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "voice-changer-pro",
      cloudJob: {
        id: "cloud-job-1",
        status: "completed",
        output_data: { audioUrl: "https://cloud.r2/a.mp3", analysis: { voice: "x" } },
      } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.uploadToR2).toHaveBeenCalledWith("https://cloud.r2/a.mp3", "job-1", "audio", "user-1")
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: { audioUrl: "https://local.r2/audio/job-1.mp3", analysis: { voice: "x" }, viaNodaroCloud: true },
      provider: "nodaro",
    })
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("vcp video mode: comes home as a video but stays a markJobCompleted (no gvp checkpoint semantics)", async () => {
    await finalizeExclusiveCloudOutput({
      jobId: "job-1",
      jobType: "voice-changer-pro",
      cloudJob: {
        id: "cloud-job-1",
        status: "completed",
        output_data: { videoUrl: "https://cloud.r2/v.mp4" },
      } as never,
      jobUserId: "user-1",
      shouldWatermark: false,
    })
    expect(mocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: {
        videoUrl: "https://local.r2/videos/job-1.mp4",
        thumbnailUrl: "https://local.r2/thumbnails/job-1.png",
        viaNodaroCloud: true,
      },
      provider: "nodaro",
    })
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("fails loudly when a media type finished with no media", async () => {
    await expect(
      finalizeExclusiveCloudOutput({
        jobId: "job-1",
        jobType: "edit-video-pro",
        cloudJob: { id: "c", status: "completed", output_data: {} } as never,
        jobUserId: "user-1",
        shouldWatermark: false,
      }),
    ).rejects.toThrow(/no media or analysis/)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.finalizeJobWithMedia).not.toHaveBeenCalled()
  })
})
