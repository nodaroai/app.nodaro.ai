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

vi.mock("@/lib/admin-check.js", () => ({
  checkIsAdmin: vi.fn(async () => false),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { developerAppRoutes } from "../developer-apps.js"
import { supabase } from "@/lib/supabase.js"
import { checkIsAdmin } from "@/lib/admin-check.js"

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

// The per-user cap counts only hand-registered apps (kind = "user"). MCP
// clients that register themselves land in the same table under the same
// owner; once they were counted too, five Claude connections filled the cap
// and the owner could not register a real app. Admins are not capped, and
// that is decided by the profile role (checkIsAdmin), not by req.userRole,
// so it holds for API tokens too.
describe("developer-apps registration cap", () => {
  const USER = "00000000-0000-4000-8000-000000000002"
  const payload = { name: "Nodaro for Figma", redirectUris: ["https://app.nodaro.ai/v1/oauth/plugin/callback"], scopesRequested: ["jobs:read"] }

  // Records every .eq() the count query applies, and answers the count with
  // `count`; the insert (only reached when the cap allows) answers `inserted`.
  function mockTable(count: number, inserted: Record<string, unknown> | null, countError: Error | null = null) {
    const eqCalls: Array<[string, unknown]> = []
    const countChain = {
      eq: vi.fn((col: string, val: unknown) => {
        eqCalls.push([col, val])
        return countChain
      }),
      then: (resolve: (v: { count: number | null; error: Error | null }) => void) =>
        resolve(countError ? { count: null, error: countError } : { count, error: null }),
    }
    const select = vi.fn(() => countChain)
    const insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: inserted, error: inserted ? null : new Error("no insert") }) }),
    }))
    vi.mocked(supabase.from).mockImplementation((() => ({ select, insert })) as never)
    return { eqCalls, select, insert }
  }

  async function appAs(admin: boolean): Promise<FastifyInstance> {
    vi.mocked(checkIsAdmin).mockResolvedValue(admin)
    const a = Fastify({ logger: false })
    a.addHook("preHandler", async (req: FastifyRequest) => {
      req.userId = USER
    })
    await a.register(developerAppRoutes)
    await a.ready()
    return a
  }

  const insertedRow = {
    id: "00000000-0000-4000-8000-0000000000aa",
    name: "Nodaro for Figma",
    redirect_uris: payload.redirectUris,
    scopes_requested: payload.scopesRequested,
    client_id: "app_x",
    status: "active",
    kind: "user",
  }

  it("counts only kind = user, so self-registered MCP clients never fill the cap", async () => {
    const { eqCalls, select, insert } = mockTable(0, insertedRow)
    const a = await appAs(false)
    const res = await a.inject({ method: "POST", url: "/v1/developer-apps", payload })
    expect(res.statusCode).toBe(201)
    expect(select).toHaveBeenCalledWith("id", { count: "exact", head: true })
    expect(eqCalls).toContainEqual(["owner_user_id", USER])
    expect(eqCalls).toContainEqual(["kind", "user"])
    expect(insert).toHaveBeenCalledTimes(1)
    expect(res.json().data.kind).toBe("user")
    await a.close()
  })

  it("refuses the sixth hand-registered app for a regular user", async () => {
    const { insert } = mockTable(5, insertedRow)
    const a = await appAs(false)
    const res = await a.inject({ method: "POST", url: "/v1/developer-apps", payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("limit_reached")
    expect(insert).not.toHaveBeenCalled()
    await a.close()
  })

  it("fails closed when the count itself fails — a DB error must not switch the cap off", async () => {
    const { insert } = mockTable(0, insertedRow, new Error("relation is on fire"))
    const a = await appAs(false)
    const res = await a.inject({ method: "POST", url: "/v1/developer-apps", payload })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain("on fire")
    expect(insert).not.toHaveBeenCalled()
    await a.close()
  })

  it("does not cap an admin — the count is never asked", async () => {
    const { select, insert } = mockTable(5, insertedRow)
    const a = await appAs(true)
    const res = await a.inject({ method: "POST", url: "/v1/developer-apps", payload })
    expect(res.statusCode).toBe(201)
    expect(checkIsAdmin).toHaveBeenCalledWith(USER)
    expect(select).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
    await a.close()
  })
})
