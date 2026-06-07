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

// PriceNotConfiguredError must be the REAL class (not a vi.fn) so the
// `err instanceof PriceNotConfiguredError` check in credit-guard-impl works.
class PriceNotConfiguredError extends Error {
  readonly modelIdentifier: string
  constructor(modelIdentifier: string) {
    super(`Pricing is not configured for "${modelIdentifier}".`)
    this.name = "PriceNotConfiguredError"
    this.modelIdentifier = modelIdentifier
    Object.setPrototypeOf(this, PriceNotConfiguredError.prototype)
  }
}

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    checkCreditsWithProfile: mockCheckCreditsWithProfile,
    checkStorageLimitWithProfile: mockCheckStorageLimitWithProfile,
    reserveCredits: mockReserveCredits,
  },
  PriceNotConfiguredError,
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
    const appScopes = req.headers["x-app-scopes"]
    if (typeof appScopes === "string") {
      ;(req as { appAuthorization?: unknown }).appAuthorization = {
        appId: "app-1",
        authorizationId: "auth-1",
        scopes: appScopes.split(",").filter(Boolean),
      }
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

  it("blocks an OAuth app token with only read scopes from spending credits (403 insufficient_scope)", async () => {
    app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "x-app-scopes": "jobs:read,workflows:read" },
      payload: { userId: "owner-1", provider: "flux" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
  })

  it("allows an OAuth app token with a :write/:execute scope past the credit gate", async () => {
    app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      headers: { "x-app-scopes": "jobs:read,assets:write" },
      payload: { userId: "owner-1", provider: "flux" },
    })
    expect(res.statusCode).not.toBe(403) // passed the scope gate
  })

  it("does not gate plain user requests (no appAuthorization)", async () => {
    app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "owner-1", provider: "flux" },
    })
    expect(res.statusCode).not.toBe(403)
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
    // No credit-check should run (the dedup SELECT on "jobs" is allowed).
    expect(mockCheckCreditsWithProfile).not.toHaveBeenCalled()
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
    // No userId → dedup is also skipped, so mockFrom genuinely isn't called.
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockCheckCreditsWithProfile).not.toHaveBeenCalled()
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
    expect(mockCheckCreditsWithProfile).not.toHaveBeenCalled()
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

// ---------------------------------------------------------------------------
// Tests — PriceNotConfiguredError hard-fail policy (2026-05)
// ---------------------------------------------------------------------------

describe("creditGuard — PriceNotConfiguredError → 503", () => {
  let app: FastifyInstance

  afterEach(async () => {
    if (app) await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCreditsRef.value = true
  })

  it("returns 503 price_not_configured when checkCreditsWithProfile throws PriceNotConfiguredError", async () => {
    const profile = {
      role: "user",
      tier: "pro",
      subscription_tier: null,
      subscription_credits: 1000,
      topup_credits: 0,
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
    // Simulate: the underlying getModelCreditBaseCost throws because neither
    // model_pricing nor STATIC_CREDIT_COSTS has the identifier.
    mockCheckCreditsWithProfile.mockRejectedValue(
      new PriceNotConfiguredError("seedance-2:8s:1080p-ref"),
    )

    app = await buildApp((req: unknown) => {
      const body = (req as Record<string, unknown>).body as Record<string, unknown> | undefined
      return (body?.provider as string) ?? "seedance-2:8s:1080p-ref"
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1", provider: "seedance-2:8s:1080p-ref" },
    })

    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.error.code).toBe("price_not_configured")
    expect(body.error.identifier).toBe("seedance-2:8s:1080p-ref")
    expect(body.error.message).toContain("seedance-2:8s:1080p-ref")
    expect(body.error.message).toContain("model_pricing")
  })

  it("returns 503 price_not_configured when computeCredits throws PriceNotConfiguredError", async () => {
    // A computeCredits hook (e.g. generate-video.ts) that calls
    // getModelCreditBaseCost on a missing identifier must surface the same
    // 503 — not get swallowed and allow the request through.
    const profile = {
      role: "user",
      tier: "pro",
      subscription_tier: null,
      subscription_credits: 1000,
      topup_credits: 0,
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

    // Build app with a creditGuard that has a computeCredits hook that throws
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (body?.userId && typeof body.userId === "string") {
        req.userId = body.userId
      }
    })
    app.post("/v1/test-route", {
      preHandler: creditGuard(
        () => "ghost-model",
        {
          computeCredits: async () => {
            throw new PriceNotConfiguredError("ghost-model:variant")
          },
        },
      ),
    }, async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "user-1" },
    })

    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.error.code).toBe("price_not_configured")
    expect(body.error.identifier).toBe("ghost-model:variant")
    expect(mockCheckCreditsWithProfile).not.toHaveBeenCalled()
  })
})

describe("reserveCreditsForJob — PriceNotConfiguredError → 503", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCreditsRef.value = true
  })

  it("returns 503 and deletes orphan job row when reserveCredits throws PriceNotConfiguredError", async () => {
    // The reservation path is the second tripwire. Even if a route's
    // creditGuard preHandler passed (e.g. computeCredits override), a
    // missing-price model at reserve-time must still hard-fail. The job row
    // (just inserted by the route) must be cleaned up to avoid a stale
    // pending entry.
    mockReserveCredits.mockRejectedValueOnce(
      new PriceNotConfiguredError("missing-id"),
    )
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({
      delete: vi.fn().mockReturnValue({ eq: deleteEq }),
    })

    const statusMock = vi.fn().mockReturnThis()
    const sendMock = vi.fn()
    const mockReq = {
      userId: "user-1",
      url: "/v1/test-route",
      creditReservation: undefined,
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]
    const mockReply = {
      status: statusMock,
      send: sendMock,
    } as unknown as Parameters<typeof reserveCreditsForJob>[1]

    const result = await reserveCreditsForJob(mockReq, mockReply, "job-99", "missing-id")

    expect(result).toBeUndefined()
    expect(statusMock).toHaveBeenCalledWith(503)
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "price_not_configured",
          identifier: "missing-id",
        }),
      }),
    )
    // Orphan job row cleanup
    expect(deleteEq).toHaveBeenCalledWith("id", "job-99")
  })
})
