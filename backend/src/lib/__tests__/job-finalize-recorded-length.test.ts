import { describe, it, expect, vi, beforeEach } from "vitest"
import { VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { pricedOutputDurationSec } from "@nodaro/shared/models"
import { lengthFollowingBoundSec } from "@nodaro/render-rules"
import { CONTAINER_OVERHANG_SEC } from "@nodaro/shared/video"

/**
 * A length-following video generation run (its model offers an automatic
 * length, and it went out at one or declared a reference task type) records
 * the length it really is when it completes: `output_data.durationSec` =
 * min(the delivered video's measured length, the run's upper bound). The step
 * after it is charged by that. Recorded in the one finalize funnel every
 * completion of such a job goes through (the worker lanes and the reconcile
 * cron), from the job's own request (`input_data`). Every other job completes
 * byte for byte as before, and is never probed.
 */

const db = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
}))
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
const probe = vi.hoisted(() => ({ fn: vi.fn(async (_url: string): Promise<number> => 0) }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.fn }))

import { finalizeJobWithMedia, type FinalizeJobType } from "@/lib/job-finalize.js"
import { resolveVideoRequestNorm, videoRequestReferenceMedia } from "@/lib/video-request-norm.js"

const R2 = "https://r2.example/vid-j1.mp4"
const SEEDANCE_25 = "seedance-2-5"
const SEEDANCE_20 = "seedance-2"
const AUTO_BOUND_25 = pricedOutputDurationSec(SEEDANCE_25, VIDEO_DURATION_AUTO)
const AUTO_BOUND_20 = pricedOutputDurationSec(SEEDANCE_20, VIDEO_DURATION_AUTO)

function jobRow(jobType: string, input: Record<string, unknown>) {
  db.row = { id: "j1", user_id: "u1", should_watermark: false, is_public: true, job_type: jobType, workflow_execution_id: null, status: "processing", input_data: input }
}

async function complete(jobType: FinalizeJobType, extra: Record<string, unknown> = {}) {
  const outcome = await finalizeJobWithMedia({
    jobId: "j1",
    jobType,
    result: { url: "https://provider.example/out.mp4", cost: null },
    mediaUrl: R2,
    extraOutputData: { thumbnailUrl: "https://r2.example/thumb.jpg" },
    ...extra,
  })
  const fields = shared.markJobCompletedDetailed.mock.calls.at(-1)?.[1] as { output_data: Record<string, unknown> } | undefined
  return { outcome, outputData: fields?.output_data }
}

/** What every job wrote before: the video and its thumbnail. */
const BEFORE = { videoUrl: R2, thumbnailUrl: "https://r2.example/thumb.jpg" }

beforeEach(() => {
  shared.markJobCompletedDetailed.mockClear()
  probe.fn.mockReset()
  probe.fn.mockResolvedValue(12.5)
})

