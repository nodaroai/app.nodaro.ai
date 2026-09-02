import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

// ---------------------------------------------------------------------------
// MiniMax Hailuo 3 dynamic billing (sibling of seedance2-ref-video-billing).
//
// KIE bills an H3 run by `unit × (input_video + output)` seconds AND 11 KIE cr
// per input image beyond the first 5, but the seeded composites only encode
// the per-duration OUTPUT rate. `commit_credits` can only refund (never
// up-charge), so the route's `computeCredits` hook must ffprobe the reference
// videos / count the assembled reference images and reserve the FULL base up
// front.
//
// Pins: perSecBase = STATIC["minimax-h3:8s"]/8 = 730/8 = 91.25.
//   - ref video (probe→5s) @ 8s out → ceil(91.25 × 13) = 1187 (not the 730 output-only)
//   - 7 user refs + start frame (8 pool images, 3 chargeable) @ 6s, no videos →
//     ceil(91.25×6 + 3×27.5) = ceil(630.0) = 630, WITHOUT any ffprobe call
//   - control (≤5 images, no videos) → the plain seeded composite 730, hook
//     branch never taken.
//
// Markup is mocked to 0% so `creditOverride` == the BASE credits; model_pricing
// DB lookup is mocked to MISS so real STATIC_CREDIT_COSTS numbers are asserted.
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

// Keep STATIC_CREDIT_COSTS / getModelCreditBaseCost real; only swap the
// CreditsService methods so the reserved override can be captured.
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

// Spy on BOTH hook entry points so the control case proves the dynamic branch
// is NOT taken; keep the real implementation for the math.
//
// A ref-video request now prices through `…FromDurations`: the routes' duration
// pre-check ffprobed the clips first and stashed them on the request, so the
// pricing side reuses that array instead of probing again (R15). A request with
// NO ref videos (the >5-images surcharge) has no stash and still runs
// `…FromUrls` — which probes an empty list.
const h3CreditsSpy = vi.fn()
const h3DurationsSpy = vi.fn()
vi.mock("../../ee/billing/minimax-h3-credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../ee/billing/minimax-h3-credits.js")>("../../ee/billing/minimax-h3-credits.js")
  return {
    ...actual,
    minimaxH3BaseCreditsFromUrls: (args: Parameters<typeof actual.minimaxH3BaseCreditsFromUrls>[0]) => {
      h3CreditsSpy(args)
      return actual.minimaxH3BaseCreditsFromUrls(args)
    },
    minimaxH3BaseCreditsFromDurations: (args: Parameters<typeof actual.minimaxH3BaseCreditsFromDurations>[0]) => {
      h3DurationsSpy(args)
      return actual.minimaxH3BaseCreditsFromDurations(args)
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

describe("/v1/generate-video minimax-h3 dynamic billing", () => {
  it("reserves unit×(input+output) BASE = 1187 for a 5s ref video @ 8s out", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "minimax-h3",
        duration: 8,
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
      },
    })
    expect(res.statusCode).toBe(200)
    // perSecBase = 730/8 = 91.25 → ceil(91.25 × (5 + 8)) = 1187 (not output-only 730)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 1187 }),
    )
    // R15: ONE ffprobe for the clip — the pre-check's, reused by the pricer.
    expect(probeSpy).toHaveBeenCalledTimes(1)
    expect(h3CreditsSpy).not.toHaveBeenCalled()
    expect(h3DurationsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDurationSec: 8,
        durationsSec: [5],
        referenceImageCount: 0,
      }),
    )
    await app.close()
  })

  it("reserves the extra-image surcharge for >5 pool images (7 refs + start frame @ 6s) = 630, without ffprobe", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "minimax-h3",
        duration: 6,
        imageUrl: "https://r2.example.com/frame.png",
        referenceImageUrls: [
          "https://r2.example.com/r1.png",
          "https://r2.example.com/r2.png",
          "https://r2.example.com/r3.png",
          "https://r2.example.com/r4.png",
          "https://r2.example.com/r5.png",
          "https://r2.example.com/r6.png",
          "https://r2.example.com/r7.png",
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    // Reference mode: 7 user refs + folded frame = 8 pool images → 3 chargeable.
    // ceil(91.25×6 + 3×27.5) = ceil(547.5 + 82.5) = 630.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 630 }),
    )
    expect(h3CreditsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outputDurationSec: 6, referenceImageCount: 8 }),
    )
    expect(probeSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("falls back to the seeded duration composite (730) when ≤5 images and no ref videos", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://r2.example.com/img.png",
        provider: "minimax-h3",
        duration: 8,
      },
    })
    expect(res.statusCode).toBe(200)
    // Strict i2v mode → identifier "minimax-h3:8s" → STATIC 730; the dynamic
    // branch must NOT reserve and ffprobe must NOT run.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 730 }),
    )
    expect(h3CreditsSpy).not.toHaveBeenCalled()
    expect(probeSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("768P prices the :768p composite (450) on the plain path — no dynamic branch", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://r2.example.com/img.png",
        provider: "minimax-h3",
        duration: 8,
        resolution: "768P",
      },
    })
    expect(res.statusCode).toBe(200)
    // Strict i2v mode → identifier "minimax-h3:8s:768p" → STATIC 450.
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 450 }),
    )
    expect(h3CreditsSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("768P bills ref-video input seconds at the 768P rate: 5s ref @ 8s out → ceil(56.25 × 13) = 732", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "minimax-h3",
        duration: 8,
        resolution: "768P",
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
      },
    })
    expect(res.statusCode).toBe(200)
    // perSecBase = 450/8 = 56.25 → ceil(56.25 × (5 + 8)) = 732 (vs 1187 @2K)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 732 }),
    )
    expect(h3DurationsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outputDurationSec: 8, durationsSec: [5], resolution: "768P" }),
    )
    await app.close()
  })

  it("a stale non-H3 resolution collapses to the 2K rate (what KIE renders for it)", async () => {
    const app = await buildGenerateVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        provider: "minimax-h3",
        duration: 8,
        resolution: "720p", // stale Seedance value carried across a provider switch
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 1187 }),
    )
    await app.close()
  })
})

describe("/v1/text-to-video minimax-h3 dynamic billing", () => {
  it("reserves unit×(input+output) BASE = 1187 for a 5s ref video @ 8s out", async () => {
    const app = await buildTextToVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat",
        provider: "minimax-h3",
        duration: 8,
        referenceVideoUrls: ["https://r2.example.com/ref.mp4"],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 1187 }),
    )
    expect(probeSpy).toHaveBeenCalledTimes(1)
    expect(h3DurationsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDurationSec: 8,
        durationsSec: [5],
        referenceImageCount: 0, // t2v has no frames and no image refs wired here
      }),
    )
    await app.close()
  })

  it("falls back to the seeded duration composite when no ref videos and ≤5 images", async () => {
    const app = await buildTextToVideoApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-video",
      payload: {
        prompt: "a cat",
        provider: "minimax-h3",
        duration: 8,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 730 }),
    )
    expect(h3CreditsSpy).not.toHaveBeenCalled()
    expect(probeSpy).not.toHaveBeenCalled()
    await app.close()
  })
})
