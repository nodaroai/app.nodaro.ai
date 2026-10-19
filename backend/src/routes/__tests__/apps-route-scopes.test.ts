// @test-watches backend/src/**/*.ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import. The scope check runs before any
// handler reads the database, so the database answers "nothing" to every query.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const empty = { data: null, error: null, count: 0 }
  const chain: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(empty)
      return chain
    },
    apply() {
      return chain
    },
  })
  return {
    supabase: {
      from: () => chain,
      rpc: () => chain,
      storage: { from: () => chain },
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  }
})

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
  hasOrganizations: () => false,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { appAnalyticsRoutes } from "../app-analytics.js"
import { monetizationRoutes } from "../../ee/routes/monetization.js"
import { isAppManagementPath, routesInSource } from "./helpers/route-source-scan.js"

/** The route plugins under test, by the file (relative to backend/src) that defines each. */
const PLUGINS: Record<string, (app: FastifyInstance) => Promise<void>> = {
  "routes/published-apps.ts": publishedAppsRoutes,
  "routes/app-analytics.ts": appAnalyticsRoutes,
  "ee/routes/monetization.ts": monetizationRoutes,
}

const isCoveredPath = isAppManagementPath

const USER_ID = "00000000-0000-4000-8000-000000000001"
const APP_ID = "00000000-0000-4000-8000-000000000010"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"

/**
 * Every covered route (`/v1/apps/*`, `/v1/user/earnings`,
 * `/v1/user/monetization-defaults`), with the OAuth scopes an app token may
 * hold for it (any one passes; `null`: none). A covered route added in any file fails the totality
 * tests below until it is listed here and its file is in PLUGINS — and then has
 * to hold the scope it is listed with.
 */
const EXPECTED: Record<string, readonly string[] | null> = {
  // Public catalog; `favoritesOnly` is held to workflows:read (tested below).
  "GET /v1/apps/browse": null,
  // The id and version of a published app: what the public app loader shows.
  "GET /v1/apps/by-slug/:slug/latest-version": null,
  "POST /v1/apps/favorite": ["workflows:write"],
  "GET /v1/apps/favorites": ["workflows:read", "apps:read"],
  "POST /v1/apps/publish": ["workflows:write"],
  "GET /v1/apps/mine": ["workflows:read", "apps:read"],
  "GET /v1/apps/by-workflow/:workflowId": ["workflows:read", "apps:read"],
  "PATCH /v1/apps/:appId": ["workflows:write"],
  "DELETE /v1/apps/:appId": ["workflows:write"],
  "POST /v1/apps/:appId/restore": ["workflows:write"],
  "GET /v1/apps/:appId/analytics": ["workflows:read"],
  "GET /v1/apps/:appId/analytics/runs": ["workflows:read"],
  "GET /v1/apps/:appId/earnings": ["workflows:read"],
  "GET /v1/user/earnings": ["workflows:read"],
  "GET /v1/user/monetization-defaults": ["workflows:read"],
  "PUT /v1/user/monetization-defaults": ["workflows:write"],
}


type Caller =
  | { kind: "app"; scopes: string[] }
  | { kind: "api-token" }
  | { kind: "session" }
  | { kind: "anonymous" }

let caller: Caller = { kind: "anonymous" }
let app: FastifyInstance
const registered: string[] = []

beforeAll(async () => {
  app = Fastify()
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const m of methods) {
      if (m === "HEAD" || !isCoveredPath(route.url)) continue
      registered.push(`${m} ${route.url}`)
    }
  })
  // Stands in for the auth hook: what it leaves on the request per credential kind.
  app.addHook("preHandler", async (req) => {
    const r = req as unknown as Record<string, unknown>
    if (caller.kind === "anonymous") return
    r.userId = USER_ID
    if (caller.kind === "app") {
      r.authKind = "app_token"
      r.appAuthorization = { appId: "app-1", authorizationId: "auth-1", scopes: caller.scopes }
    } else if (caller.kind === "api-token") {
      r.authKind = "api_token"
      r.apiToken = { id: "tok-1", userId: USER_ID }
    } else {
      r.authKind = "jwt"
    }
  })
  for (const plugin of Object.values(PLUGINS)) await app.register(plugin)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