describe("a length-following run records the length it really is", () => {
  it.each<[string, string, FinalizeJobType, Record<string, unknown>, number]>([
    ["Seedance 2.5 on Auto (Generate Video)", "image-to-video", "image-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO }, AUTO_BOUND_25],
    ["a declared Edit (text-to-video lane)", "text-to-video", "text-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO, referenceTaskType: "edit" }, AUTO_BOUND_25],
    ["a declared Extend at 8 s", "text-to-video", "text-to-video", { provider: SEEDANCE_25, duration: 8, referenceTaskType: "extend" }, 8],
    ["a Seedance 2.0-family model on Auto", "image-to-video", "image-to-video", { provider: SEEDANCE_20, duration: VIDEO_DURATION_AUTO }, AUTO_BOUND_20],
    ["a voiced Generate Video on Auto", "voiced-video", "image-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO }, AUTO_BOUND_25],
  ])("%s: the handler's measurement, at most the bound, and no second probe", async (_name, rowType, jobType, input, bound) => {
    jobRow(rowType, input)
    expect(lengthFollowingBoundSec(input as never)).toBe(bound)
    const { outcome, outputData } = await complete(jobType, { deliveredVideoSec: 6.48 })
    expect(outcome).toStrictEqual({ ok: true })
    expect(outputData).toStrictEqual({ ...BEFORE, durationSec: Math.min(6.48, bound) })
    expect(probe.fn).not.toHaveBeenCalled()
  })

  it("no measurement handed in: the delivered file is probed once", async () => {
    jobRow("image-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO })
    probe.fn.mockResolvedValue(21.37)
    const { outputData } = await complete("image-to-video")
    expect(outputData).toStrictEqual({ ...BEFORE, durationSec: 21.37 })
    expect(probe.fn).toHaveBeenCalledTimes(1)
    expect(probe.fn).toHaveBeenCalledWith(R2, { timeoutMs: 5_000 })
  })

  it("a delivery a few hundredths over the bound records the bound (30.04 s on a 30 s bound records 30)", async () => {
    jobRow("text-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO, referenceTaskType: "edit" })
    expect(AUTO_BOUND_25).toBe(30)
    expect((await complete("text-to-video", { deliveredVideoSec: 30.04 })).outputData?.durationSec).toBe(30)
    probe.fn.mockResolvedValue(8.04)
    jobRow("text-to-video", { provider: SEEDANCE_25, duration: 8, referenceTaskType: "extend" })
    expect((await complete("text-to-video")).outputData?.durationSec).toBe(8)
  })

  it("a container's overhang past a whole second (the platform's allowance) is not recorded as more", async () => {
    jobRow("image-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO })
    const recordFor = async (measured: number) => (await complete("image-to-video", { deliveredVideoSec: measured })).outputData?.durationSec
    // 10.04 s is a 10 s clip (2 units of 5 s, not 3); 10.3 s is longer than 10 s.
    expect(await recordFor(10.04)).toBe(10)
    expect(await recordFor(10.3)).toBe(10.3)
    expect(await recordFor(10 + CONTAINER_OVERHANG_SEC)).toBe(10)
    // Under a second there is no whole second to read it as.
    expect(await recordFor(0.1)).toBe(0.1)
    // The bound still caps it.
    expect(await recordFor(30.04)).toBe(30)
  })

  it("the record is never above what was measured, nor the bound every quote reads (so no quote can fall below it)", async () => {
    jobRow("image-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO })
    for (const measured of [0.1, 1, 1.2, 4.99, 5.04, 5.25, 10.04, 10.3, 29.9, 30.04, 31]) {
      const record = (await complete("image-to-video", { deliveredVideoSec: measured })).outputData?.durationSec as number
      expect(record, String(measured)).toBeLessThanOrEqual(Math.min(measured, AUTO_BOUND_25))
      expect(record, String(measured)).toBeGreaterThanOrEqual(Math.min(measured, AUTO_BOUND_25) - CONTAINER_OVERHANG_SEC)
    }
  })

  it("a probe that fails records nothing, and the job completes", async () => {
    jobRow("image-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO })
    probe.fn.mockRejectedValue(new Error("ffprobe failed"))
    const { outcome, outputData } = await complete("image-to-video")
    expect(outcome).toStrictEqual({ ok: true })
    expect(outputData).toStrictEqual(BEFORE)
    probe.fn.mockResolvedValue(Number.NaN)
    expect((await complete("image-to-video")).outputData).toStrictEqual(BEFORE)
  })

  it("an unusable measurement handed in is not recorded: the file is probed instead", async () => {
    jobRow("image-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO })
    probe.fn.mockResolvedValue(9.6)
    expect((await complete("image-to-video", { deliveredVideoSec: Number.NaN })).outputData?.durationSec).toBe(9.6)
    expect(probe.fn).toHaveBeenCalledTimes(1)
  })
})

describe("a Seedance 2.5 draft whose length follows its source records it", () => {
  /**
   * The request's fields the job records, by the routes' own resolution
   * (`resolveVideoRequestNorm`, what `/v1/generate-video` and `/v1/text-to-video`
   * write to `input_data`): a draft at 16:9 and 5 s with one 6 s clip.
   */
  function recordedRequest(referenceTaskType: string | undefined): Record<string, unknown> {
    const clips = ["https://cdn.example/clip.mp4"]
    const norm = resolveVideoRequestNorm({
      provider: SEEDANCE_25, aspectRatio: "16:9", resolution: "480p", duration: 5, draft: true,
      referenceTaskType, referenceMedia: videoRequestReferenceMedia({ referenceVideoUrls: clips }, [6]),
    })
    return {
      provider: SEEDANCE_25, aspectRatio: norm.aspectRatio, resolution: norm.resolution, duration: norm.duration ?? 5, draft: true,
      referenceVideoUrls: clips, refVideoDurationsSec: [6],
      ...(norm.referenceTaskType ? { referenceTaskType: norm.referenceTaskType } : {}),
    }
  }

  it.each(["image-to-video", "text-to-video"] as const)("%s: a draft edit of a 6 s clip records its delivered length (6.04 s reads as 6), at most the Auto bound", async (jobType) => {
    const input = recordedRequest("edit")
    expect(input).toMatchObject({ referenceTaskType: "edit", duration: VIDEO_DURATION_AUTO, aspectRatio: "adaptive", resolution: "480p", draft: true })
    expect(lengthFollowingBoundSec(input as never)).toBe(AUTO_BOUND_25)
    jobRow(jobType, input)
    const { outcome, outputData } = await complete(jobType, { deliveredVideoSec: 6.04 })
    expect(outcome).toStrictEqual({ ok: true })
    expect(outputData).toStrictEqual({ ...BEFORE, durationSec: 6 })
  })

  it("the same draft without the setting goes out at its 5 s and records nothing, as before", async () => {
    const input = recordedRequest(undefined)
    expect(input).not.toHaveProperty("referenceTaskType")
    jobRow("image-to-video", input)
    expect((await complete("image-to-video", { deliveredVideoSec: 6.04 })).outputData).toStrictEqual(BEFORE)
    expect(probe.fn).not.toHaveBeenCalled()
  })
})

describe("every other job completes exactly as before, and is never probed", () => {
  it.each<[string, string, FinalizeJobType, Record<string, unknown>]>([
    ["a fixed-length Seedance 2.5 run", "image-to-video", "image-to-video", { provider: SEEDANCE_25, duration: 5 }],
    ["a fixed-length Seedance 2.5 run that declared nothing (auto)", "text-to-video", "text-to-video", { provider: SEEDANCE_25, duration: 5, referenceTaskType: "auto" }],
    ["a model with no automatic length", "image-to-video", "image-to-video", { provider: "kling-3.0", duration: VIDEO_DURATION_AUTO }],
    ["a job from before the provider was recorded", "image-to-video", "image-to-video", {}],
    // Another video producer finalized as a generation's type: never recorded.
    ["Generate Video Pro (finalized as text-to-video)", "generate-video-pro", "text-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO }],
    ["Speech to Video (finalized as image-to-video)", "speech-to-video", "image-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO }],
    ["Extend Video on Seedance 2.5", "extend-video", "extend-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO }],
    ["Face Swap (finalized as video-to-video)", "face-swap", "video-to-video", { provider: SEEDANCE_25, duration: VIDEO_DURATION_AUTO }],
  ])("%s", async (_name, rowType, jobType, input) => {
    jobRow(rowType, input)
    const { outcome, outputData } = await complete(jobType, { deliveredVideoSec: 6.48 })
    expect(outcome).toStrictEqual({ ok: true })
    expect(outputData).toStrictEqual(BEFORE)
    expect(probe.fn).not.toHaveBeenCalled()
  })
})
