import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

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

  it("POST /v1/oauth/authorize returns 403 for an OAuth app token (consent cannot be self-granted → no scope-escalation)", async () => {
    const a = Fastify({ logger: false })
    a.addHook("preHandler", async (req: FastifyRequest) => {
      req.userId = "victim-1"
      req.appAuthorization = { appId: "evil", authorizationId: "z", scopes: ["jobs:read"] }
    })
    await a.register(oauthRoutes)
    await a.ready()
    const res = await a.inject({
      method: "POST",
      url: "/v1/oauth/authorize",
      payload: { clientId: "app_evil", redirectUri: "https://e.com/cb", scopes: ["workflows:execute", "assets:write"] },
    })
    expect(res.statusCode).toBe(403)
    await a.close()
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

  it("GET /v1/oauth/app-info returns 400 when client_id query param is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/oauth/app-info" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("GET /v1/oauth/app-info returns 404 when app doesn't exist", async () => {
    vi.mocked(findAppByClientId).mockResolvedValueOnce(null)
    const res = await app.inject({ method: "GET", url: "/v1/oauth/app-info?client_id=app_nonexistent" })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("GET /v1/oauth/app-info returns kind=dynamic_mcp for a DCR-registered app", async () => {
    vi.mocked(findAppByClientId).mockResolvedValueOnce({
      id: "app_dyn_1",
      owner_user_id: null,
      client_id: "app_dyn_1",
      client_secret_hash: "hash",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      allowed_origins: ["https://claude.ai"],
      scopes_requested: ["workflows:read"],
      status: "active",
      name: "Claude",
      description: null,
      logo_url: null,
      homepage_url: null,
      kind: "dynamic_mcp",
    } as unknown as Awaited<ReturnType<typeof findAppByClientId>>)
    const res = await app.inject({ method: "GET", url: "/v1/oauth/app-info?client_id=app_dyn_1" })
    expect(res.statusCode).toBe(200)
    expect(res.json().kind).toBe("dynamic_mcp")
    expect(res.json().name).toBe("Claude")
  })

  it("GET /v1/oauth/app-info returns kind=user as fallback when column is missing", async () => {
    vi.mocked(findAppByClientId).mockResolvedValueOnce({
      id: "app_legacy",
      owner_user_id: "user-1",
      client_id: "app_legacy",
      client_secret_hash: "hash",
      redirect_uris: ["https://example.com/cb"],
      allowed_origins: ["https://example.com"],
      scopes_requested: ["workflows:read"],
      status: "active",
      name: "Legacy App",
      description: null,
      logo_url: null,
      homepage_url: null,
      // kind intentionally omitted
    } as unknown as Awaited<ReturnType<typeof findAppByClientId>>)
    const res = await app.inject({ method: "GET", url: "/v1/oauth/app-info?client_id=app_legacy" })
    expect(res.statusCode).toBe(200)
    expect(res.json().kind).toBe("user")
  })
})
