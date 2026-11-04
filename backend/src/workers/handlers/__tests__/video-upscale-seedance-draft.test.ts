import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The video-upscale handler's Seedance draft finalize: the 1080p render gets
 * the draft's post-render audio mux re-applied (decided 2026-10-12) — a voiced
 * or audio-merged draft's HD carries its audio — while a plain draft's HD is
 * uploaded as rendered, with no audio added.
 */
const mocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  apply: vi.fn(),
  upload: vi.fn(),
  finalizeJob: vi.fn(),
  topaz: vi.fn(),
  unitRate: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) },
}))
vi.mock("../../../providers/kie/seedance-draft.js", () => ({ runSeedanceDraftFinalize: mocks.finalize }))
vi.mock("../../../lib/seedance-draft-audio-apply.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/seedance-draft-audio-apply.js")>()),
  applyDraftAudioMux: mocks.apply,
}))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeJob }))
// The Topaz branch, for the "unchanged" case below.
vi.mock("@/providers/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/index.js")>()),
  videoUpscale: mocks.topaz,
}))
vi.mock("@/lib/credit-base-cost.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-base-cost.js")>()),
  unitRateBaseCredits: mocks.unitRate,
}))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.upload,
    generateAndUploadThumbnail: vi.fn().mockResolvedValue(null),
    setJobProgress: vi.fn(async () => {}),
    withProgressRamp: vi.fn(async (_j: unknown, _i: unknown, _o: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

import { videoAIHandlers } from "../video-ai.js"
import { seedanceDraftFinalizeCostUsd } from "../../../providers/kie/seedance-cost.js"

const ctx = { jobId: "job-hd", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: true }
const job = (data: Record<string, unknown>) => ({ name: "video-upscale", data: { jobId: "job-hd", provider: "seedance-2-5-hd", kieTaskId: "task-draft", ...data }, id: "b", updateProgress: vi.fn() })
const HD = "https://kie.example/hd.mp4"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.finalize.mockResolvedValue({ url: HD, kieTaskId: "task-final" })
  mocks.apply.mockResolvedValue({ url: "https://r2.example/hd-with-audio.mp4" })
  mocks.upload.mockResolvedValue("https://r2.example/hd.mp4")
  mocks.finalizeJob.mockResolvedValue({ ok: true })
})

describe("video-upscale seedance-2-5-hd — the draft's audio mux", () => {
  it("re-applies a voiced draft's voice track to the 1080p render (watermark honoured) and delivers that clip", async () => {
    const mux = { kind: "voice-track", audioUrl: "https://r2.example/track.mp3" }
    await videoAIHandlers["video-upscale"](job({ draftAudioMux: mux, draftVideoUrl: "https://r2.example/draft.mp4" }) as never, ctx as never)
    expect(mocks.finalize).toHaveBeenCalledWith("task-draft", expect.anything())
    expect(mocks.apply).toHaveBeenCalledWith({
      videoUrl: HD, mux, draftVideoUrl: "https://r2.example/draft.mp4", jobId: "job-hd", userId: "user-1", watermark: true,
    })
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.finalizeJob.mock.calls[0]![0]).toMatchObject({ mediaUrl: "https://r2.example/hd-with-audio.mp4" })
  })

  it("re-applies an audioUrl merge with its own settings", async () => {
    const mux = { kind: "audio-track", audioUrl: "https://a/vo.mp3", voiceoverVolume: 100, backgroundVolume: 30, keepOriginalAudio: true }
    await videoAIHandlers["video-upscale"](job({ draftAudioMux: mux }) as never, ctx as never)
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ mux }))
  })

  it("audio that could not be re-applied: the silent HD is delivered (job completes, charged) with a visible warning", async () => {
    mocks.apply.mockResolvedValueOnce({
      url: "https://r2.example/hd-silent.mp4",
      warning: { code: "draft_audio_not_reapplied", message: "The 1080p video was delivered without the draft's audio" },
    })
    await videoAIHandlers["video-upscale"](job({ draftAudioMux: { kind: "voice-track", audioUrl: "https://r2/t.mp3" } }) as never, ctx as never)
    const arg = mocks.finalizeJob.mock.calls[0]![0] as { mediaUrl: string; extraOutputData: Record<string, unknown> }
    expect(arg.mediaUrl).toBe("https://r2.example/hd-silent.mp4")
    expect(arg.extraOutputData).toMatchObject({ warningCode: "draft_audio_not_reapplied", warningMessage: expect.stringContaining("without the draft's audio") })
  })

  it("a plain draft's 1080p render is uploaded as rendered — no audio added", async () => {
    await videoAIHandlers["video-upscale"](job({}) as never, ctx as never)
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.upload).toHaveBeenCalledWith(HD, "job-hd", "user-1", true)
    expect(mocks.finalizeJob.mock.calls[0]![0]).toMatchObject({ mediaUrl: "https://r2.example/hd.mp4" })
    expect((mocks.finalizeJob.mock.calls[0]![0] as { extraOutputData: Record<string, unknown> }).extraOutputData).not.toHaveProperty("warningCode")
  })

  it("ignores a malformed recipe (never trusts the payload's shape)", async () => {
    await videoAIHandlers["video-upscale"](job({ draftAudioMux: { kind: "voice-track" } }) as never, ctx as never)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})

