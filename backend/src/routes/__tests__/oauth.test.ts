import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the route module
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
  },
}))

vi.mock("@/lib/oauth-codes.js", () => ({
  issueCode: vi.fn(),
  redeemCode: vi.fn(),
}))

vi.mock("@/routes/developer-apps.js", () => ({
  findAppByClientId: vi.fn(),
  verifyClientSecret: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { oauthRoutes } from "../oauth.js"
import { findAppByClientId } from "../developer-apps.js"

// ---------------------------------------------------------------------------
// Setup — minimal Fastify app, no CORS or real auth, mirrors developer-apps.test.ts
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — userId is set only when an X-User-Id header is present.
  // Tests that omit the header simulate an unauthenticated request.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
    }
  })

  await app.register(oauthRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("oauth routes", () => {
  it("POST /v1/oauth/authorize returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/authorize",
      payload: {
        clientId: "app_test",
        redirectUri: "https://example.com/cb",
        scopes: ["workflows:read"],
      },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("POST /v1/oauth/authorize returns 400 on invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/authorize",
      headers: { "x-user-id": "user-1" },
      payload: { clientId: "" }, // missing redirectUri, scopes
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("POST /v1/oauth/token returns 400 on invalid body (no auth required)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/token",
      payload: { grant_type: "authorization_code" }, // missing client_id, etc.
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("invalid_request")
  })

  it("POST /v1/oauth/revoke returns 400 on invalid body (no auth required)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/revoke",
      payload: {}, // missing token
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe("invalid_request")
  })

  it("POST /v1/oauth/token returns 401 invalid_client when app not found", async () => {
    vi.mocked(findAppByClientId).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/token",
      payload: {
        grant_type: "authorization_code",
        client_id: "app_unknown",
        client_secret: "sec_xyz",
        code: "ndr_code_abc",
        redirect_uri: "https://example.com/cb",
      },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe("invalid_client")
  })
})
