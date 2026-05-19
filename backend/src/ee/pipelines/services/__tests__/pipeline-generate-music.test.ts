import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-music-1",
      creditsReserved: 0,
      watermark: false,
    }),
  },
}))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { pipelineGenerateMusic } from "../pipeline-generate-music.js"

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
              single: async () => ({ data: { id: "music-job-1" }, error: null }),
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

describe("pipelineGenerateMusic", () => {
  it("generates music on happy path", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { audioUrl: "https://r2/music.mp3" },
          credits_actual: 0,
        },
      ],
      assetRow: { id: "asset-music-1" },
    })

    const promise = pipelineGenerateMusic({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      prompt: "cinematic instrumental score",
      durationSec: 65,
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/music.mp3")
    expect(result.assetId).toBe("asset-music-1")
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "music-job-1", "generate-music", 0, 0, { isAppRun: false },
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-music",
      expect.objectContaining({
        jobId: "music-job-1",
        prompt: "cinematic instrumental score",
        provider: "minimax",
        duration: 65,
      }),
    )
  })

  it("throws when generate-music job fails", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "failed", error_message: "Suno backend error" }],
    })

    const promise = pipelineGenerateMusic({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      prompt: "x",
      durationSec: 30,
    })
    promise.catch(() => undefined)
    await runUntilSettled(promise.then(() => undefined, () => undefined))
    await expect(promise).rejects.toThrow(/Job failed: Suno backend error/)
  })
})
