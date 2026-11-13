import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("../../lib/config.js", () => ({
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  isCloud: () => true,
  hasAdmin: () => true,
}))

vi.mock("../../lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
}))

vi.mock("../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 0 })),
}))

const fakeProfile = {
  role: "user", tier: "standard", subscription_tier: "standard",
  subscription_credits: 1000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null,
  storage_used_bytes: 0, storage_limit_bytes: 1e10,
}

const fakeJobInsert = vi.fn(() => ({
  select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }),
}))
const fakeJobUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) }))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: fakeProfile, error: null }) }) }) }
      }
      if (table === "jobs") return { insert: fakeJobInsert, update: fakeJobUpdate }
      return {}
    }),
  },
}))

const reserveSpy = vi.fn(() => Promise.resolve({ usageLogId: "log-1", creditsReserved: 12, watermark: false }))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: {
    checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
    checkCreditsWithProfile: vi.fn(() => Promise.resolve({ allowed: true, watermark: false })),
    reserveCredits: reserveSpy,
  },
  // The loop-video row a unit is priced at (`unitRateBaseCredits`).
  getModelCreditBaseCost: vi.fn(async (id: string) => ({ creditCost: id === "loop-video" ? 10 : 999, isEnabled: true, tierRestriction: null })),
}))

vi.mock("../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn(() => Promise.resolve({ id: "queue-1" })) },
}))

// The route measures the video before the guard prices it: 5 s here.
const probeSpy = vi.fn(async (_url: string) => ({ width: 640, height: 360, durationSeconds: 5 }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: probeSpy, assertSafeProbeSource: async () => undefined }))

// The one clip reading both sides measure by (lib/video-utility-probe.ts), driven by the probe above.
vi.mock("../../lib/video-utility-probe.js", () => ({
  probeClipLengthSec: async (src: string) => (await probeSpy(src)).durationSeconds,
  ClipUnreadableError: class ClipUnreadableError extends Error {},
}))

vi.mock("../../lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

beforeEach(() => {
  vi.clearAllMocks()
})

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  // Stub auth — set userId on every request
  app.addHook("preHandler", async (req) => {
    ;(req as any).userId = "u-1"
    ;(req as any).isAppRun = false
  })
  const { loopVideoRoutes } = await import("../loop-video.js")
  await loopVideoRoutes(app)
  return app
}

describe("/v1/loop-video pricing", () => {
  it("reserves credits matching estimateLoopVideoCredits for duration mode", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/loop-video",
      payload: {
        videoUrl: "https://example.com/v.mp4",
        mode: "duration",
        targetDuration: 60, // ceil(60/5) = 12 units = 120 credits
      },
    })
    expect(res.statusCode).toBe(200)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", "loop-video", 0, 0,
      expect.objectContaining({ creditOverride: 120 }),
    )
    await app.close()
  })

  it("prices repeat mode by the video's measured length, never a length the request sends", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/loop-video",
      payload: {
        videoUrl: "https://example.com/v.mp4",
        mode: "repeat",
        repeatCount: 4,
        upstreamDuration: 1, // ignored: 4 × the measured 5 s = 20 s → 4 units = 40 credits
      },
    })
    expect(probeSpy).toHaveBeenCalledWith("https://example.com/v.mp4")
    expect(res.statusCode).toBe(200)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", "loop-video", 0, 0,
      expect.objectContaining({ creditOverride: 40 }),
    )
    await app.close()
  })

  it("smart-loop-cut adds lookback credits", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/loop-video",
      payload: {
        videoUrl: "https://example.com/v.mp4",
        mode: "duration", targetDuration: 30,
        smartLoopCutBeforeRepeat: true, smartLoopCutLookback: 16,
      },
    })
    expect(res.statusCode).toBe(200)
    // 30/5 = 6 units, 16/24 → 1 cut unit, total 7 units = 70 credits
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", "loop-video", 0, 0,
      expect.objectContaining({ creditOverride: 70 }),
    )
    await app.close()
  })
})
