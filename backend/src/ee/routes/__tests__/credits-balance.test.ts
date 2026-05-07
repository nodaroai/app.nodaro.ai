import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  hasCredits: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerCreditsBalanceRoutes } from "../credits-balance.js"
import { supabase } from "../../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth -- set userId from header for protected routes
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
    }
  })

  await registerCreditsBalanceRoutes(app)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function authedGet(url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-test-user-id": TEST_USER_ID },
  })
}

// ---------------------------------------------------------------------------
// GET /v1/credits/balance
// ---------------------------------------------------------------------------

describe("GET /v1/credits/balance", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/credits/balance" })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns total/subscription/topup/tier on success", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { subscription_credits: 100, topup_credits: 50, tier: "pro" },
            error: null,
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/balance")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(150)
    expect(body.subscription).toBe(100)
    expect(body.topup).toBe(50)
    expect(body.tier).toBe("pro")
  })

  it("returns 404 when profile not found", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/balance")
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 500 when supabase errors", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "boom" },
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/balance")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("falls back to 0/0/'free' when columns are null", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { subscription_credits: null, topup_credits: null, tier: null },
            error: null,
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/balance")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({ total: 0, subscription: 0, topup: 0, tier: "free" })
  })
})

// ---------------------------------------------------------------------------
// GET /v1/credits/transactions
// ---------------------------------------------------------------------------

describe("GET /v1/credits/transactions", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/credits/transactions",
    })
    expect(res.statusCode).toBe(401)
  })

  it("rejects invalid limit with 400", async () => {
    const res = await authedGet("/v1/credits/transactions?limit=abc")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects limit > 50 with 400", async () => {
    const res = await authedGet("/v1/credits/transactions?limit=999")
    expect(res.statusCode).toBe(400)
  })

  it("returns rows + null nextCursor when fewer than limit", async () => {
    const rows = [
      {
        id: "log-1",
        created_at: "2026-04-29T10:00:00Z",
        credits_used: 5,
        action: "generate-image",
        provider: "kie",
        metadata: {},
      },
    ]
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=20")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual(rows)
    expect(body.nextCursor).toBeNull()
  })

  it("returns nextCursor when results fill the limit", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `log-${i}`,
      created_at: `2026-04-29T10:0${i}:00Z`,
      credits_used: 1,
      action: "generate-image",
      provider: "kie",
      metadata: {},
    }))
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions?limit=5")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(5)
    expect(body.nextCursor).toBe("2026-04-29T10:04:00Z")
  })

  it("applies cursor as a created_at upper bound when present", async () => {
    const ltSpy = vi.fn().mockResolvedValue({ data: [], error: null })
    const limitSpy = vi.fn().mockReturnValue({ lt: ltSpy })
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: limitSpy,
          }),
        }),
      }),
    } as never)

    const res = await authedGet(
      "/v1/credits/transactions?limit=10&cursor=2026-04-29T10:00:00Z",
    )
    expect(res.statusCode).toBe(200)
    expect(ltSpy).toHaveBeenCalledWith("created_at", "2026-04-29T10:00:00Z")
  })

  it("returns 500 when supabase errors", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/credits/transactions")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ---------------------------------------------------------------------------
// hasCredits() gating
// ---------------------------------------------------------------------------

describe("registerCreditsBalanceRoutes self-hosted gating", () => {
  it("does not register routes when hasCredits() returns false", async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ hasCredits: () => false }))
    const mod = await import("../credits-balance.js")

    const localApp = Fastify({ logger: false })
    localApp.addHook("preHandler", async (req) => {
      req.userId = TEST_USER_ID
    })
    await mod.registerCreditsBalanceRoutes(localApp)
    await localApp.ready()

    const res = await localApp.inject({ method: "GET", url: "/v1/credits/balance" })
    expect(res.statusCode).toBe(404)
    await localApp.close()

    vi.doUnmock("@/lib/config.js")
  })
})
