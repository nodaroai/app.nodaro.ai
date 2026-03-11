import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const VALID_UUID = "00000000-0000-4000-8000-000000000001"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route/lib import
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: vi.fn(),
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (code: number) => { send: (body: unknown) => void } }) => {
    if (req.userId !== ADMIN_UUID) {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

vi.mock("@/billing/credits.js", () => ({
  CreditsService: {
    getBalance: vi.fn(),
    adminAdjustCredits: vi.fn(),
  },
  invalidateModelPricingCache: vi.fn(),
}))

vi.mock("@/routes/credits.js", () => ({
  invalidateBalanceCache: vi.fn(),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { adminCreditsRoutes } from "../admin-credits.js"
import { CreditsService } from "../../billing/credits.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fluent Supabase chain that resolves to the given result. */
function supabaseChain(result: { data: unknown; error: unknown; count?: number }): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const self = () => chain

  chain.select = vi.fn().mockImplementation((_cols?: string, _opts?: unknown) => {
    // Attach count to the eventual result when { count: "exact" } is used
    return self()
  })
  chain.insert = vi.fn().mockReturnValue(self())
  chain.update = vi.fn().mockReturnValue(self())
  chain.eq = vi.fn().mockReturnValue(self())
  chain.or = vi.fn().mockReturnValue(self())
  chain.order = vi.fn().mockReturnValue(self())
  chain.range = vi.fn().mockReturnValue(self())
  chain.single = vi.fn().mockResolvedValue(result)

  // When the chain is awaited directly (no .single()), resolve with data + count
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
    resolve({ data: result.data, error: result.error, count: result.count ?? null })
  })

  return chain
}

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Set userId from X-User-Id header to simulate auth
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") {
      req.userId = userId
    }
  })

  await app.register(async (instance) => {
    await adminCreditsRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /v1/admin/users", () => {
  it("returns 403 when not admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: { "x-user-id": VALID_UUID },
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error.code).toBe("forbidden")
  })

  it("returns paginated user list", async () => {
    const users = [
      {
        id: VALID_UUID,
        display_name: "Test User",
        avatar_url: null,
        subscription_tier: "pro",
        subscription_credits: 500,
        topup_credits: 100,
        daily_spent_credits: 10,
        storage_used_bytes: 1024,
        storage_limit_bytes: 50_000_000_000,
        created_at: "2025-01-01T00:00:00Z",
      },
    ]

    const chain = supabaseChain({ data: users, error: null, count: 1 })
    mockFrom.mockReturnValue(chain)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/users?limit=10&offset=0",
      headers: { "x-user-id": ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(1)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].total_credits).toBe(600)
    expect(body.limit).toBe(10)
    expect(body.offset).toBe(0)
  })
})