async function call(route: string, who: Caller, query = "") {
  caller = who
  const [method, path] = route.split(" ") as [string, string]
  const url =
    path
      .replace(":slug", "some-app")
      .replace(":appId", APP_ID)
      .replace(":workflowId", WORKFLOW_ID) + query
  const withBody = method === "POST" || method === "PATCH"
  const res = await app.inject({
    method: method as "GET" | "POST" | "PATCH" | "DELETE",
    url,
    ...(withBody ? { payload: { appId: APP_ID } } : {}),
  })
  let code: string | undefined
  let missingScope: string | undefined
  try {
    const body = res.json() as { error?: { code?: string; missingScope?: string } }
    code = body.error?.code
    missingScope = body.error?.missingScope
  } catch {
    // not JSON — not a scope refusal
  }
  return { status: res.statusCode, code, missingScope }
}

const UNRELATED = ["credits:read", "apps:read", "jobs:read", "assets:read", "assets:write", "workflows:execute"]

describe("/v1/apps and monetization routes — OAuth scopes", () => {
  it("every registered route is listed with its scope", () => {
    expect([...registered].sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it("every covered route in backend/src is listed, and every file defining one is registered here", () => {
    const { routes, files } = routesInSource(isCoveredPath)
    expect([...routes].sort()).toEqual(Object.keys(EXPECTED).sort())
    expect([...files].sort()).toEqual(Object.keys(PLUGINS).sort())
  })

  for (const [route, scopes] of Object.entries(EXPECTED)) {
    if (!scopes) {
      it(`${route}: an app token is not scope-checked`, async () => {
        const res = await call(route, { kind: "app", scopes: [] })
        expect(res.code).not.toBe("insufficient_scope")
      })
      continue
    }

    it(`${route}: an app token without ${scopes.join(" or ")} is refused with insufficient_scope`, async () => {
      const res = await call(route, { kind: "app", scopes: UNRELATED.filter((s) => !scopes.includes(s)) })
      expect(res.status).toBe(403)
      expect(res.code).toBe("insufficient_scope")
      expect(res.missingScope).toBe(scopes[0])
    })

    for (const scope of scopes) {
      it(`${route}: an app token with ${scope} passes the scope check`, async () => {
        const res = await call(route, { kind: "app", scopes: [scope] })
        expect(res.code).not.toBe("insufficient_scope")
      })
    }

    it(`${route}: session and personal API token callers are not scope-checked`, async () => {
      for (const who of [{ kind: "session" }, { kind: "api-token" }] as const) {
        const res = await call(route, who)
        expect(res.code, who.kind).not.toBe("insufficient_scope")
      }
    })

    it(`${route}: an anonymous caller still gets 401`, async () => {
      const res = await call(route, { kind: "anonymous" })
      expect(res.status).toBe(401)
    })
  }

  describe("GET /v1/apps/browse", () => {
    it("the catalog stays public: anonymous visitors and any app token are not refused", async () => {
      const anonymous = await call("GET /v1/apps/browse", { kind: "anonymous" })
      expect(anonymous.status).not.toBe(401)
      expect(anonymous.status).not.toBe(403)
      const appToken = await call("GET /v1/apps/browse", { kind: "app", scopes: [] })
      expect(appToken.code).not.toBe("insufficient_scope")
    })

    it("favoritesOnly needs workflows:read or apps:read from an app token", async () => {
      const without = await call("GET /v1/apps/browse", { kind: "app", scopes: UNRELATED.filter((s) => s !== "apps:read") }, "?favoritesOnly=true")
      expect(without.status).toBe(403)
      expect(without.code).toBe("insufficient_scope")
      expect(without.missingScope).toBe("workflows:read")
      for (const scope of ["workflows:read", "apps:read"]) {
        const withScope = await call("GET /v1/apps/browse", { kind: "app", scopes: [scope] }, "?favoritesOnly=true")
        expect(withScope.code, scope).not.toBe("insufficient_scope")
      }
    })

    it("favoritesOnly is not scope-checked for session and personal API token callers", async () => {
      for (const who of [{ kind: "session" }, { kind: "api-token" }] as const) {
        const res = await call("GET /v1/apps/browse", who, "?favoritesOnly=true")
        expect(res.code, who.kind).not.toBe("insufficient_scope")
      }
    })
  })
})
