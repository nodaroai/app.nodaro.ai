import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockFrom, mockHasCreditsRef, mockCheckCreditsWithProfile, mockCheckStorageLimitWithProfile, mockReserveCredits, mockWarmAdminCache } = vi.hoisted(() => {
  const mockHasCreditsRef = { value: true }
  const mockCheckCreditsWithProfile = vi.fn()
  const mockCheckStorageLimitWithProfile = vi.fn()
  const mockReserveCredits = vi.fn()
  const mockWarmAdminCache = vi.fn()

  const mockFrom = vi.fn()

  return {
    mockFrom,
    mockHasCreditsRef,
    mockCheckCreditsWithProfile,
    mockCheckStorageLimitWithProfile,
    mockReserveCredits,
    mockWarmAdminCache,
  }
})

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => mockHasCreditsRef.value,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: mockFrom,
    auth: { getUser: vi.fn() },
  },
}))

vi.mock("@/billing/credits.js", () => ({
  CreditsService: {
    checkCreditsWithProfile: mockCheckCreditsWithProfile,
    checkStorageLimitWithProfile: mockCheckStorageLimitWithProfile,
    reserveCredits: mockReserveCredits,
  },
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: mockWarmAdminCache,
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { creditGuard, reserveCreditsForJob } from "../credit-guard.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSupabaseProfileChain(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }
}

/** Build a minimal Fastify app with the creditGuard preHandler on a test route. */
async function buildApp(modelResolver?: (req: unknown) => string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  // Simulate authenticated user via userId in the request body.
  // Mirrors auth.ts: X-App-Run: "true" header sets req.isAppRun for internal orchestrator calls.
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
    }
    if (req.headers["x-app-run"] === "true") {
      req.isAppRun = true
    }
  })

  const resolver = modelResolver ?? ((req: unknown) => {
    const body = (req as Record<string, unknown>).body as Record<string, unknown> | undefined
    return (body?.provider as string) ?? "flux"
  })

  app.post("/v1/test-route", {
    preHandler: creditGuard(resolver),
  }, async (req) => {
    return {
      ok: true,
      creditReservation: req.creditReservation ?? null,
    }
  })

  await app.ready()
  return app
}

// ---------------------------------------------------------------------------
// Tests — creditGuard
// ---------------------------------------------------------------------------

