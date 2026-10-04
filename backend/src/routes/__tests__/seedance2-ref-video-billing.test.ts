import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

// ---------------------------------------------------------------------------
// Seedance 2 reference-video billing (Task A2).
//
// KIE bills a Seedance 2 "with video input" run by `unit × (input_video + output)`
// but the seeded `-ref` composites only encode the per-8s OUTPUT rate, so the
// route used to reserve output-only. `commit_credits` can only refund (never
// up-charge), so the route's `computeCredits` hook must ffprobe the reference
// videos and reserve the FULL (input + output) base up front.
//
// This test pins: seedance-2 + referenceVideoUrls + probe→5s @ 8s/720p must
// reserve BASE 82 (= ceil(6.25 × (5 + 8))), NOT the output-only 50
// (`seedance-2:8s:720p-ref`). A request WITHOUT reference videos must skip the
// scaling branch entirely (never calls seedance2RefVideoBaseCredits) and fall
// back to the normal duration/resolution identifier.
//
// Mirrors generate-video-pricing.test.ts: markup is mocked to 0% so the
// `creditOverride` passed to reserveCredits == the BASE credits computed by the
// hook; STATIC_CREDIT_COSTS is the real (un-mocked) table (model_pricing DB
// lookup is mocked to MISS) so the asserted numbers track the seeded reality.
// ---------------------------------------------------------------------------

vi.mock("../../lib/config.js", () => ({
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  isCloud: () => true,
  hasAdmin: () => true,
}))

vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
vi.mock("../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 0 })),
}))
vi.mock("../../lib/url-validator.js", () => ({
  safeUrlSchema: z.string().url(),
}))

// ffprobe is stubbed to a fixed 5s per reference video.
const probeSpy = vi.fn(() => Promise.resolve(5))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  probeMediaDuration: probeSpy,
}))

const fakeProfile = {
  role: "user", tier: "standard", subscription_tier: "standard",
  subscription_credits: 10000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null,
  storage_used_bytes: 0, storage_limit_bytes: 1e10,
}

const fakeJobInsert = vi.fn(() => ({
  select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }),
}))
const fakeJobUpsert = vi.fn(() => ({
  select: () => Promise.resolve({ data: [{ id: "job-1" }], error: null }),
}))
const fakeJobUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) }))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: fakeProfile, error: null }) }) }) }
      }
      if (table === "jobs") return { insert: fakeJobInsert, upsert: fakeJobUpsert, update: fakeJobUpdate }
      // model_pricing MISS → getModelCreditBaseCost falls back to real STATIC_CREDIT_COSTS.
      if (table === "model_pricing") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { message: "no row" } }) }) }) }
      }
      return {}
    }),
  },
}))

const reserveSpy = vi.fn(() => Promise.resolve({ usageLogId: "log-1", creditsReserved: 0, watermark: false }))

// Keep STATIC_CREDIT_COSTS / getModelCreditBaseCost / PriceNotConfiguredError real;
// only swap the CreditsService methods so we can capture the reserved override.
vi.mock("../../ee/billing/credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../ee/billing/credits.js")>("../../ee/billing/credits.js")
  return {
    ...actual,
    CreditsService: {
      checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
      checkCreditsWithProfile: vi.fn(() => Promise.resolve({ allowed: true, watermark: false })),
      reserveCredits: reserveSpy,
    },
  }
})

// Spy on the route's ref-video entry point (the function the `computeCredits`
// hook actually calls — it probes through the core helper and prices from the
// durations, so the probe can ride the job) so the "no reference videos"
// control can prove the scaling branch is NOT taken. Keep the real
// implementation for the math (the real per-second scaling).
const refCreditsSpy = vi.fn()
vi.mock("../../ee/billing/seedance2-ref-video-credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../ee/billing/seedance2-ref-video-credits.js")>("../../ee/billing/seedance2-ref-video-credits.js")
  return {
    ...actual,
    seedance2RefVideoBaseCreditsFromDurations: (args: Parameters<typeof actual.seedance2RefVideoBaseCreditsFromDurations>[0]) => {
      refCreditsSpy(args)
      return actual.seedance2RefVideoBaseCreditsFromDurations(args)
    },
  }
})

vi.mock("../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn(() => Promise.resolve({ id: "queue-1" })) },
}))

beforeEach(() => { vi.clearAllMocks() })

async function buildGenerateVideoApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as any).userId = "u-1"
    ;(req as any).isAppRun = false
  })
  const { generateVideoRoutes } = await import("../generate-video.js")
  await generateVideoRoutes(app)
  return app
}

async function buildTextToVideoApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as any).userId = "u-1"
    ;(req as any).isAppRun = false
  })
  const { textToVideoRoutes } = await import("../text-to-video.js")
  await textToVideoRoutes(app)
  return app
}

