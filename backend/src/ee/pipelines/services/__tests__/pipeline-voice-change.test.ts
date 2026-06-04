import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-vc-1",
      creditsReserved: 0,
      watermark: false,
    }),
  },
}))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { pipelineVoiceChange } from "../pipeline-voice-change.js"

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
              single: async () => ({ data: { id: "vc-job-1" }, error: null }),
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

describe("pipelineVoiceChange", () => {
  it("revoices a talking clip on the happy path (keeps music bed by default)", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { videoUrl: "https://r2/revoiced.mp4", audioUrl: "https://r2/revoiced.mp3" },
          credits_actual: 4,
        },
      ],
      assetRow: { id: "asset-vc-1" },
    })

    const promise = pipelineVoiceChange({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      videoUrl: "https://r2/shot.mp4",
      voiceId: "River",
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/revoiced.mp4")
    expect(result.assetId).toBe("asset-vc-1")
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "vc-job-1", "elevenlabs-voice-changer", 0, 0, { isAppRun: false },
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "voice-changer",
      expect.objectContaining({
        jobId: "vc-job-1",
        videoUrl: "https://r2/shot.mp4",
        voiceId: "River",
        removeBackgroundNoise: false,
      }),
    )
  })

  it("rejects when no voiceId is supplied", async () => {
    const supabase = makeSupabaseMock({ jobStates: [] })
    await expect(
      pipelineVoiceChange({
        supabase,
        pipelineId: "p1",
        userId: "u1",
        videoUrl: "https://r2/shot.mp4",
        voiceId: "",
      }),
    ).rejects.toThrow(/requires a voiceId/)
  })
})
