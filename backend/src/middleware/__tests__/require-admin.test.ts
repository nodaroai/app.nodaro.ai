import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any import that touches these modules
// ---------------------------------------------------------------------------

const { mockCheckIsAdmin } = vi.hoisted(() => ({
  mockCheckIsAdmin: vi.fn<(userId: string) => Promise<boolean>>(),
}))

vi.mock("@/lib/admin-check.js", () => ({
  checkIsAdmin: mockCheckIsAdmin,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks are declared)
// ---------------------------------------------------------------------------

import { requireAdmin } from "../require-admin.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Pre-hook sets req.userId from query param to simulate auth bypass
  app.addHook("preHandler", async (req) => {
    const query = req.query as Record<string, string>
    if (query.userId) {
      req.userId = query.userId
    }
  })

  app.get("/test", { preHandler: requireAdmin }, async () => ({ ok: true }))

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requireAdmin middleware", () => {
  it("returns 401 when no userId is set on the request", async () => {
    const res = await app.inject({ method: "GET", url: "/test" })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({
      error: { code: "unauthorized", message: "Authentication required" },
    })
  })

  it("returns 403 when checkIsAdmin returns false", async () => {
    mockCheckIsAdmin.mockResolvedValue(false)

    const res = await app.inject({ method: "GET", url: "/test?userId=user-1" })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({
      error: { code: "forbidden", message: "Admin access required" },
    })
  })

  it("passes through with 200 when checkIsAdmin returns true", async () => {
    mockCheckIsAdmin.mockResolvedValue(true)

    const res = await app.inject({ method: "GET", url: "/test?userId=admin-1" })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it("calls checkIsAdmin with the correct userId", async () => {
    mockCheckIsAdmin.mockResolvedValue(true)

    await app.inject({ method: "GET", url: "/test?userId=specific-user-42" })

    expect(mockCheckIsAdmin).toHaveBeenCalledOnce()
    expect(mockCheckIsAdmin).toHaveBeenCalledWith("specific-user-42")
  })
})
