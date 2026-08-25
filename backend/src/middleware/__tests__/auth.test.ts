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
      update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST116" },
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
      }),
      then: vi.fn(),
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
  // B2 billing surface (public — deployment config, no per-user data) + account (authed)
  app.get("/v1/billing/surface", async () => ({ data: { providerId: "none" } }))
  app.get("/v1/billing/account", async () => ({ data: null }))

  // Protected routes
  app.get("/v1/jobs/123", async () => ({ data: {} }))
  // Echoes the auth outcome for the internal-header tests below.
  app.get("/v1/echo-user", async (req) => ({ userId: req.userId ?? null, internal: req.isInternalCall ?? false }))
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

    it("allows GET /v1/invitations/by-token/<token> without a token — the invitee is signed out", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/invitations/by-token/abcdef" })
      expect(res.statusCode).not.toBe(401)
    })

    it("keeps the rest of /v1/invitations authenticated (revoke / resend / accept)", async () => {
      expect((await app.inject({ method: "DELETE", url: "/v1/invitations/abcdef" })).statusCode).toBe(401)
      expect((await app.inject({ method: "POST", url: "/v1/invitations/abcdef/resend" })).statusCode).toBe(401)
      expect((await app.inject({ method: "POST", url: "/v1/invitations/abcdef/accept" })).statusCode).toBe(401)
    })

    it("allows GET /v1/billing/surface without a token (deployment config, no per-user data)", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/billing/surface" })
      expect(res.statusCode).not.toBe(401)
    })

    it("keeps GET /v1/billing/account authenticated (per-user data)", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/billing/account" })
      expect(res.statusCode).toBe(401)
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

  describe("OAuth access token path", () => {
    it("returns 401 when ndr_app_ token doesn't resolve to a row", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/jobs/123",
        headers: { authorization: "Bearer ndr_app_invalidtokenxxxxxx" },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe("unauthorized")
    })
  })

  describe("internal x-internal-user-id header (bodyless methods)", () => {
    const secret = process.env.INTERNAL_ORCHESTRATOR_SECRET as string

    it("sets req.userId from the header on an internal GET", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/echo-user",
        headers: {
          "x-internal-orchestrator-secret": secret,
          "x-internal-user-id": "user-from-header",
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ userId: "user-from-header", internal: true })
    })

    it("the header alone grants NOTHING — without the secret it is not even read", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/echo-user",
        headers: { "x-internal-user-id": "user-from-header" },
      })
      expect(res.statusCode).toBe(401)
    })

    it("body.userId wins over the header when both are present", async () => {
      const app2 = Fastify({ logger: false })
      registerAuthHook(app2)
      app2.post("/v1/echo-user", async (req) => ({ userId: req.userId ?? null }))
      const res = await app2.inject({
        method: "POST",
        url: "/v1/echo-user",
        headers: {
          "x-internal-orchestrator-secret": secret,
          "x-internal-user-id": "header-user",
        },
        payload: { userId: "body-user" },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ userId: "body-user" })
      await app2.close()
    })
  })
})
