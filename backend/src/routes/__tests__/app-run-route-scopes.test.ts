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
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({}) },
}))

vi.mock("@/lib/private-plugins/edit-plan-per-minute.js", () => ({
  editPlanPerMinuteActive: async () => false,
}))

import { appRunnerRoutes } from "../app-runner.js"
import { appRenderFinalRoutes } from "../app-render-final.js"
import { appRunResumeRoutes } from "../app-run-resume.js"
import { componentExecuteRoutes } from "../component-execute.js"
import { isAppRunPath, routesInSource } from "./helpers/route-source-scan.js"

/** The route plugins under test, by the file (relative to backend/src) that defines each. */
const PLUGINS: Record<string, (app: FastifyInstance) => Promise<void>> = {
  "routes/app-runner.ts": appRunnerRoutes,
  "routes/app-render-final.ts": appRenderFinalRoutes,
  "routes/app-run-resume.ts": appRunResumeRoutes,
  "routes/component-execute.ts": componentExecuteRoutes,
}

const isCoveredPath = isAppRunPath

const USER_ID = "00000000-0000-4000-8000-000000000001"
const RUN_ID = "00000000-0000-4000-8000-000000000040"

/**
 * Every covered route (`/v1/app/*`, `/v1/me/archived-runs`, `/v1/component/*`),
 * with the OAuth scopes an app token may hold for it (any one passes; `null`:
 * none). A covered route added in any file fails the totality tests below until
 * it is listed here and its file is in PLUGINS — and then has to hold the scope
 * it is listed with.
 */
const EXPECTED: Record<string, readonly string[] | null> = {
  "GET /v1/app/:slug": null,
  "POST /v1/app/:slug/run": ["workflows:execute"],
  "POST /v1/app/:slug/runs": ["workflows:execute"],
  "PATCH /v1/app/:slug/runs/:runId": ["workflows:execute"],
  "GET /v1/app/:slug/runs": ["jobs:read", "assets:read", "workflows:execute"],
  "GET /v1/app/:slug/runs/:runId": ["jobs:read", "assets:read", "workflows:execute"],
  "DELETE /v1/app/:slug/runs/:runId": ["workflows:execute"],
  "POST /v1/app/:slug/runs/:runId/restore": ["workflows:execute"],
  "DELETE /v1/app/:slug/runs/:runId/permanent": ["workflows:execute"],
  "POST /v1/app/:slug/runs/:runId/render-final": ["workflows:execute"],
  "POST /v1/app/:slug/runs/:runId/resume": ["workflows:execute"],
  "GET /v1/me/archived-runs": ["jobs:read", "assets:read", "workflows:execute"],
  "POST /v1/component/execute": ["workflows:execute"],
  // A credit estimate for a published component: no user data.
  "POST /v1/component/estimate-credits": null,
  "GET /v1/component/execute/:jobId/wait-limit": ["jobs:read"],
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

async function call(route: string, who: Caller) {
  caller = who
  const [method, path] = route.split(" ") as [string, string]
  const url = path.replace(":slug", "some-app").replace(":runId", RUN_ID).replace(":jobId", RUN_ID)
  const withBody = method === "POST" || method === "PATCH"
  const res = await app.inject({
    method: method as "GET" | "POST" | "PATCH" | "DELETE",
    url,
    ...(withBody ? { payload: {} } : {}),
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

describe("app-run and component routes — OAuth scopes", () => {
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

    it(`${route}: an app token without the scope is refused with insufficient_scope`, async () => {
      const res = await call(route, { kind: "app", scopes: ["credits:read", "apps:read", "workflows:read"] })
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

  it("GET /v1/app/:slug stays public: no scope for an app token, and anonymous visitors are not refused", async () => {
    const appToken = await call("GET /v1/app/:slug", { kind: "app", scopes: [] })
    expect(appToken.code).not.toBe("insufficient_scope")
    expect(appToken.status).not.toBe(403)
    const anonymous = await call("GET /v1/app/:slug", { kind: "anonymous" })
    expect(anonymous.status).not.toBe(401)
    expect(anonymous.status).not.toBe(403)
  })
})
