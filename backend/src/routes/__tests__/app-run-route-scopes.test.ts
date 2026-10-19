// @test-watches backend/src/**/*.ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, sep } from "node:path"

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

/** The route plugins under test, by the file (relative to backend/src) that defines each. */
const PLUGINS: Record<string, (app: FastifyInstance) => Promise<void>> = {
  "routes/app-runner.ts": appRunnerRoutes,
  "routes/app-render-final.ts": appRenderFinalRoutes,
  "routes/app-run-resume.ts": appRunResumeRoutes,
  "routes/component-execute.ts": componentExecuteRoutes,
}

/** The paths this test holds to a scope: running published apps and components, and reading their runs. */
function isCoveredPath(path: string): boolean {
  return (
    path.startsWith("/v1/app/") ||
    path === "/v1/me/archived-runs" ||
    path.startsWith("/v1/me/archived-runs/") ||
    path.startsWith("/v1/component/")
  )
}

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

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * Files that register routes on a computed path, which a source scan cannot
 * read, each with why none of them is a covered route. A new one fails the
 * scan until it is listed here.
 */
const DYNAMIC_ROUTE_FILES: Record<string, string> = {
  "routes/use-case-run.ts": "use-case node routes: one top-level path per use-case descriptor (`d.route`)",
  "routes/use-case-continue.ts": "use-case continue routes: one per use-case node (`usecaseContinuePath(type)`)",
}

const LITERAL = /^(["'`])((?:(?!\1)[^\\]|\\.)*)\1/

/** A route path written as a string literal, or null when it is computed. */
function literalPath(src: string): string | null {
  const m = LITERAL.exec(src)
  if (!m || (m[1] === "`" && m[2]!.includes("${"))) return null
  return m[2]!
}

/**
 * Every covered route registered anywhere in backend/src, read from the source:
 * `<x>.get("<path>", …)` (and post / put / patch / delete), and
 * `<x>.route({ method, url })` with its keys in either order. An inject or a
 * fetch is not a registration and is not read. A registration on a Fastify
 * instance (`app` / `fastify` / `instance` / `server` / `scoped`) whose path is
 * computed is reported as dynamic.
 */
function routesInSource(): { routes: string[]; files: string[]; dynamic: string[] } {
  const routes: string[] = []
  const files = new Set<string>()
  const dynamic = new Set<string>()
  const call = /\.(get|post|put|patch|delete)\(\s*/g
  const onInstance = /\b(?:app|fastify|instance|server|scoped)\.(get|post|put|patch|delete|route)\(\s*/g
  const routeObject = /\.route\(\s*\{/g
  for (const entry of readdirSync(SRC_ROOT, { recursive: true }) as string[]) {
    const rel = entry.split(sep).join("/")
    if (!rel.endsWith(".ts") || rel.includes("__tests__") || rel.endsWith(".test.ts")) continue
    // Comments out, so a route named in prose is not read as a registration.
    const text = readFileSync(join(SRC_ROOT, entry), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    const add = (method: string, path: string) => {
      if (!isCoveredPath(path)) return
      routes.push(`${method.toUpperCase()} ${path}`)
      files.add(rel)
    }
    for (const m of text.matchAll(call)) {
      const path = literalPath(text.slice(m.index! + m[0].length))
      if (path !== null) add(m[1]!, path)
    }
    for (const m of text.matchAll(routeObject)) {
      const body = text.slice(m.index! + m[0].length, m.index! + m[0].length + 600)
      const method = /\bmethod:\s*["'](\w+)["']/.exec(body)?.[1]
      const urlAt = /\burl:\s*/.exec(body)
      const url = urlAt ? literalPath(body.slice(urlAt.index + urlAt[0].length)) : null
      if (method && url !== null) add(method, url)
      else if (/from ["']fastify["']/.test(text)) dynamic.add(rel)
    }
    if (/from ["']fastify["']/.test(text)) {
      for (const m of text.matchAll(onInstance)) {
        if (m[1] === "route") continue
        if (literalPath(text.slice(m.index! + m[0].length)) === null) dynamic.add(rel)
      }
    }
  }
  return { routes, files: [...files], dynamic: [...dynamic] }
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
    const { routes, files } = routesInSource()
    expect([...routes].sort()).toEqual(Object.keys(EXPECTED).sort())
    expect([...files].sort()).toEqual(Object.keys(PLUGINS).sort())
  })

  it("every file registering a route on a computed path is listed with why it registers no covered route", () => {
    expect(routesInSource().dynamic.sort()).toEqual(Object.keys(DYNAMIC_ROUTE_FILES).sort())
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