describe("creditGuard", () => {
  let app: FastifyInstance

  afterEach(async () => {
    if (app) await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCreditsRef.value = true
  })

  it("skips when hasCredits() returns false (request passes through)", async () => {
    mockHasCreditsRef.value = false
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    // No supabase profile query should have been made
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("skips for anonymous requests (no userId)", async () => {
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { provider: "flux" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("skips for ffmpeg model identifier", async () => {
    app = await buildApp(() => "ffmpeg")

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("returns 500 when profile query fails", async () => {
    mockFrom.mockReturnValue(
      createSupabaseProfileChain(null, { message: "DB error" })
    )
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(500)
    const body = res.json()
    expect(body.error.code).toBe("credit_check_failed")
    expect(body.error.message).toContain("profile")
  })

  it("returns 413 when storage limit exceeded", async () => {
    const profile = {
      role: "user",
      tier: "free",
      subscription_tier: null,
      subscription_credits: 50,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString(),
      storage_used_bytes: 2_000_000_000,
      storage_limit_bytes: 1_000_000_000,
    }
    mockFrom.mockReturnValue(createSupabaseProfileChain(profile))
    mockCheckStorageLimitWithProfile.mockReturnValue({
      allowed: false,
      error: "Storage limit reached (1.0 GB)",
      usedBytes: 2_000_000_000,
      limitBytes: 1_000_000_000,
    })
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(413)
    const body = res.json()
    expect(body.error.code).toBe("storage_limit_exceeded")
    expect(body.error.usedBytes).toBe(2_000_000_000)
    expect(body.error.quotaBytes).toBe(1_000_000_000)
    expect(body.error.tier).toBe("free")
  })

  it("returns 402 when insufficient credits", async () => {
    const profile = {
      role: "user",
      tier: "free",
      subscription_tier: null,
      subscription_credits: 2,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString(),
      storage_used_bytes: 100_000,
      storage_limit_bytes: 1_000_000_000,
    }
    mockFrom.mockReturnValue(createSupabaseProfileChain(profile))
    mockCheckStorageLimitWithProfile.mockReturnValue({
      allowed: true,
      usedBytes: 100_000,
      limitBytes: 1_000_000_000,
    })
    mockCheckCreditsWithProfile.mockResolvedValue({
      allowed: false,
      error: "Insufficient credits",
      required: 10,
      balance: 2,
    })
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(402)
    const body = res.json()
    expect(body.error.code).toBe("insufficient_credits")
    expect(body.required).toBe(10)
    expect(body.balance).toBe(2)
  })

  it("sets watermark=true for free tier (allowed but watermarked)", async () => {
    const profile = {
      role: "user",
      tier: "free",
      subscription_tier: null,
      subscription_credits: 30,
      topup_credits: 10,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString(),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    }
    mockFrom.mockReturnValue(createSupabaseProfileChain(profile))
    mockCheckStorageLimitWithProfile.mockReturnValue({
      allowed: true,
      usedBytes: 0,
      limitBytes: 1_000_000_000,
    })
    mockCheckCreditsWithProfile.mockResolvedValue({
      allowed: true,
      balance: 40,
      required: 1,
      watermark: true,
    })
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.creditReservation).toEqual({
      usageLogId: "",
      creditsReserved: 0,
      watermark: true,
    })
  })

  it("forwards req.isAppRun=true to checkCreditsWithProfile (app-run gating)", async () => {
    const profile = {
      role: "user",
      tier: "free",
      subscription_tier: null,
      subscription_credits: 50,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString(),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    }
    mockFrom.mockReturnValue(createSupabaseProfileChain(profile))
    mockCheckStorageLimitWithProfile.mockReturnValue({
      allowed: true,
      usedBytes: 0,
      limitBytes: 1_000_000_000,
    })
    mockCheckCreditsWithProfile.mockResolvedValue({
      allowed: true,
      balance: 50,
      required: 5,
      watermark: true,
    })
    app = await buildApp()

    await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "x-app-run": "true" },
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(mockCheckCreditsWithProfile).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ tier: "free" }),
      "flux",
      true,
      undefined,
    )
  })

  it("omits isAppRun when X-App-Run header absent (flow-run gating)", async () => {
    const profile = {
      role: "user",
      tier: "free",
      subscription_tier: null,
      subscription_credits: 50,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString(),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    }
    mockFrom.mockReturnValue(createSupabaseProfileChain(profile))
    mockCheckStorageLimitWithProfile.mockReturnValue({
      allowed: true,
      usedBytes: 0,
      limitBytes: 1_000_000_000,
    })
    mockCheckCreditsWithProfile.mockResolvedValue({
      allowed: true,
      balance: 50,
      required: 5,
      watermark: true,
    })
    app = await buildApp()

    await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(mockCheckCreditsWithProfile).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ tier: "free" }),
      "flux",
      undefined,
      undefined,
    )
  })

  it("sets watermark=false for paid tier", async () => {
    const profile = {
      role: "user",
      tier: "pro",
      subscription_tier: null,
      subscription_credits: 200,
      topup_credits: 50,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString(),
      storage_used_bytes: 0,
      storage_limit_bytes: 50_000_000_000,
    }
    mockFrom.mockReturnValue(createSupabaseProfileChain(profile))
    mockCheckStorageLimitWithProfile.mockReturnValue({
      allowed: true,
      usedBytes: 0,
      limitBytes: 50_000_000_000,
    })
    mockCheckCreditsWithProfile.mockResolvedValue({
      allowed: true,
      balance: 250,
      required: 1,
      watermark: false,
    })
    app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "flux" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.creditReservation).toEqual({
      usageLogId: "",
      creditsReserved: 0,
      watermark: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Tests — reserveCreditsForJob
// ---------------------------------------------------------------------------

describe("reserveCreditsForJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCreditsRef.value = true
  })

  it("returns undefined when hasCredits() is false", async () => {
    mockHasCreditsRef.value = false

    const mockReq = {
      userId: "user-1",
      url: "/v1/test-route",
      creditReservation: undefined,
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]
    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as Parameters<typeof reserveCreditsForJob>[1]

    const result = await reserveCreditsForJob(mockReq, mockReply, "job-1", "flux")

    expect(result).toBeUndefined()
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("reserves credits for ffmpeg model identifier", async () => {
    mockReserveCredits.mockResolvedValueOnce({
      usageLogId: "ul-1",
      creditsReserved: 1,
      watermark: false,
    })
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })

    const mockReq = {
      userId: "user-1",
      url: "/v1/test-route",
      creditReservation: undefined,
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]
    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as Parameters<typeof reserveCreditsForJob>[1]

    const result = await reserveCreditsForJob(mockReq, mockReply, "job-1", "ffmpeg")

    expect(result).toEqual({
      usageLogId: "ul-1",
      creditsReserved: 1,
      watermark: false,
    })
    expect(mockReserveCredits).toHaveBeenCalledWith("user-1", "job-1", "ffmpeg", 0, 0, { watermarkOverride: undefined, isAppRun: undefined })
  })

  it("forwards req.isAppRun=true to reserveCredits (app-run pool accounting)", async () => {
    mockReserveCredits.mockResolvedValueOnce({
      usageLogId: "ul-2",
      creditsReserved: 5,
      watermark: false,
    })
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })

    const mockReq = {
      userId: "user-1",
      url: "/v1/test-route",
      isAppRun: true,
      creditReservation: undefined,
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]
    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as Parameters<typeof reserveCreditsForJob>[1]

    await reserveCreditsForJob(mockReq, mockReply, "job-2", "ai-writer")

    expect(mockReserveCredits).toHaveBeenCalledWith(
      "user-1",
      "job-2",
      "ai-writer",
      0,
      0,
      { watermarkOverride: undefined, isAppRun: true },
    )
  })
})