describe("POST /v1/admin/users/:id/credits", () => {
  it("returns 400 on missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${VALID_UUID}/credits`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: { amount: 10 },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toBeDefined()
  })

  it("returns success with new balance on valid adjustment", async () => {
    vi.mocked(CreditsService.adminAdjustCredits).mockResolvedValue({ newBalance: 110 })

    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${VALID_UUID}/credits`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: {
        amount: 10,
        creditType: "topup",
        description: "Admin grant",
        adminUserId: ADMIN_UUID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.newBalance).toBe(110)
    expect(CreditsService.adminAdjustCredits).toHaveBeenCalledWith({
      userId: VALID_UUID,
      amount: 10,
      creditType: "topup",
      description: "Admin grant",
      adminUserId: ADMIN_UUID,
    })
  })
})

describe("PUT /v1/admin/users/:id/tier", () => {
  it("returns 400 on invalid tier", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/users/${VALID_UUID}/tier`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: { tier: "diamond", adminUserId: ADMIN_UUID },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toContain("Invalid enum value")
  })

  it("returns success on valid tier change", async () => {
    // First call: profiles select for current tier
    const profileChain = supabaseChain({
      data: { subscription_tier: "free", subscription_credits: 50, topup_credits: 20 },
      error: null,
    })
    // Second call: profiles update
    const updateChain = supabaseChain({ data: null, error: null })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return profileChain
      return updateChain
    })

    vi.mocked(CreditsService.adminAdjustCredits).mockResolvedValue({ newBalance: 495 })

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/users/${VALID_UUID}/tier`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: { tier: "basic", adminUserId: ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.tier).toBe("basic")
    expect(body.subscription_credits).toBe(250)
    expect(body.total_credits).toBe(270)
  })
})

describe("PUT /v1/admin/users/:id/storage", () => {
  it("returns 400 on invalid storage value", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/users/${VALID_UUID}/storage`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: { storageLimitBytes: -1, adminUserId: ADMIN_UUID },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toContain("Number must be greater than 0")
  })

  it("returns success on valid storage update", async () => {
    // First call: fetch current profile
    const profileChain = supabaseChain({
      data: { storage_limit_bytes: 1_000_000_000 },
      error: null,
    })
    // Second call: update storage
    const updateChain = supabaseChain({ data: null, error: null })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return profileChain
      return updateChain
    })

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/users/${VALID_UUID}/storage`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: { storageLimitBytes: 50_000_000_000, adminUserId: ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.storage_limit_bytes).toBe(50_000_000_000)
    expect(body.previous_limit).toBe(1_000_000_000)
  })
})

describe("PUT /v1/admin/users/:id/role", () => {
  it("returns 403 for non-super_admin trying to change role", async () => {
    // Mock admin profile lookup returns "admin" (not "super_admin")
    const adminProfileChain = supabaseChain({
      data: { role: "admin" },
      error: null,
    })
    mockFrom.mockReturnValue(adminProfileChain)

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/users/${VALID_UUID}/role`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: { role: "admin" },
    })

    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.error).toContain("Only super_admin can change user roles")
  })

  it("returns 400 when trying to change own role", async () => {
    // Mock admin profile lookup returns "super_admin"
    const adminProfileChain = supabaseChain({
      data: { role: "super_admin" },
      error: null,
    })
    mockFrom.mockReturnValue(adminProfileChain)

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/users/${ADMIN_UUID}/role`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: { role: "user" },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toContain("Cannot change your own role")
  })

  it("returns success on valid role change", async () => {
    // First call: admin profile check (super_admin)
    const adminProfileChain = supabaseChain({
      data: { role: "super_admin" },
      error: null,
    })
    // Second call: target user profile
    const targetProfileChain = supabaseChain({
      data: { email: "user@example.com", role: "user" },
      error: null,
    })
    // Third call: update role
    const updateChain = supabaseChain({ data: null, error: null })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return adminProfileChain
      if (callCount === 2) return targetProfileChain
      return updateChain
    })

    const res = await app.inject({
      method: "PUT",
      url: `/v1/admin/users/${VALID_UUID}/role`,
      headers: { "x-user-id": ADMIN_UUID },
      payload: { role: "admin" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.role).toBe("admin")
    expect(body.previous_role).toBe("user")
  })
})

describe("GET /v1/admin/users/:id/balance", () => {
  it("returns balance data", async () => {
    const balanceData = {
      total: 600,
      subscription: 500,
      topup: 100,
      dailySpent: 10,
      dailyLimit: null,
      monthlyAllocation: 530,
      tier: "pro",
      features: {},
      periodEnd: null,
      appCreditsAllowance: 0,
    }

    vi.mocked(CreditsService.getBalance).mockResolvedValue(balanceData)

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${VALID_UUID}/balance`,
      headers: { "x-user-id": ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(600)
    expect(body.subscription).toBe(500)
    expect(body.topup).toBe(100)
    expect(body.tier).toBe("pro")
    expect(CreditsService.getBalance).toHaveBeenCalledWith(VALID_UUID)
  })
})

describe("GET /v1/admin/models", () => {
  it("returns model pricing list", async () => {
    const models = [
      { model_identifier: "nano-banana", credit_cost: 4, is_enabled: true, tier_restriction: null },
      { model_identifier: "flux", credit_cost: 10, is_enabled: true, tier_restriction: null },
    ]

    const chain = supabaseChain({ data: models, error: null })
    mockFrom.mockReturnValue(chain)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/models",
      headers: { "x-user-id": ADMIN_UUID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(2)
    expect(body[0].model_identifier).toBe("nano-banana")
    expect(body[1].model_identifier).toBe("flux")
    expect(mockFrom).toHaveBeenCalledWith("model_pricing")
  })
})

describe("PUT /v1/admin/models/:identifier/pricing", () => {
  it("updates model pricing successfully", async () => {
    const updatedModel = {
      model_identifier: "nano-banana",
      credit_cost: 6,
      is_enabled: true,
      tier_restriction: null,
    }

    const chain = supabaseChain({ data: updatedModel, error: null })
    mockFrom.mockReturnValue(chain)

    const res = await app.inject({
      method: "PUT",
      url: "/v1/admin/models/nano-banana/pricing",
      headers: { "x-user-id": ADMIN_UUID },
      payload: { creditCost: 6, isEnabled: true },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.credit_cost).toBe(6)
    expect(body.model_identifier).toBe("nano-banana")
    expect(mockFrom).toHaveBeenCalledWith("model_pricing")
  })
})
