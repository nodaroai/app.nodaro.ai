import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A Grok Imagine video job (`grok` / `grok-i2v`) that made a provider task
 * records, on its output beside that task, the resolution its request RECORDED
 * (`input_data.resolution`, exactly as stored) — the fact a Grok Extend's
 * charge reads off the source's job. Every lane that
 * lands the take copies it onto the result row with the task, so the quote
 * reads the same fact. Recorded in the one finalize funnel (the worker lanes
 * and the reconcile cron). A recovery hands finalize no task (its output is
 * only the clip), so the row's own KIE task is recorded as the worker would
 * record it. A job with no task, or no recorded resolution, completes byte for
 * byte as before.
 */

const db = vi.hoisted(() => ({ row: {} as Record<string, unknown> }))
vi.mock("@/lib/supabase.js", () => {
  const usage = { select: () => usage, eq: () => usage, limit: async () => ({ data: [{ id: "log-1" }], error: null }) }
  const jobs = { select: () => jobs, eq: () => jobs, single: async () => ({ data: db.row, error: null }) }
  return {
    supabase: {
      from: (table: string) => (table === "jobs" ? jobs : table === "usage_logs" ? usage : {}),
      rpc: async () => ({ data: "2026-11-11T10:00:00+00:00", error: null }),
    },
  }
})
const shared = vi.hoisted(() => ({
  uploadVideoMaybeWatermark: vi.fn(async () => ({ videoUrl: "https://r2.example/vid-j1.mp4" })),
  markJobCompletedDetailed: vi.fn(async (_id: string, _fields: Record<string, unknown>) => "completed" as const),
  commitJobCredits: vi.fn(async () => undefined),
  refundLoopTrimAddon: vi.fn(async () => undefined),
  createAssetFromJob: vi.fn(async () => undefined),
  uploadImageVariantsMaybeWatermark: vi.fn(),
  buildImageOutputData: vi.fn(),
}))
vi.mock("@/workers/shared.js", () => shared)
vi.mock("@/lib/storage.js", () => ({ uploadToR2: vi.fn() }))
vi.mock("@/lib/character-auto-attach.js", () => ({ appendCharacterReferenceVideo: vi.fn() }))
vi.mock("@/lib/gpt-image-2-6-settle.js", () => ({ gptImage26AutoSettledBase: async () => undefined }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: vi.fn(async () => 0) }))

import { finalizeJobWithMedia } from "@/lib/job-finalize.js"

const R2 = "https://r2.example/vid-j1.mp4"

function jobRow(input: Record<string, unknown>, task: Record<string, unknown> = {}) {
  db.row = { id: "j1", user_id: "u1", should_watermark: false, is_public: true, job_type: "image-to-video", workflow_execution_id: null, status: "processing", input_data: input, ...task }
}

/** Finalize exactly as the reconcile cron calls it (lib/reconcile/kie.ts): the clip, no task, no extras. */
async function cronOutputOf(): Promise<Record<string, unknown> | undefined> {
  shared.uploadVideoMaybeWatermark.mockClear()
  await finalizeJobWithMedia({ jobId: "j1", jobType: "image-to-video", claimant: "cron", result: { url: "https://provider.example/out.mp4", cost: null, providerUsed: null, providerMs: 1200 } })
  return (shared.markJobCompletedDetailed.mock.calls.at(-1)?.[1] as { output_data: Record<string, unknown> } | undefined)?.output_data
}

const KIE_TASK = { provider_task_id: "task-9", provider_kind: "kie-standard", relay_job_id: null }

async function outputOf(extraOutputData: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  await finalizeJobWithMedia({ jobId: "j1", jobType: "image-to-video", result: { url: "https://provider.example/out.mp4", cost: null }, video: { videoUrl: R2 }, extraOutputData })
  return (shared.markJobCompletedDetailed.mock.calls.at(-1)?.[1] as { output_data: Record<string, unknown> } | undefined)?.output_data
}

beforeEach(() => {
  shared.markJobCompletedDetailed.mockClear()
})

