import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
// P14: the worker-lane payer read — personal in these hermetic worlds.
vi.mock("../../pipeline-payer.js", () => ({
  getPipelineBillingContext: vi.fn(async (_sb: unknown, _pid: string, userId: string) => ({ payer: "user", userId })),
}))

vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    checkCredits: vi.fn().mockResolvedValue({ allowed: true }),
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-combine-1",
      creditsReserved: 0,
      watermark: false,
    }),
  },
}))

// Each clip is measured before the step is priced: 10 s each.
const probe = vi.hoisted(() => vi.fn(async (_url: string) => ({ width: 640, height: 360, durationSeconds: 10 })))
vi.mock("../../../../providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: probe, assertSafeProbeSource: async () => undefined }))

// The one clip reading both sides measure by (lib/video-utility-probe.ts), driven by the probe above.
vi.mock("../../../../lib/video-utility-probe.js", () => ({
  probeClipLengthSec: async (src: string) => (await probe(src)).durationSeconds,
  ClipUnreadableError: class ClipUnreadableError extends Error {},
}))
vi.mock("../../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ cost_markup_percent: 0, service_margin_percent: {} })) }))
// The combine-videos row: 10 credits a unit.
vi.mock("../../../../lib/credit-base-cost.js", () => ({ unitRateBaseCredits: vi.fn(async (_id: string, units: number) => units * 10) }))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { pipelineCombineVideos } from "../pipeline-combine-videos.js"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function makeSupabaseMock(opts: {
  jobStates: Array<Record<string, unknown>>
  assetRow?: { id: string } | null
}) {
  let pollIdx = 0
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "jobs") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "cv-job-1" }, error: null }),
            }),
          }),
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const idx = Math.min(pollIdx, opts.jobStates.length - 1)
                pollIdx += 1
                return { data: opts.jobStates[idx], error: null }
              },
            }),
          }),
        }
      }
      if (table === "assets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.assetRow ?? null, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return supabase as never
}

async function runUntilSettled<T>(p: Promise<T>, stepMs = 3500, maxSteps = 30): Promise<T> {
  for (let i = 0; i < maxSteps; i++) {
    let settled = false
    p.then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(stepMs)
    await Promise.resolve()
    if (settled) break
  }
  return p
}

describe("pipelineCombineVideos", () => {
  it("merges clips on happy path", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { videoUrl: "https://r2/scene-composite.mp4" },
          credits_actual: 0,
        },
      ],
      assetRow: { id: "asset-cv-1" },
    })

    const promise = pipelineCombineVideos({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      videoUrls: [
        "https://r2/s1.mp4",
        "https://r2/s2.mp4",
        "https://r2/s3.mp4",
      ],
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/scene-composite.mp4")
    expect(result.assetId).toBe("asset-cv-1")
    // Three measured 10 s clips joined by cuts: 30 s → 6 units, + 1 for the third clip = 7 units at the row.
    expect(probe).toHaveBeenCalledTimes(3)
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "cv-job-1", "combine-videos", 0, 0, { isAppRun: false, billingContext: { payer: "user", userId: "u1" }, creditOverride: 70 },
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "combine-videos",
      expect.objectContaining({
        jobId: "cv-job-1",
        videoUrls: expect.arrayContaining(["https://r2/s1.mp4", "https://r2/s2.mp4", "https://r2/s3.mp4"]),
        transition: "cut",
        audioMode: "crossfade",
        // The units and lengths it was charged ride the job: the render re-measures against them.
        billedUnits: 7,
        upstreamDurations: [10, 10, 10],
      }),
    )
  })

  it("a merge of more than 100 clips fails the step before any clip is fetched", async () => {
    const supabase = makeSupabaseMock({ jobStates: [] })
    await expect(pipelineCombineVideos({ supabase, pipelineId: "p1", userId: "u1", videoUrls: Array.from({ length: 101 }, (_, i) => `https://r2/c${i}.mp4`) }))
      .rejects.toThrow("combine-videos: Combine Videos joins at most 100 clips; this run has 101.")
    expect(probe).not.toHaveBeenCalled()
    expect(CreditsService.reserveCredits).not.toHaveBeenCalled()
  })

  it("a clip that cannot be read refuses the step before any job or reservation", async () => {
    probe.mockRejectedValueOnce(new Error("unreadable"))
    const supabase = makeSupabaseMock({ jobStates: [] })
    await expect(pipelineCombineVideos({ supabase, pipelineId: "p1", userId: "u1", videoUrls: ["https://r2/a.mp4", "https://r2/b.mp4"] }))
      .rejects.toThrow("combine-videos: Could not read clip 1 of 2. The file may be corrupted or an unsupported format.")
    expect(CreditsService.reserveCredits).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("throws when combine job fails", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "failed", error_message: "resolution mismatch" }],
    })

    const promise = pipelineCombineVideos({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      videoUrls: ["https://r2/a.mp4", "https://r2/b.mp4"],
    })
    promise.catch(() => undefined)
    await runUntilSettled(promise.then(() => undefined, () => undefined))
    await expect(promise).rejects.toThrow(/Job failed: resolution mismatch/)
  })
})
