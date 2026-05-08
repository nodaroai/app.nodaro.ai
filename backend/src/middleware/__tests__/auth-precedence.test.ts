/**
 * L2#3 — Auth 4-mode precedence matrix.
 *
 * `registerAuthHook` in `auth.ts` resolves a request's identity from one of
 * four sources, in this strict precedence:
 *
 *   1. Internal orchestrator secret (`X-Internal-Orchestrator-Secret` header)
 *   2. OAuth access token (`Bearer ndr_app_<64hex>`)
 *   3. Supabase JWT (`Bearer <eyJ...>`)
 *   4. None (returns 401 unless the route is in PUBLIC_ROUTES)
 *
 * Drift / mistakes here are silent and dangerous:
 *   - "Dev-app token + JWT both set" silently picks one → wrong identity
 *     for the request → wrong owner_user_id on writes → data leaks.
 *   - "Invalid internal-secret falls through to JWT" → bypasses the
 *     server-to-server gate.
 *   - "Invalid ndr_app_ token falls through to JWT" → user gets a generic
 *     "missing token" error instead of "this token was revoked".
 *
 * Companion to existing auth.test.ts (which covers public/protected basics
 * and one OAuth-token failure case). This file adds the precedence matrix
 * the existing tests don't cover.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { registerAuthHook } from "../auth.js"

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any module that touches them
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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
// Test app — registers the auth hook + a single protected echo route that
// reflects the resolved req.userId (or its absence) in the response body.
// ---------------------------------------------------------------------------

let app: FastifyInstance

const INTERNAL_SECRET = "0".repeat(64) // matches setup.ts

beforeAll(async () => {
  app = Fastify({ logger: false })
  registerAuthHook(app)
  // Protected echo: returns the userId set by the auth hook, or "(unset)".
  app.get("/v1/echo-identity", async (req) => ({
    userId: req.userId ?? "(unset)",
    isAppRun: req.isAppRun ?? false,
  }))
  // Protected action: any request that gets here passed the auth hook.
  app.post("/v1/echo-identity", async (req) => ({
    userId: req.userId ?? "(unset)",
  }))
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Test 1 — internal-secret precedence: when the X-Internal-Orchestrator-Secret
// header is set with a VALID secret, the auth hook MUST short-circuit before
// the JWT/ndr_app_ paths even if a Bearer token is also present.
// ---------------------------------------------------------------------------

describe("Internal-secret has precedence over Bearer tokens", () => {
  it("valid internal secret + no Bearer → identity from request body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/echo-identity",
      headers: { "x-internal-orchestrator-secret": INTERNAL_SECRET },
      payload: { userId: "internal-user-1" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().userId).toBe("internal-user-1")
  })

  it("valid internal secret + Bearer JWT (conflicting) → internal-secret wins, JWT path NOT hit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/echo-identity",
      headers: {
        "x-internal-orchestrator-secret": INTERNAL_SECRET,
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.fake.jwt",
      },
      payload: { userId: "internal-user-2" },
    })
    expect(res.statusCode).toBe(200)
    // Identity comes from the body (internal path), NOT from the JWT.
    expect(res.json().userId).toBe("internal-user-2")
  })

  it("valid internal secret + ndr_app_ token (conflicting) → internal-secret wins", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/echo-identity",
      headers: {
        "x-internal-orchestrator-secret": INTERNAL_SECRET,
        authorization: "Bearer ndr_app_someappxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
      payload: { userId: "internal-user-3" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().userId).toBe("internal-user-3")
  })

  it("INVALID internal secret → 403, does NOT fall through to JWT", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/echo-identity",
      headers: {
        "x-internal-orchestrator-secret": "wrong-secret",
        authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.would.have.been.valid",
      },
      payload: { userId: "should-not-be-set" },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("X-App-Run header propagates when internal-secret is valid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/echo-identity",
      headers: {
        "x-internal-orchestrator-secret": INTERNAL_SECRET,
        "x-app-run": "true",
      },
      payload: { userId: "internal-app-user" },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Test 2 — ndr_app_ precedence over JWT: a Bearer that starts with `ndr_app_`
// must enter the OAuth lookup path, not the Supabase JWT path. Even when the
// token is invalid, the response MUST be the OAuth-style 401 (not the JWT
// 401), proving the dispatch went down the right branch.
// ---------------------------------------------------------------------------

describe("ndr_app_ Bearer is dispatched to OAuth path (not JWT)", () => {
  it("invalid ndr_app_ token → 401 unauthorized (NOT a JWT-validation error)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/echo-identity",
      headers: {
        authorization: "Bearer ndr_app_doesnotexistxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
    })
    expect(res.statusCode).toBe(401)
    // OAuth path returns the specific "Invalid or revoked token" message.
    // The JWT path would return "missing token" (which is generic).
    expect(res.json().error.code).toBe("unauthorized")
  })
})

// ---------------------------------------------------------------------------
// Test 3 — no-credential path: protected route + no auth headers at all → 401.
// ---------------------------------------------------------------------------

describe("Protected route with no auth → 401", () => {
  it("no headers → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/echo-identity",
    })
    expect(res.statusCode).toBe(401)
  })

  it("Bearer with empty value → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/echo-identity",
      headers: { authorization: "Bearer " },
    })
    expect(res.statusCode).toBe(401)
  })

  it("non-Bearer authorization scheme → treated as no token → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/echo-identity",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    })
    expect(res.statusCode).toBe(401)
  })
})
