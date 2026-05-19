import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mocks must precede SUT import so the dynamic-imports inside the wrapper
// (videoQueue / CreditsService) pick them up.
vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-extract-1",
      creditsReserved: 1,
      watermark: false,
    }),
  },
}))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { pipelineExtractFrame } from "../pipeline-extract-frame.js"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function makeSupabaseMock(opts: {
  jobStates: Array<{
    status: string
    output_data?: Record<string, unknown>
    error_message?: string | null
    credits_actual?: number | null
  }>
  assetRow?: { id: string } | null
}) {
  let pollIdx = 0
  const recorded = {
    jobInsert: undefined as Record<string, unknown> | undefined,
    assetUpdate: undefined as Record<string, unknown> | undefined,
  }
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "jobs") {
        return {
          insert: (payload: Record<string, unknown>) => {
            recorded.jobInsert = payload
            return {
              select: () => ({
                single: async () => ({ data: { id: "extract-job-1" }, error: null }),
              }),
            }
          },
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
                maybeSingle: async () => ({
                  data: opts.assetRow ?? null,
                  error: null,
                }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            recorded.assetUpdate = payload
            return { eq: async () => ({ data: null, error: null }) }
          },
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return { supabase: supabase as never, recorded }
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

describe("pipelineExtractFrame", () => {
  it("returns asset on happy path", async () => {
    const { supabase, recorded } = makeSupabaseMock({
      jobStates: [
        { status: "processing" },
        {
          status: "completed",
          output_data: { imageUrl: "https://r2/frame.png" },
          credits_actual: 1,
        },
      ],
      assetRow: { id: "asset-frame-1" },
    })

    const promise = pipelineExtractFrame({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      videoUrl: "https://r2/shot.mp4",
      mode: "timestamp",
      timestamp: 4.9,
    })
    const result = await runUntilSettled(promise)

    expect(result).toMatchObject({
      jobId: "extract-job-1",
      assetId: "asset-frame-1",
      assetUrl: "https://r2/frame.png",
      creditsSpent: 1,
    })
    expect(recorded.jobInsert).toMatchObject({ pipeline_id: "p1", status: "pending" })
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1",
      "extract-job-1",
      "extract-frame",
      0,
      0,
      { isAppRun: false },
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "extract-frame",
      expect.objectContaining({
        jobId: "extract-job-1",
        videoUrl: "https://r2/shot.mp4",
        mode: "timestamp",
        timestamp: 4.9,
      }),
    )
    expect(recorded.assetUpdate).toEqual({ pipeline_entity_id: "scene-1" })
  })

  it("throws when extract-frame job fails", async () => {
    const { supabase } = makeSupabaseMock({
      jobStates: [{ status: "failed", error_message: "ffmpeg timeout" }],
    })

    const promise = pipelineExtractFrame({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      videoUrl: "https://r2/shot.mp4",
    })
    promise.catch(() => undefined)
    await runUntilSettled(promise.then(() => undefined, () => undefined))
    await expect(promise).rejects.toThrow(/Job failed: ffmpeg timeout/)
  })
})
