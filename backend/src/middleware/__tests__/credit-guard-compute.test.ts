import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const {
  mockFrom,
  mockHasCreditsRef,
  mockCheckCreditsWithProfile,
  mockCheckStorageLimitWithProfile,
  mockReserveCredits,
  mockWarmAdminCache,
  mockGetAppSettings,
} = vi.hoisted(() => {
  const mockHasCreditsRef = { value: true }
  const mockCheckCreditsWithProfile = vi.fn()
  const mockCheckStorageLimitWithProfile = vi.fn()
  const mockReserveCredits = vi.fn()
  const mockWarmAdminCache = vi.fn()
  const mockGetAppSettings = vi.fn()
  const mockFrom = vi.fn()

  return {
    mockFrom,
    mockHasCreditsRef,
    mockCheckCreditsWithProfile,
    mockCheckStorageLimitWithProfile,
    mockReserveCredits,
    mockWarmAdminCache,
    mockGetAppSettings,
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

vi.mock("@/ee/billing/credits.js", () => ({
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

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: mockGetAppSettings,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { creditGuard, reserveCreditsForJob } from "../credit-guard.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeProfile = {
  role: "user",
  tier: "standard",
  subscription_tier: "standard",
  subscription_credits: 1000,
  topup_credits: 0,
  daily_spent_credits: 0,
  last_daily_reset: null,
  storage_used_bytes: 0,
  storage_limit_bytes: 1e10,
}

function createSupabaseProfileChain(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }
}

async function buildApp(
  modelResolver: (req: unknown) => string,
  computeCredits?: (body: unknown) => number,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
    }
  })

  const guard = creditGuard(
    (req) => modelResolver(req),
    computeCredits ? { computeCredits } : undefined,
  )

  app.post("/v1/test-route", { preHandler: guard }, async (req) => ({
    ok: true,
    creditReservation: req.creditReservation ?? null,
  }))

  await app.ready()
  return app
}

// ---------------------------------------------------------------------------
// Tests — creditGuard with computeCredits
// ---------------------------------------------------------------------------

describe("creditGuard with computeCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCreditsRef.value = true
    // Default: storage OK, credits OK (no watermark)
    mockCheckStorageLimitWithProfile.mockReturnValue({
      allowed: true,
      usedBytes: 0,
      limitBytes: 1e10,
    })
    mockCheckCreditsWithProfile.mockResolvedValue({ allowed: true, watermark: false })
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockFrom.mockReturnValue(createSupabaseProfileChain(fakeProfile))
  })

  it("passes the computed amount as creditOverride to checkCreditsWithProfile", async () => {
    const app = await buildApp(() => "loop-video", () => 7)

    await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "u1" },
    })

    expect(mockCheckCreditsWithProfile).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ tier: "standard" }),
      "loop-video",
      undefined,
      7,
    )

    await app.close()
  })

  it("applies admin markup when cost_markup_percent > 0", async () => {
    ***REDACTED-OSS-SCRUB***

    ***REDACTED-OSS-SCRUB***
    const app = await buildApp(() => "loop-video", () => 4)

    await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "u1" },
    })

    expect(mockCheckCreditsWithProfile).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ tier: "standard" }),
      "loop-video",
      undefined,
      5,
    )

    await app.close()
  })

  it("does not pass creditOverride when computeCredits is omitted", async () => {
    const app = await buildApp(() => "some-model")

    await app.inject({
      method: "POST",
      url: "/v1/test-route",
      payload: { userId: "u1" },
    })

    expect(mockCheckCreditsWithProfile).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ tier: "standard" }),
      "some-model",
      undefined,
      undefined,
    )

    await app.close()
  })

  it("forwards creditOverride from req.creditReservation to reserveCredits", async () => {
    mockReserveCredits.mockResolvedValueOnce({
      usageLogId: "log-123",
      creditsReserved: 7,
      watermark: false,
    })
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    })

    const mockReq = {
      userId: "u1",
      url: "/v1/loop-video",
      body: {},
      isAppRun: false,
      creditReservation: {
        usageLogId: "",
        creditsReserved: 0,
        watermark: false,
        creditOverride: 7,
      },
    } as unknown as Parameters<typeof reserveCreditsForJob>[0]

    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as Parameters<typeof reserveCreditsForJob>[1]

    await reserveCreditsForJob(mockReq, mockReply, "job-1", "loop-video")

    expect(mockReserveCredits).toHaveBeenCalledWith(
      "u1",
      "job-1",
      "loop-video",
      0,
      0,
      expect.objectContaining({ creditOverride: 7 }),
    )
  })
})