describe("a job that made a task records the resolution its request recorded", () => {
  it("beside the task, exactly as stored", async () => {
    jobRow({ provider: "grok-i2v", resolution: "480p" })
    expect(await outputOf({ kieTaskId: "task-1" })).toStrictEqual({ videoUrl: R2, kieTaskId: "task-1", recordedResolution: "480p" })
    jobRow({ provider: "grok", resolution: "720P" })
    expect((await outputOf({ kieTaskId: "task-1" }))?.recordedResolution).toBe("720P")
  })

  it("only a Grok Imagine video job (grok / grok-i2v, by the model its request recorded): every other video job, byte for byte as before", async () => {
    for (const provider of ["seedance-2", "veo3.1", "kling-3.0", "grok-imagine-video-1.5"]) {
      jobRow({ provider, resolution: "720p" })
      expect(await outputOf({ kieTaskId: "task-1" }), provider).toStrictEqual({ videoUrl: R2, kieTaskId: "task-1" })
    }
    // The model a run recorded only as its resolved model reads the same.
    jobRow({ resolvedModel: "grok-i2v", resolution: "480p" })
    expect((await outputOf({ kieTaskId: "task-1" }))?.recordedResolution).toBe("480p")
  })

  it("nothing when the request recorded no resolution, or the job made no task: byte for byte as before", async () => {
    jobRow({ provider: "grok" })
    expect(await outputOf({ kieTaskId: "task-1" })).toStrictEqual({ videoUrl: R2, kieTaskId: "task-1" })
    jobRow({ provider: "seedance-2", resolution: "720p" })
    expect(await outputOf({ thumbnailUrl: "https://r2.example/t.jpg" })).toStrictEqual({ videoUrl: R2, thumbnailUrl: "https://r2.example/t.jpg" })
  })
})

describe("a job the reconcile cron completes records it too", () => {
  it("a Grok Imagine video job: the row's KIE task, as the worker records it, and the resolution its request recorded", async () => {
    jobRow({ provider: "grok-i2v", resolution: "480p" }, KIE_TASK)
    expect(await cronOutputOf()).toStrictEqual({ videoUrl: R2, providerTaskId: "task-9", kieTaskId: "task-9", recordedResolution: "480p" })
    jobRow({ provider: " grok ", resolution: "720p" }, { ...KIE_TASK, provider_kind: "pre-task" })
    expect(await cronOutputOf()).toStrictEqual({ videoUrl: R2, providerTaskId: "task-9", kieTaskId: "task-9", recordedResolution: "720p" })
  })

  it("the worker's own task wins over the row's", async () => {
    jobRow({ provider: "grok", resolution: "480p" }, KIE_TASK)
    expect(await outputOf({ kieTaskId: "task-1" })).toStrictEqual({ videoUrl: R2, kieTaskId: "task-1", recordedResolution: "480p" })
  })

  it("no recorded resolution: the task as the worker records it, no resolution", async () => {
    jobRow({ provider: "grok" }, KIE_TASK)
    expect(await cronOutputOf()).toStrictEqual({ videoUrl: R2, providerTaskId: "task-9", kieTaskId: "task-9" })
  })

  it("nothing for another model's job, a row with no task, or a task not on this install's KIE account", async () => {
    jobRow({ provider: "seedance-2", resolution: "480p" }, KIE_TASK)
    expect(await cronOutputOf()).toStrictEqual({ videoUrl: R2 })
    jobRow({ provider: "grok-i2v", resolution: "480p" }, { ...KIE_TASK, provider_task_id: null })
    expect(await cronOutputOf()).toStrictEqual({ videoUrl: R2 })
    jobRow({ provider: "grok-i2v", resolution: "480p" }, { ...KIE_TASK, provider_task_id: "  " })
    expect(await cronOutputOf()).toStrictEqual({ videoUrl: R2 })
    jobRow({ provider: "grok-i2v", resolution: "480p" }, { ...KIE_TASK, provider_kind: "nodaro-cloud" })
    expect(await cronOutputOf()).toStrictEqual({ videoUrl: R2 })
    jobRow({ provider: "grok-i2v", resolution: "480p" }, { ...KIE_TASK, relay_job_id: "relay-1" })
    expect(await cronOutputOf()).toStrictEqual({ videoUrl: R2 })
  })
})
