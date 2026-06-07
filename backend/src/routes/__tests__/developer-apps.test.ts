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

vi.mock("@/lib/dynamic-origins.js", () => ({
  invalidateDynamicOriginsCache: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { developerAppRoutes } from "../developer-apps.js"

// ---------------------------------------------------------------------------
// Setup — minimal Fastify app, no CORS or real auth, mirrors api-tokens.test.ts
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

  await app.register(developerAppRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("developer-apps auth gating", () => {
  it("POST /v1/developer-apps returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/developer-apps",
      payload: { name: "Test", redirectUris: ["https://example.com/cb"], scopesRequested: ["workflows:read"] },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("GET /v1/developer-apps returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/developer-apps" })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("GET /v1/developer-apps/:id returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/developer-apps/00000000-0000-0000-0000-000000000000",
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("PATCH /v1/developer-apps/:id returns 401 without auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/developer-apps/00000000-0000-0000-0000-000000000000",
      payload: { name: "x" },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("DELETE /v1/developer-apps/:id returns 401 without auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/developer-apps/00000000-0000-0000-0000-000000000000",
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("POST /v1/developer-apps/:id/rotate-secret returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/developer-apps/00000000-0000-0000-0000-000000000000/rotate-secret",
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })
})

// App management is first-party / SDK only — an OAuth app token (any scope) must
// not create/rotate/delete the owner's developer apps (privilege escalation).
describe("developer-apps rejects OAuth app tokens", () => {
  const USER = "00000000-0000-4000-8000-000000000001"
  const ID = "00000000-0000-4000-8000-000000000099"

  async function appWithOAuth(): Promise<FastifyInstance> {
    const a = Fastify({ logger: false })
    a.addHook("preHandler", async (req: FastifyRequest) => {
      req.userId = USER
      req.appAuthorization = { appId: "x", authorizationId: "z", scopes: ["workflows:read"] }
    })
    await a.register(developerAppRoutes)
    await a.ready()
    return a
  }

  it("POST returns 403 (cannot forge a max-scope app under the victim)", async () => {
    const a = await appWithOAuth()
    const res = await a.inject({
      method: "POST",
      url: "/v1/developer-apps",
      payload: { name: "evil", redirectUris: ["https://e.com/cb"], scopesRequested: ["workflows:read"] },
    })
    expect(res.statusCode).toBe(403)
    await a.close()
  })

  it("DELETE + rotate-secret return 403", async () => {
    const a = await appWithOAuth()
    expect((await a.inject({ method: "DELETE", url: `/v1/developer-apps/${ID}` })).statusCode).toBe(403)
    expect((await a.inject({ method: "POST", url: `/v1/developer-apps/${ID}/rotate-secret` })).statusCode).toBe(403)
    await a.close()
  })
})
