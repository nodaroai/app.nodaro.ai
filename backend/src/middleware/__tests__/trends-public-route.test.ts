/**
 * The published Trends catalog is public: a guest sees the catalog, its tags
 * and every trend's page, and is asked to sign in only to run one. Exactly
 * three GETs take no credential — `/v1/trends`, `/v1/trends/tags` and
 * `/v1/trends/:slug` (one slug segment, never `runs`); the caller's runs,
 * estimate, run and favorite stay behind one. Pinned three ways: the matcher,
 * the OpenAPI lens (`isAnonymousRoute`), and the real hook in front of the
 * real routes, with the real rate limiter keyed on who the hook resolved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import rateLimit from "@fastify/rate-limit"

const GOOD_TOKEN = "good-session-token"
const USER = "00000000-0000-4000-8000-0000000000u1"

vi.mock("@/lib/supabase.js", () => {
  // Every table read answers nothing (no role, no preferred locale, no favorite).
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "then"
          ? (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
          : () => chain,
    },
  )
  return {
    supabase: {
      from: vi.fn(() => chain),
      auth: {
        getUser: vi.fn(async (token: string) =>
          token === GOOD_TOKEN
            ? { data: { user: { id: USER, app_metadata: {} } }, error: null }
            : { data: { user: null }, error: new Error("Invalid token") },
        ),
      },
    },
  }
})
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/ee/lib/trends/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ee/lib/trends/store.js")>()),
  getTrendBySlug: vi.fn().mockResolvedValue(null),
  getVersion: vi.fn().mockResolvedValue(null),
  listPublished: vi.fn().mockResolvedValue({ rows: [], next: null }),
  favoriteIds: vi.fn().mockResolvedValue(new Set()),
  setFavorite: vi.fn(),
}))
vi.mock("@/ee/lib/trends/tags.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ee/lib/trends/tags.js")>()),
  publishedTagUsage: vi.fn().mockResolvedValue([]),
  readTagLabels: vi.fn().mockResolvedValue(new Map()),
}))

import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute, registerAuthHook } from "../auth.js"
import { trendRoutes } from "../../ee/routes/trends.js"
import { favoriteIds, listPublished, setFavorite } from "../../ee/lib/trends/store.js"

describe("the public-route matcher", () => {
  it("the catalog, its tags and a trend's page take no credential, with or without a query", () => {
    for (const url of [
      "/v1/trends",
      "/v1/trends?q=dance&tag=duo&limit=20",
      "/v1/trends/tags",
      "/v1/trends/tags?locale=he",
      "/v1/trends/neon-dance",
      "/v1/trends/neon-dance?locale=he",
      "/v1/trends/x",
      "/v1/trends/2024-dance-off",
      // The OpenAPI lens stands a `{slug}` template in as a literal segment.
      "/v1/trends/" + "a".repeat(64),
    ]) {
      expect(isPublicRoute("GET", url), url).toBe(true)
      expect(isAnonymousRoute("GET", url), url).toBe(true)
    }
  })

  it("the caller's runs, estimate, run and favorite stay private, and so does every other shape", () => {
    for (const url of [
      "/v1/trends/runs",
      "/v1/trends/runs?trend=neon-dance",
      "/v1/trends/runs/00000000-0000-4000-8000-0000000000j1",
      "/v1/trends/neon-dance/estimate",
      "/v1/trends/neon-dance/runs",
      "/v1/trends/neon-dance/favorite",
      "/v1/trends/",
      "/v1/trends/neon-dance/",
      "/v1/trendsX",
      "/v1/trends/Neon-Dance",
      "/v1/trends/-dance",
      "/v1/trends/" + "a".repeat(65),
      "/v1/trends/neon%2Fdance",
      "/v1/trends/..",
    ]) {
      expect(isPublicRoute("GET", url), url).toBe(false)
      expect(isAnonymousRoute("GET", url), url).toBe(false)
    }
  })

  it("GET only", () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"]) {
      expect(isPublicRoute(method, "/v1/trends"), method).toBe(false)
      expect(isPublicRoute(method, "/v1/trends/tags"), method).toBe(false)
      expect(isPublicRoute(method, "/v1/trends/neon-dance"), method).toBe(false)
    }
    expect(isPublicRoute("POST", "/v1/trends/neon-dance/runs")).toBe(false)
    expect(isPublicRoute("PUT", "/v1/trends/neon-dance/favorite")).toBe(false)
  })
})

describe("the auth hook and the rate limiter in front of the routes", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify({ logger: false })
    // As app.ts's `rateLimitKeyGenerator` keys a request (by its raw bearer when it sends one), so a
    // route that kept that key would give each made-up bearer its own bucket and fail below.
    await app.register(rateLimit, {
      global: false,
      keyGenerator: (req) => (req.headers.authorization ? `cred:${req.headers.authorization}` : req.ip),
    })
    registerAuthHook(app)
    await app.register(trendRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it("serves the catalog, its tags and a missing page's 404 to a request with no credential", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/trends" })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toEqual({ data: [], next: null })
    expect(listPublished).toHaveBeenCalledWith({ limit: 30 })
    expect(favoriteIds).not.toHaveBeenCalled()
    expect((await app.inject({ method: "GET", url: "/v1/trends/tags" })).statusCode).toBe(200)
    // A guest reaches the handler: an unpublished slug is its 404, not the hook's 401.
    const page = await app.inject({ method: "GET", url: "/v1/trends/neon-dance" })
    expect(page.statusCode).toBe(404)
    expect(page.json().error.code).toBe("not_found")
  })

  it("an invalid bearer reads as a guest; a valid one as its account", async () => {
    const stale = await app.inject({ method: "GET", url: "/v1/trends", headers: { authorization: "Bearer expired" } })
    expect(stale.statusCode).toBe(200)
    expect(stale.headers["cache-control"]).toBe("public, max-age=60")
    const own = await app.inject({ method: "GET", url: "/v1/trends", headers: { authorization: `Bearer ${GOOD_TOKEN}` } })
    expect(own.statusCode).toBe(200)
    expect(own.headers["cache-control"]).toBe("private, no-store")
    expect(favoriteIds).toHaveBeenCalledWith(USER, [])
  })

  it("refuses the rest without a credential, before the store or the engine is reached", async () => {
    for (const c of [
      { method: "GET", url: "/v1/trends/runs" },
      { method: "GET", url: "/v1/trends/runs/00000000-0000-4000-8000-0000000000j1" },
      { method: "GET", url: "/v1/trends?favorites=1" },
      { method: "POST", url: "/v1/trends/neon-dance/estimate", payload: {} },
      { method: "POST", url: "/v1/trends/neon-dance/runs", payload: {} },
      { method: "PUT", url: "/v1/trends/neon-dance/favorite" },
      { method: "DELETE", url: "/v1/trends/neon-dance/favorite" },
    ] as const) {
      const res = await app.inject(c)
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(401)
    }
    expect(listPublished).not.toHaveBeenCalled()
    expect(setFavorite).not.toHaveBeenCalled()
  })

  it("limits a guest per address; a made-up bearer is still that address, an account has its own bucket", async () => {
    for (let i = 0; i < 60; i++) {
      const res = await app.inject({ method: "GET", url: "/v1/trends" })
      expect(res.statusCode, `request ${i + 1}`).toBe(200)
    }
    expect((await app.inject({ method: "GET", url: "/v1/trends" })).statusCode).toBe(429)
    const madeUp = await app.inject({ method: "GET", url: "/v1/trends", headers: { authorization: "Bearer made-up-1" } })
    expect(madeUp.statusCode).toBe(429)
    const own = await app.inject({ method: "GET", url: "/v1/trends", headers: { authorization: `Bearer ${GOOD_TOKEN}` } })
    expect(own.statusCode).toBe(200)
    // Each read has its own bucket.
    expect((await app.inject({ method: "GET", url: "/v1/trends/tags" })).statusCode).toBe(200)
  })
})
