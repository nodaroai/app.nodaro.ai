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
      usageLogId: "log-tts-1",
      creditsReserved: 4,
      watermark: false,
    }),
  },
}))
// ffprobe is mocked at the ffmpeg-utils boundary — the wrapper calls
// `getVideoDuration(audioUrl)` after the worker job completes. Default mock
// returns 3.2s; individual tests override for the failure path.
vi.mock("../../../../providers/video/ffmpeg-utils.js", () => ({
  getVideoDuration: vi.fn().mockResolvedValue(3.2),
}))
// Seam 3 — the one job override (lib/speech-estimate.ts). Undefined is the
// flag-off answer (the flat row reserves); a number is what the job reserves.
// The arithmetic is pinned where the override lives; this file pins the WIRING.
vi.mock("../../../../lib/speech-estimate.js", () => ({
  speechChargeOverride: vi.fn().mockResolvedValue(undefined),
}))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { getVideoDuration } from "../../../../providers/video/ffmpeg-utils.js"
import { speechChargeOverride } from "../../../../lib/speech-estimate.js"
import { pipelineGenerateSpeech } from "../pipeline-generate-speech.js"

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
              single: async () => ({ data: { id: "tts-job-1" }, error: null }),
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

describe("pipelineGenerateSpeech", () => {
  it("returns audio asset on happy path with elevenlabs-turbo default", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { audioUrl: "https://r2/voice.mp3" },
          credits_actual: 4,
        },
      ],
      assetRow: { id: "asset-audio-1" },
    })

    const promise = pipelineGenerateSpeech({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      text: "I knew you'd come back.",
      voice: "Rachel",
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/voice.mp3")
    expect(result.assetId).toBe("asset-audio-1")
    // Phase 1C.2 — the wrapper probes the rendered audio with ffprobe and
    // surfaces the real duration. The lip-sync sub-step + Editor LLM
    // dialogue_no_cut_zone calc both read this.
    expect(result.audioDurationSec).toBe(3.2)
    expect(getVideoDuration).toHaveBeenCalledWith("https://r2/voice.mp3")
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "tts-job-1", "elevenlabs-turbo", 0, 0, { isAppRun: false, billingContext: { payer: "user", userId: "u1" } },
    )
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-speech",
      expect.objectContaining({
        jobId: "tts-job-1",
        text: "I knew you'd come back.",
        voice: "Rachel",
        provider: "elevenlabs-turbo",
      }),
    )
  })

  // Seam 3 (decided 2026-10-06): while length pricing is on, each per-line job
  // reserves what the one override computes for the text it SENDS, on the model
  // the payload names (the legacy alias already mapped). Off, the override is
  // undefined and the reserve options are exactly today's (the test above).
  it("reserves the length-based override for the text it sends, on the model the payload names", async () => {
    vi.mocked(speechChargeOverride).mockResolvedValueOnce(22)
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "completed", output_data: { audioUrl: "https://r2/voice.mp3" }, credits_actual: 22 }],
      assetRow: { id: "asset-audio-1" },
    })
    const text = "a".repeat(1000)
    await runUntilSettled(pipelineGenerateSpeech({ supabase, pipelineId: "p1", userId: "u1", text, provider: "elevenlabs" }))
    expect(speechChargeOverride).toHaveBeenCalledWith("text-to-speech", { provider: "elevenlabs-turbo", text }, "elevenlabs-turbo")
    expect(CreditsService.reserveCredits).toHaveBeenCalledWith(
      "u1", "tts-job-1", "elevenlabs-turbo", 0, 0,
      { isAppRun: false, billingContext: { payer: "user", userId: "u1" }, creditOverride: 22 },
    )
  })

  it("returns audioDurationSec=null when ffprobe fails — non-fatal fallback", async () => {
    ;(getVideoDuration as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ffprobe: 404"),
    )
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { audioUrl: "https://r2/voice.mp3" },
          credits_actual: 4,
        },
      ],
      assetRow: { id: "asset-audio-1" },
    })

    const promise = pipelineGenerateSpeech({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      text: "x",
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/voice.mp3")
    expect(result.audioDurationSec).toBeNull()
  })

  it("throws when TTS job fails", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "failed", error_message: "voice_id invalid" }],
    })

    const promise = pipelineGenerateSpeech({
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