describe("/v1/generate-video Seedance 2 reference-video billing", () => {
  it("reserves unit×(input+output) BASE = 82 for a 5s ref video @ 8s/720p (not the output-only 50)", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
      },
    })
    expect(res.statusCode).toBe(200)
    // perSecBase = STATIC["seedance-2:8s:720p-ref"]/8 = 50/8 = 6.25
    // total = ceil(6.25 × (5 + 8)) = ceil(81.25) = 82  (NOT the output-only 50)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 813 }),
    )
    expect(probeSpy).toHaveBeenCalledTimes(1)
    expect(probeSpy).toHaveBeenCalledWith("https://r2.example.com/ref.mp4")
    expect(refCreditsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "seedance-2",
        resolution: "720p",
        outputDurationSec: 8,
        durationsSec: [5],
      }),
    )
    // The probe RIDES THE JOB — on the row for the reconcile cron and on the
    // queue payload for the worker — so the settlement prices the input side
    // from the very numbers the reservation read, without probing again.
    expect(fakeJobInsert).toHaveBeenCalledWith(
      expect.objectContaining({ input_data: expect.objectContaining({ refVideoDurationsSec: [5] }) }),
    )
    const { videoQueue } = await import("../../lib/queue.js")
    expect(videoQueue.add).toHaveBeenCalledWith("image-to-video", expect.objectContaining({ refVideoDurationsSec: [5] }))
    await app.close()
  })

  it("an omitted duration reserves the provider's own 8s render, not a literal 5 (seedance-2-5, #1397)", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
      },
    })
    expect(res.statusCode).toBe(200)
    // perSec = 760/8 = 95; 5s clip in + the 8s KIE renders when duration is
    // omitted = ceil(95 × 13) = 1235 — priced under the 8s -ref identifier.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", "seedance-2-5:8s:720p-ref", 0, 0,
      expect.objectContaining({ creditOverride: 1235 }),
    )
    expect(refCreditsSpy).toHaveBeenCalledWith(expect.objectContaining({ outputDurationSec: 8, durationsSec: [5] }))
    await app.close()
  })

  it("the loop-trim add-on stacks on the reference-video base (ceil(6.25 × 13) + 30 = 843)", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
        loopTrim: { enabled: true, framesToTest: 16, quality: "precise" },
      },
    })
    expect(res.statusCode).toBe(200)
    // 813 (input + output) + 10 × (ceil(8/5) + ceil(16/24)) = 813 + 30.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 843 }),
    )
    await app.close()
  })

  it("a run the handler sends down the voiced-video lane (dialogue on a Seedance model) reserves the reference-video worst case PLUS the audio add-on (#1396)", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "seedance-2-5",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
        characterVoices: [{ voiceId: "Rachel", speaker: "Maya" }],
        dialogue: [{ speaker: "Maya", line: "Hello there." }],
      },
    })
    expect(res.statusCode).toBe(200)
    // The voiced lane forwards the reference video like any other run, so the
    // reservation is the same unit×(input+output) worst case — ceil(95 × (5 +
    // 8)) = 1235 — plus the dialogue add-on (elevenlabs-dialogue = 25).
    const { STATIC_CREDIT_COSTS } = await import("../../ee/billing/credits.js")
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", "seedance-2-5:8s:720p-ref", 0, 0,
      expect.objectContaining({ creditOverride: 1235 + STATIC_CREDIT_COSTS["elevenlabs-dialogue"]! }),
    )
    expect(refCreditsSpy).toHaveBeenCalledWith(expect.objectContaining({ provider: "seedance-2-5", outputDurationSec: 8, durationsSec: [5] }))
    // …and the voiced job carries the references and the probe for the worker.
    const { videoQueue } = await import("../../lib/queue.js")
    expect(videoQueue.add).toHaveBeenCalledWith(
      "voiced-video",
      expect.objectContaining({ referenceVideoUrls: ["https://r2.example.com/ref.mp4"], refVideoDurationsSec: [5] }),
    )
    await app.close()
  })

  it("falls back to the normal identifier (no scaling) when there are no reference videos", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://r2.example.com/img.png",
        provider: "seedance-2",
        resolution: "720p",
        duration: 8,
      },
    })
    expect(res.statusCode).toBe(200)
    // No ref videos → hasVideoRef=false → identifier "seedance-2:8s:720p" → STATIC 820.
    // The scaling branch must NOT run, and ffprobe must NOT be called.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 820 }),
    )
    expect(refCreditsSpy).not.toHaveBeenCalled()
    expect(probeSpy).not.toHaveBeenCalled()
    await app.close()
  })
})

describe("/v1/text-to-video Seedance 2 reference-video billing", () => {
  it("reserves unit×(input+output) BASE = 82 for a 5s ref video @ 8s/720p", async () => {
    const app = await buildTextToVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat",
        provider: "seedance-2",
        resolution: "720p",
        duration: 8,
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 813 }),
    )
    expect(refCreditsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "seedance-2",
        resolution: "720p",
        outputDurationSec: 8,
        durationsSec: [5],
      }),
    )
    // The probe rides the job on this lane too.
    expect(fakeJobInsert).toHaveBeenCalledWith(
      expect.objectContaining({ input_data: expect.objectContaining({ refVideoDurationsSec: [5] }) }),
    )
    const { videoQueue } = await import("../../lib/queue.js")
    expect(videoQueue.add).toHaveBeenCalledWith("text-to-video", expect.objectContaining({ refVideoDurationsSec: [5] }))
    await app.close()
  })

  it("falls back to the normal base identifier when there are no reference videos", async () => {
    const app = await buildTextToVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat",
        provider: "seedance-2",
        resolution: "720p",
        duration: 8,
      },
    })
    expect(res.statusCode).toBe(200)
    // identifier "seedance-2:8s:720p" → STATIC 820 (no -ref scaling).
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 820 }),
    )
    expect(refCreditsSpy).not.toHaveBeenCalled()
    expect(probeSpy).not.toHaveBeenCalled()
    await app.close()
  })
})
