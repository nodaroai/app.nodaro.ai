import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerAuthHook } from "../auth.js"

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any import that touches these modules
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST116" },
      }),
    })),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: new Error("Invalid token"),
      }),
    },
  },
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  registerAuthHook(app)

  // Public routes
  app.get("/health", async () => ({ status: "ok" }))
  app.get("/v1/gallery", async () => ({ data: [] }))
  app.get("/v1/download/test", async () => ({ ok: true }))
  app.post("/v1/billing/stripe-webhook", async () => ({ ok: true }))

  // Protected routes
  app.get("/v1/jobs/123", async () => ({ data: {} }))
  app.post("/v1/generate-image", async () => ({ jobId: "test" }))

  await app.ready()
})

afterAll(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auth middleware", () => {
  describe("public routes", () => {
    it("allows GET /health without a token", async () => {
      const res = await app.inject({ method: "GET", url: "/health" })
      expect(res.statusCode).toBe(200)
    })

    it("allows GET /v1/gallery without a token (GET method match)", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/gallery" })
      expect(res.statusCode).not.toBe(401)
    })

    it("allows GET /v1/download/xyz without a token (prefix match)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/download/xyz",
      })
      expect(res.statusCode).not.toBe(401)
    })

    it("allows POST /v1/billing/stripe-webhook without a token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/billing/stripe-webhook",
        payload: {},
      })
      expect(res.statusCode).not.toBe(401)
    })
  })

  describe("protected routes", () => {
    it("returns 401 for GET /v1/jobs/123 without a token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/jobs/123" })
      expect(res.statusCode).toBe(401)
    })

    it("returns 401 for POST /v1/generate-image without a token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-image",
        payload: { prompt: "test" },
      })
      expect(res.statusCode).toBe(401)
    })

    it("returns 401 for a protected route with an invalid Bearer token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/jobs/123",
        headers: { authorization: "Bearer invalid-token-abc" },
      })
      expect(res.statusCode).toBe(401)
    })
  })
})
