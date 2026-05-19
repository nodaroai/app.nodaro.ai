import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-combine-1",
      creditsReserved: 0,
      watermark: false,
    }),
  },
}))

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
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "cv-job-1", "combine-videos", 0, 0, { isAppRun: false },
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "combine-videos",
      expect.objectContaining({
        jobId: "cv-job-1",
        videoUrls: expect.arrayContaining(["https://r2/s1.mp4", "https://r2/s2.mp4", "https://r2/s3.mp4"]),
        transition: "cut",
        audioMode: "crossfade",
      }),
    )
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
