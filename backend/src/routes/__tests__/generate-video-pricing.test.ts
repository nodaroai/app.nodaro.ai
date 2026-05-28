import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

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

const fakeProfile = {
  role: "user", tier: "standard", subscription_tier: "standard",
  subscription_credits: 1000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null,
  storage_used_bytes: 0, storage_limit_bytes: 1e10,
}

// Route uses insertWithIdempotencyKey — plain INSERT when no header is
// supplied (the no-dedup path), upsert when a header IS sent. Mock both
// chains so the test works under either client behavior.
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
      if (table === "model_pricing") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { credit_cost: 19, is_enabled: true, tier_restriction: null }, error: null }) }) }) }
      }
      return {}
    }),
  },
}))

const reserveSpy = vi.fn(() => Promise.resolve({ usageLogId: "log-1", creditsReserved: 22, watermark: false }))
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

vi.mock("../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn(() => Promise.resolve({ id: "queue-1" })) },
}))

beforeEach(() => { vi.clearAllMocks() })

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as any).userId = "u-1"
    ;(req as any).isAppRun = false
  })
  const { generateVideoRoutes } = await import("../generate-video.js")
  await generateVideoRoutes(app)
  return app
}

describe("/v1/generate-video pricing with loopTrim", () => {
  it("reserves dbCost only when loopTrim is omitted", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://r2.example.com/img.png",
        provider: "veo3.1",
        duration: 8,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 19 }),
    )
    await app.close()
  })

  it("reserves dbCost + addon when loopTrim.enabled", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://r2.example.com/img.png",
        provider: "veo3.1",
        duration: 8,
        loopTrim: { enabled: true, framesToTest: 16, quality: "precise" },
      },
    })
    expect(res.statusCode).toBe(200)
    // 19 base + ceil(8/5)=2 + ceil(16/24)=1 = 22
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 22 }),
    )
    await app.close()
  })

  it("legacy autoLoopTrim=true is normalized to loopTrim with framesToTest=8", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://r2.example.com/img.png",
        provider: "veo3.1",
        duration: 8,
        autoLoopTrim: true,
      },
    })
    expect(res.statusCode).toBe(200)
    // 19 base + ceil(8/5)=2 + ceil(8/24)=1 = 22
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 22 }),
    )
    await app.close()
  })

  it("legacy autoLoopTrim=false maps to disabled loopTrim", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        imageUrl: "https://r2.example.com/img.png",
        provider: "veo3.1",
        duration: 8,
        autoLoopTrim: false,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(reserveSpy).toHaveBeenCalledWith(
      "u-1", "job-1", expect.any(String), 0, 0,
      expect.objectContaining({ creditOverride: 19 }),  // dbCost only
    )
    await app.close()
  })
})
