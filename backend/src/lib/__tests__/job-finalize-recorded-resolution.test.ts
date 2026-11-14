import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A Grok Imagine video job (`grok` / `grok-i2v`) that made a provider task
 * records, on its output beside that task, the resolution its request RECORDED
 * (`input_data.resolution`, exactly as stored) — the fact a Grok Extend's
 * charge reads off the source's job. Every lane that
 * lands the take copies it onto the result row with the task, so the quote
 * reads the same fact. Recorded in the one finalize funnel (the worker lanes
 * and the reconcile cron). A job with no task, or no recorded resolution,
 * completes byte for byte as before.
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
  uploadVideoMaybeWatermark: vi.fn(async () => "https://r2.example/vid-j1.mp4"),
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

function jobRow(input: Record<string, unknown>) {
  db.row = { id: "j1", user_id: "u1", should_watermark: false, is_public: true, job_type: "image-to-video", workflow_execution_id: null, status: "processing", input_data: input }
}

async function outputOf(extraOutputData: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  await finalizeJobWithMedia({ jobId: "j1", jobType: "image-to-video", result: { url: "https://provider.example/out.mp4", cost: null }, mediaUrl: R2, extraOutputData })
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
