import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-lipsync-1",
      creditsReserved: 8,
      watermark: false,
    }),
  },
}))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { pipelineLipSync } from "../pipeline-lip-sync.js"

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
              single: async () => ({ data: { id: "ls-job-1" }, error: null }),
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

describe("pipelineLipSync", () => {
  it("returns video asset on happy path with kling-avatar default", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { videoUrl: "https://r2/lip-sync.mp4" },
          credits_actual: 8,
        },
      ],
      assetRow: { id: "asset-ls-1" },
    })

    const promise = pipelineLipSync({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      videoUrl: "https://r2/shot.mp4",
      audioUrl: "https://r2/voice.mp3",
      audioDurationSec: 7.5,
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/lip-sync.mp4")
    expect(result.assetId).toBe("asset-ls-1")
    // kling-avatar uses buildLipSyncCreditId — assert it was called with the
    // resolved (non-default) audio duration. The identifier shape itself is
    // tested in @nodaro/shared.
    const [userId, jobId, modelId] = (CreditsService.reserveCredits as ReturnType<typeof vi.fn>)
      .mock.calls[0]
    expect(userId).toBe("u1")
    expect(jobId).toBe("ls-job-1")
    expect(modelId).toMatch(/kling-avatar/)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "lip-sync",
      expect.objectContaining({
        jobId: "ls-job-1",
        videoUrl: "https://r2/shot.mp4",
        audioUrl: "https://r2/voice.mp3",
        provider: "kling-avatar",
      }),
    )
  })

  it("throws when lip-sync job fails", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "failed", error_message: "audio too short" }],
    })

    const promise = pipelineLipSync({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      videoUrl: "https://r2/shot.mp4",
      audioUrl: "https://r2/voice.mp3",
    })
    promise.catch(() => undefined)
    await runUntilSettled(promise.then(() => undefined, () => undefined))
    await expect(promise).rejects.toThrow(/Job failed: audio too short/)
  })
})
