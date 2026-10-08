import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest"
import type { FastifyInstance } from "fastify"
import { LIMITED_KEY_MESSAGE, type WorkflowScope } from "../token-workflow-scope.js"

/**
 * Which real routes a personal API key limited to some workflows can reach,
 * on the whole app as `buildApp()` registers it (cloud edition, ee routes
 * included).
 *
 * The guard refuses such a key everywhere a route has not declared which
 * workflow it touches, so the declarations ARE the key's whole surface. This
 * pins them: declaring one more route (a gallery, a job list, an upload) is a
 * decision about what a workflow-limited key may do, and has to be made here,
 * on purpose. The second half sends real requests to the routes the original
 * report named, which ignored the limit.
 */

const DECLARED: Record<string, WorkflowScope> = {
  // The original API: run a workflow, read its inputs, follow the run.
  "GET /v1/api/workflows": "handler",
  "GET /v1/api/schema": "handler",
  "POST /v1/api/run": "handler",
  "GET /v1/api/status/:execId": { executionParam: "execId" },
  "GET /v1/api/result/:execId": { executionParam: "execId" },
  // The REST surface the SDK and CLI use for the same.
  "GET /v1/workflows": "handler",
  "GET /v1/projects/:projectId/workflows": "handler",
  "GET /v1/workflows/:id": { workflowParam: "id" },
  "GET /v1/workflows/:id/interface": { workflowParam: "id" },
  "POST /v1/workflows/:id/run": { workflowParam: "id" },
  "POST /v1/workflows/:id/render-final/estimate": { workflowParam: "id" },
  "GET /v1/workflows/:id/executions": { workflowParam: "id" },
  "GET /v1/executions": "handler",
  "GET /v1/workflow-executions/:id": { executionParam: "id" },
  "GET /v1/workflow-executions/:id/stream": { executionParam: "id" },
  "POST /v1/workflow-executions/:id/cancel": { executionParam: "id" },
}

const ALLOWED = "0b9a6f8e-1111-4222-8333-444455556666"
const OTHER = "7c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff"
const RUN_OF_OTHER = "22222222-2222-4222-8222-222222222222"
const LIMITED_KEY = `ndr_${"c".repeat(64)}`

const h = vi.hoisted(() => {
  const routes: Array<{ key: string; url: string; scope: unknown }> = []
  const writes: string[] = []
  // Any query answers "nothing", except the run the guard looks up.
  function chain(table: string): unknown {
    const filters: Record<string, unknown> = {}
    const answer = () =>
      table === "workflow_executions" && filters.id === "22222222-2222-4222-8222-222222222222"
        ? { data: { workflow_id: "7c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff" }, error: null }
        : { data: null, error: null }
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => answer()
        return (...args: unknown[]) => {
          if (prop === "eq") filters[args[0] as string] = args[1]
          if (prop === "insert" || prop === "update" || prop === "upsert" || prop === "delete") writes.push(`${String(prop)} ${table}`)
          return proxy
        }
      },
    })
    return proxy
  }
  return {
    routes,
    writes,
    supabase: { from: (table: string) => chain(table), rpc: () => chain("rpc"), auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
  }
})

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: async () => ({ loaded: null }) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: h.supabase }))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-blocks.js")>()),
  isUserBlocked: async () => false,
}))
vi.mock("@/lib/api-token-resolver.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-token-resolver.js")>()),
  resolveApiToken: async (token: string) =>
    token === "ndr_" + "c".repeat(64)
      ? { id: "t1", userId: "00000000-0000-4000-8000-0000000000a1", workflowIds: ["0b9a6f8e-1111-4222-8333-444455556666"], rateLimit: 120, tokenHash: "h", workspaceId: null }
      : null,
}))
vi.mock("fastify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastify")>()
  const make = ((...args: unknown[]) => {
    const app = (actual.default as unknown as (...a: unknown[]) => FastifyInstance)(...args)
    app.addHook("onRoute", (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method]
      for (const m of methods) {
        if (m === "HEAD") continue
        h.routes.push({ key: `${m} ${r.url}`, url: r.url, scope: r.config?.workflowScope })
      }
    })
    return app
  }) as unknown as typeof actual.default
  return { ...actual, default: make }
})

let app: FastifyInstance

beforeAll(async () => {
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.ready()
}, 60_000)

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  h.writes.length = 0
})

describe("the routes a workflow-limited key can reach", () => {
  it("are exactly the declared ones", () => {
    const declared = Object.fromEntries(h.routes.filter((r) => r.scope !== undefined).map((r) => [r.key, r.scope]))
    expect(declared).toEqual(DECLARED)
  })

  it("each declaration names a parameter of its own address", () => {
    for (const r of h.routes) {
      const scope = r.scope as WorkflowScope | undefined
      if (!scope || scope === "handler") continue
      const param = "workflowParam" in scope ? scope.workflowParam : scope.executionParam
      expect(r.url.split("/"), `${r.key} declares :${param}`).toContain(`:${param}`)
    }
  })
})

describe("the routes the report named refuse a run or a result of another workflow", () => {
  const LIMITED = { authorization: `Bearer ${LIMITED_KEY}` }

  function expectRefused(res: { statusCode: number; json: () => unknown }): void {
    expect(res.statusCode).toBe(403)
    // The guard's own answer, not some other route's "forbidden".
    expect(res.json()).toEqual({ error: { code: "forbidden", message: LIMITED_KEY_MESSAGE } })
  }

  it("POST /v1/workflows/:id/run, and nothing is written", async () => {
    expectRefused(await app.inject({ method: "POST", url: `/v1/workflows/${OTHER}/run`, headers: LIMITED, payload: {} }))
    expect(h.writes).toEqual([])
  })

  it("GET /v1/workflow-executions/:id", async () => {
    expectRefused(await app.inject({ method: "GET", url: `/v1/workflow-executions/${RUN_OF_OTHER}`, headers: LIMITED }))
  })

  it("GET /v1/api/status/:execId and GET /v1/api/result/:execId", async () => {
    expectRefused(await app.inject({ method: "GET", url: `/v1/api/status/${RUN_OF_OTHER}`, headers: LIMITED }))
    expectRefused(await app.inject({ method: "GET", url: `/v1/api/result/${RUN_OF_OTHER}`, headers: LIMITED }))
  })

  it("and every route that does not declare its workflow, a paid one included", async () => {
    expectRefused(await app.inject({ method: "POST", url: "/v1/generate-image", headers: LIMITED, payload: { prompt: "x" } }))
    expectRefused(await app.inject({ method: "GET", url: "/v1/jobs", headers: LIMITED }))
    expectRefused(await app.inject({ method: "PATCH", url: `/v1/workflows/${ALLOWED}`, headers: LIMITED, payload: { name: "x" } }))
    expect(h.writes).toEqual([])
  })

  it("a route that takes no credential still answers, as it would anyone", async () => {
    // GET /v1/gallery answers anonymous callers: the key is dropped, not refused
    // (that the request then carries no user is pinned in token-workflow-scope.test.ts).
    const res = await app.inject({ method: "GET", url: "/v1/gallery", headers: LIMITED })
    expect(res.statusCode).not.toBe(403)
  })
})
