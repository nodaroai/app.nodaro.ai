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
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-narr-1",
      creditsReserved: 4,
      watermark: false,
    }),
  },
}))
// Mock ffprobe at the ffmpeg-utils boundary — narration wrapper calls
// getVideoDuration(audioUrl) after the worker job completes. Default mock
// returns 12.5s; individual tests override for the failure path.
vi.mock("../../../../providers/video/ffmpeg-utils.js", () => ({
  getVideoDuration: vi.fn().mockResolvedValue(12.5),
}))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { getVideoDuration } from "../../../../providers/video/ffmpeg-utils.js"
import { pipelineGenerateNarration } from "../pipeline-generate-narration.js"

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
              single: async () => ({ data: { id: "narr-job-1" }, error: null }),
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
                maybeSingle: async () => ({
                  data: opts.assetRow ?? null,
                  error: null,
                }),
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

describe("pipelineGenerateNarration", () => {
  it("returns narration audio asset on happy path with the default speech model (ElevenLabs v4)", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { audioUrl: "https://r2/narration.mp3" },
          credits_actual: 4,
        },
      ],
      assetRow: { id: "asset-narr-1" },
    })

    const promise = pipelineGenerateNarration({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      text: "In a world where the night never ends...",
      voiceId: "ElevenLabs-Adam",
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/narration.mp3")
    expect(result.assetId).toBe("asset-narr-1")
    // ffprobe duration is surfaced so the final merge can validate the
    // narration fits inside the video.
    expect(result.audioDurationSec).toBe(12.5)
    expect(getVideoDuration).toHaveBeenCalledWith("https://r2/narration.mp3")
    // Default model is the default speech model, ElevenLabs v4 (direct API,
    // supports [audio tags]) — reserved and run as the same model.
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "narr-job-1", "elevenlabs-v4", 0, 0, { isAppRun: false, billingContext: { payer: "user", userId: "u1" } },
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-speech",
      expect.objectContaining({
        jobId: "narr-job-1",
        text: "In a world where the night never ends...",
        voice: "ElevenLabs-Adam",
        provider: "elevenlabs-v4",
      }),
    )
  })

  it("keeps an explicit model override, reserved and run as that model", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "completed", output_data: { audioUrl: "https://r2/narration.mp3" }, credits_actual: 4 }],
      assetRow: { id: "asset-narr-1" },
    })
    const promise = pipelineGenerateNarration({ supabase, pipelineId: "p1", userId: "u1", text: "hi", modelId: "elevenlabs-v3" })
    await runUntilSettled(promise)
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "narr-job-1", "elevenlabs-v3", 0, 0, { isAppRun: false, billingContext: { payer: "user", userId: "u1" } },
    )
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ provider: "elevenlabs-v3" }))
  })

  // The REST route's omitted-provider rule, through the one shared function: the
  // default model up to its own cap, turbo above it — reserved and run as one model.
  it("reserves and runs turbo when no model is given and the text is over the default model's cap", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "completed", output_data: { audioUrl: "https://r2/narration.mp3" }, credits_actual: 4 }],
      assetRow: { id: "asset-narr-1" },
    })
    const promise = pipelineGenerateNarration({ supabase, pipelineId: "p1", userId: "u1", text: "a".repeat(12000) })
    await runUntilSettled(promise)
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "narr-job-1", "elevenlabs-turbo", 0, 0, { isAppRun: false, billingContext: { payer: "user", userId: "u1" } },
    )
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ provider: "elevenlabs-turbo" }))
  })

  it("keeps the default model when no model is given and the text is within its cap", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "completed", output_data: { audioUrl: "https://r2/narration.mp3" }, credits_actual: 4 }],
      assetRow: { id: "asset-narr-1" },
    })
    const promise = pipelineGenerateNarration({ supabase, pipelineId: "p1", userId: "u1", text: "a".repeat(9000) })
    await runUntilSettled(promise)
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "narr-job-1", "elevenlabs-v4", 0, 0, { isAppRun: false, billingContext: { payer: "user", userId: "u1" } },
    )
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ provider: "elevenlabs-v4" }))
  })

  it("never applies the length rule to an explicit model", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "completed", output_data: { audioUrl: "https://r2/narration.mp3" }, credits_actual: 4 }],
      assetRow: { id: "asset-narr-1" },
    })
    const promise = pipelineGenerateNarration({ supabase, pipelineId: "p1", userId: "u1", text: "a".repeat(12000), modelId: "elevenlabs-v4" })
    await runUntilSettled(promise)
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-speech", expect.objectContaining({ provider: "elevenlabs-v4" }))
  })

  it("returns audioDurationSec=null when ffprobe fails — non-fatal fallback", async () => {
    ;(getVideoDuration as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ffprobe: 404"),
    )
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { audioUrl: "https://r2/narration.mp3" },
          credits_actual: 4,
        },
      ],
      assetRow: { id: "asset-narr-1" },
    })

    const promise = pipelineGenerateNarration({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      text: "x".repeat(100),
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/narration.mp3")
    expect(result.audioDurationSec).toBeNull()
  })

  it("throws when TTS worker job fails", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "failed", error_message: "voice_id invalid" }],
    })

    const promise = pipelineGenerateNarration({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      text: "...",
    })
    promise.catch(() => undefined)
    await runUntilSettled(promise.then(() => undefined, () => undefined))
    await expect(promise).rejects.toThrow(/Job failed: voice_id invalid/)
  })
})