/**
 * The finalize records what the provider bills for the 1080p render as its
 * provider cost, from the seconds its charge bills (`draftBilledSec`) and
 * whether the draft had a reference video (`draftHasRefVideo`), both carried
 * on the queue payload. Recorded only: no metered charge, and the delivery is
 * the same as before.
 */
describe("video-upscale seedance-2-5-hd — the recorded provider cost", () => {
  type FinalizeArg = { result: Record<string, unknown>; mediaUrl: string; extraOutputData: Record<string, unknown> } & Record<string, unknown>
  const arg = () => mocks.finalizeJob.mock.calls[0]![0] as FinalizeArg

  beforeEach(() => {
    // The provider's contract (tested next to it): a cost only when it is given the billing.
    mocks.finalize.mockImplementation(async (_id: string, opts?: { billing?: { billedSec: number; hasRefVideo: boolean } }) => ({
      url: HD,
      kieTaskId: "task-final",
      ...(opts?.billing ? { cost: seedanceDraftFinalizeCostUsd(opts.billing.billedSec, opts.billing.hasRefVideo) } : {}),
    }))
  })

  it("a reference-video draft, 12 billed seconds: the ref rate", async () => {
    await videoAIHandlers["video-upscale"](job({ draftBilledSec: 12, draftHasRefVideo: true }) as never, ctx as never)
    expect(mocks.finalize).toHaveBeenCalledWith("task-draft", expect.objectContaining({ billing: { billedSec: 12, hasRefVideo: true } }))
    expect(arg().result.cost).toBe(seedanceDraftFinalizeCostUsd(12, true))
  })

  it("a plain draft, 8 billed seconds: the plain rate", async () => {
    await videoAIHandlers["video-upscale"](job({ draftBilledSec: 8, draftHasRefVideo: false }) as never, ctx as never)
    expect(mocks.finalize).toHaveBeenCalledWith("task-draft", expect.objectContaining({ billing: { billedSec: 8, hasRefVideo: false } }))
    expect(arg().result.cost).toBe(seedanceDraftFinalizeCostUsd(8, false))
  })

  it("neither is a metered charge, and the delivery is as before", async () => {
    for (const data of [{ draftBilledSec: 12, draftHasRefVideo: true }, { draftBilledSec: 8, draftHasRefVideo: false }]) {
      mocks.finalizeJob.mockClear()
      await videoAIHandlers["video-upscale"](job(data) as never, ctx as never)
      expect(arg()).not.toHaveProperty("meteredBaseCredits")
      expect(arg().result).not.toHaveProperty("meteredCost")
      expect(arg().result).toEqual({ url: HD, cost: seedanceDraftFinalizeCostUsd(data.draftBilledSec, data.draftHasRefVideo), providerUsed: "seedance-2-5-hd" })
      expect(arg().mediaUrl).toBe("https://r2.example/hd.mp4")
      expect(arg().extraOutputData).toEqual({ thumbnailUrl: null })
    }
  })

  it("a payload with neither the billed seconds nor the draft's fields (a route run queued before the change) records no cost, as today", async () => {
    await videoAIHandlers["video-upscale"](job({}) as never, ctx as never)
    expect(mocks.finalize.mock.calls[0]![1]).not.toHaveProperty("billing")
    expect(arg().result.cost).toBeNull()
  })

  it("billing is passed only for a positive number of billed seconds", async () => {
    for (const draftBilledSec of [0, -4, Number.NaN, "12", null]) {
      mocks.finalize.mockClear()
      mocks.finalizeJob.mockClear()
      await videoAIHandlers["video-upscale"](job({ draftBilledSec, draftHasRefVideo: true }) as never, ctx as never)
      expect(mocks.finalize.mock.calls[0]![1], String(draftBilledSec)).not.toHaveProperty("billing")
      expect(arg().result.cost).toBeNull()
    }
  })

  // A workflow run's payload carries the draft's own fields (the stamp's), never
  // billed seconds of its own: the worker derives them by the route's rule.
  it("a workflow run's plain draft: the billed seconds derive from its output seconds", async () => {
    await videoAIHandlers["video-upscale"](job({ draftOutputSec: 4, draftHasRefVideo: false, draftRefVideoDurationsSec: [] }) as never, ctx as never)
    expect(mocks.finalize).toHaveBeenCalledWith("task-draft", expect.objectContaining({ billing: { billedSec: 4, hasRefVideo: false } }))
    expect(arg().result.cost).toBe(seedanceDraftFinalizeCostUsd(4, false))
  })

  it("a workflow run's reference-video draft: whole input seconds + output (4.6 s in, 4 s out → 9)", async () => {
    await videoAIHandlers["video-upscale"](job({ draftOutputSec: 4, draftHasRefVideo: true, draftRefVideoDurationsSec: [4.6] }) as never, ctx as never)
    expect(mocks.finalize).toHaveBeenCalledWith("task-draft", expect.objectContaining({ billing: { billedSec: 9, hasRefVideo: true } }))
    expect(arg().result.cost).toBe(seedanceDraftFinalizeCostUsd(9, true))
    expect(arg()).not.toHaveProperty("meteredBaseCredits")
  })

  it("the route's billed seconds are used as sent when the payload carries them", async () => {
    await videoAIHandlers["video-upscale"](
      job({ draftBilledSec: 12, draftHasRefVideo: true, draftOutputSec: 4, draftRefVideoDurationsSec: [4.6] }) as never,
      ctx as never,
    )
    expect(mocks.finalize).toHaveBeenCalledWith("task-draft", expect.objectContaining({ billing: { billedSec: 12, hasRefVideo: true } }))
  })

  it("unusable output seconds and no billed seconds: no billing, no cost", async () => {
    for (const draftOutputSec of [0, -4, Number.NaN, "4", null]) {
      mocks.finalize.mockClear()
      mocks.finalizeJob.mockClear()
      await videoAIHandlers["video-upscale"](job({ draftOutputSec, draftHasRefVideo: false, draftRefVideoDurationsSec: [] }) as never, ctx as never)
      expect(mocks.finalize.mock.calls[0]![1], String(draftOutputSec)).not.toHaveProperty("billing")
      expect(arg().result.cost).toBeNull()
    }
  })

  it("a Topaz run is unchanged: Replicate's cost, the units it reported as the charge", async () => {
    mocks.topaz.mockResolvedValueOnce({ url: "https://replicate.example/up.mp4", cost: 0.42, displayCost: 0.5, providerUsed: "replicate", billedUnits: 3 })
    mocks.unitRate.mockResolvedValueOnce(120)
    await videoAIHandlers["video-upscale"](
      { name: "video-upscale", data: { jobId: "job-hd", provider: "topaz", videoUrl: "https://x/v.mp4", draftBilledSec: 12, draftHasRefVideo: true }, id: "b", updateProgress: vi.fn() } as never,
      ctx as never,
    )
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(arg().meteredBaseCredits).toBe(120)
    expect(arg().result).toEqual({ url: "https://replicate.example/up.mp4", cost: 0.42, providerUsed: "topaz" })
  })
})
