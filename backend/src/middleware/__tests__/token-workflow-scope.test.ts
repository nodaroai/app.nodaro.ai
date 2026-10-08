import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

/**
 * A personal API key limited to some workflows, at the guard
 * (`registerTokenWorkflowScopeGuard`), behind the real auth hook.
 *
 * It reaches a route only when the route declares which workflow it touches
 * and that workflow is one of the key's; everything else is refused, before
 * the route's own preHandlers (where creditGuard reserves credits) and before
 * the handler. Routes that take no credential treat it as no key. Every other
 * caller (a full-access key, a browser session) is untouched.
 *
 * Assertions are handler-level: a refusal also proves nothing behind it ran.
 */

const USER = "00000000-0000-4000-8000-0000000000a1"
const ALLOWED = "0b9a6f8e-1111-4222-8333-444455556666"
const OTHER = "7c1d2e3f-aaaa-4bbb-8ccc-ddddeeeeffff"
const RUN_OF_ALLOWED = "11111111-1111-4111-8111-111111111111"
const RUN_OF_OTHER = "22222222-2222-4222-8222-222222222222"
const JOB_OF_ALLOWED = "33333333-3333-4333-8333-333333333333"
const JOB_WITHOUT_WORKFLOW = "44444444-4444-4444-8444-444444444444"
const NOBODYS_RUN = "55555555-5555-4555-8555-555555555555"

const LIMITED_KEY = `ndr_${"a".repeat(64)}`
const FULL_KEY = `ndr_${"b".repeat(64)}`

const h = vi.hoisted(() => {
  type Row = { workflow_id: string | null; user_id: string }
  const runs = new Map<string, Row>()
  const jobs = new Map<string, Row>()
  const lookups: Array<{ table: string; filters: Record<string, unknown> }> = []
  const failing = { table: null as string | null }
  function chainFor(table: string): Record<string, unknown> {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (column: string, value: unknown) => {
      filters[column] = value
      return chain
    }
    chain.maybeSingle = async () => {
      lookups.push({ table, filters: { ...filters } })
      if (failing.table === table) return { data: null, error: { message: "boom" } }
      const rows = table === "workflow_executions" ? runs : table === "jobs" ? jobs : new Map<string, Row>()
      const row = rows.get(filters.id as string)
      // A user-filtered read, as Postgres would answer it: another user's row is no row.
      return { data: row && (filters.user_id === undefined || filters.user_id === row.user_id) ? { workflow_id: row.workflow_id } : null, error: null }
    }
    chain.single = async () => ({ data: { role: null }, error: null })
    return chain
  }
  return {
    runs,
    jobs,
    lookups,
    failing,
    from: vi.fn((table: string) => chainFor(table)),
    getUser: vi.fn(),
    resolveApiToken: vi.fn(),
  }
})

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: h.from,
    auth: { getUser: (...a: unknown[]) => h.getUser(...a) },
  },
}))

vi.mock("../../lib/api-token-resolver.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api-token-resolver.js")>()),
  resolveApiToken: (token: string) => h.resolveApiToken(token),
}))

vi.mock("../../lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: async () => false,
}))

vi.mock("../../lib/admin-check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/admin-check.js")>()),
  warmAdminCache: vi.fn(),
}))

import { registerAuthHook } from "../auth.js"
import { LIMITED_KEY_MESSAGE, limitedKeyWorkflows, registerTokenWorkflowScopeGuard } from "../token-workflow-scope.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const REAL_PROFILE = process.env.NODARO_SURFACE_PROFILE

let app: FastifyInstance
/** Stands in for creditGuard: a route's own preHandler, where credits are reserved. */
const routePreHandler = vi.fn(async () => {})
const handler = vi.fn(async (req: FastifyRequest) => ({
  userId: req.userId ?? null,
  authKind: req.authKind ?? null,
  limitedTo: limitedKeyWorkflows(req),
}))

beforeAll(async () => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  app = Fastify({ logger: false })
  registerAuthHook(app)
  registerTokenWorkflowScopeGuard(app)
  const declared = <T>(workflowScope: T) => ({ config: { workflowScope }, preHandler: routePreHandler }) as never
  app.post("/v1/probe/workflows/:id/run", declared({ workflowParam: "id" }), handler)
  app.get("/v1/probe/runs/:runId", declared({ executionParam: "runId" }), handler)
  app.get("/v1/probe/list", declared("handler"), handler)
  app.post("/v1/probe/undeclared", { preHandler: routePreHandler }, handler)
  app.get("/v1/gallery", handler) // takes no credential (PUBLIC_ROUTES), undeclared
  app.post("/mcp", handler) // public, but checks its own bearer: not anonymous
  await app.ready()
})

afterAll(async () => {
  await app.close()
  if (REAL_PROFILE === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_PROFILE
  __resetSurfaceProfileCacheForTests()
})

beforeEach(() => {
  vi.clearAllMocks()
  h.lookups.length = 0
  h.failing.table = null
  h.runs.clear()
  h.jobs.clear()
  h.runs.set(RUN_OF_ALLOWED, { workflow_id: ALLOWED, user_id: USER })
  h.runs.set(RUN_OF_OTHER, { workflow_id: OTHER, user_id: USER })
  h.jobs.set(JOB_OF_ALLOWED, { workflow_id: ALLOWED, user_id: USER })
  h.jobs.set(JOB_WITHOUT_WORKFLOW, { workflow_id: null, user_id: USER })
  h.resolveApiToken.mockImplementation(async (token: string) => {
    const base = { id: "t1", userId: USER, rateLimit: 30, tokenHash: "h", workspaceId: null }
    if (token === LIMITED_KEY) return { ...base, workflowIds: [ALLOWED] }
    if (token === FULL_KEY) return { ...base, workflowIds: [] }
    return null
  })
})

function call(method: "GET" | "POST", url: string, token?: string) {
  return app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {} })
}

function expectRefused(res: Awaited<ReturnType<typeof call>>): void {
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: { code: "forbidden", message: LIMITED_KEY_MESSAGE } })
  expect(routePreHandler).not.toHaveBeenCalled()
  expect(handler).not.toHaveBeenCalled()
}

describe("a key limited to some workflows", () => {
  it("runs one of its workflows", async () => {
    const res = await call("POST", `/v1/probe/workflows/${ALLOWED}/run`, LIMITED_KEY)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: USER, authKind: "api_token", limitedTo: [ALLOWED] })
    expect(routePreHandler).toHaveBeenCalledTimes(1)
  })

  it("is refused any other workflow, before the route reserves anything", async () => {
    expectRefused(await call("POST", `/v1/probe/workflows/${OTHER}/run`, LIMITED_KEY))
  })

  it("is refused when the body names another workflow, on a route it may use", async () => {
    // Hooks after the guard read the body's workflowId (the sequence guard
    // loads that workflow): a key may only ever name one of its own.
    const naming = (workflowId: string) =>
      app.inject({
        method: "POST",
        url: `/v1/probe/workflows/${ALLOWED}/run`,
        headers: { authorization: `Bearer ${LIMITED_KEY}` },
        payload: { workflowId, nodeId: "n1" },
      })
    expectRefused(await naming(OTHER))
    expect((await naming(ALLOWED)).statusCode).toBe(200)
  })

  it("follows a run of one of its workflows, and a single-node job of one", async () => {
    expect((await call("GET", `/v1/probe/runs/${RUN_OF_ALLOWED}`, LIMITED_KEY)).statusCode).toBe(200)
    expect((await call("GET", `/v1/probe/runs/${JOB_OF_ALLOWED}`, LIMITED_KEY)).statusCode).toBe(200)
  })

  it("is refused a run of another workflow, and a job of no workflow", async () => {
    expectRefused(await call("GET", `/v1/probe/runs/${RUN_OF_OTHER}`, LIMITED_KEY))
    vi.clearAllMocks()
    expectRefused(await call("GET", `/v1/probe/runs/${JOB_WITHOUT_WORKFLOW}`, LIMITED_KEY))
  })

  it("looks a run up as its owner's: another user's run, or none, is not found", async () => {
    // Another user's run of a workflow with the same id as one of the key's.
    h.runs.set(NOBODYS_RUN, { workflow_id: ALLOWED, user_id: "00000000-0000-4000-8000-0000000000ff" })
    h.lookups.length = 0
    const res = await call("GET", `/v1/probe/runs/${NOBODYS_RUN}`, LIMITED_KEY)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(handler).not.toHaveBeenCalled()
    expect(h.lookups.map((l) => l.table)).toEqual(["workflow_executions", "jobs"])
    for (const l of h.lookups) expect(l.filters).toEqual({ id: NOBODYS_RUN, user_id: USER })
  })

  it("an id that is not one is not found, without asking the database", async () => {
    const res = await call("GET", "/v1/probe/runs/not-a-run", LIMITED_KEY)
    expect(res.statusCode).toBe(404)
    expect(h.lookups).toEqual([])
    expect(handler).not.toHaveBeenCalled()
  })

  it("a lookup that fails refuses: it never lets the request through", async () => {
    h.failing.table = "workflow_executions"
    const res = await call("GET", `/v1/probe/runs/${RUN_OF_ALLOWED}`, LIMITED_KEY)
    expect(res.statusCode).toBe(500)
    expect(handler).not.toHaveBeenCalled()
  })

  it("reaches a route whose handler applies the list itself, which sees the list", async () => {
    const res = await call("GET", "/v1/probe/list", LIMITED_KEY)
    expect(res.statusCode).toBe(200)
    expect(res.json().limitedTo).toEqual([ALLOWED])
  })

  it("is refused every route that does not declare its workflow", async () => {
    expectRefused(await call("POST", "/v1/probe/undeclared", LIMITED_KEY))
  })

  it("is refused a public route that checks its own bearer (MCP)", async () => {
    expectRefused(await call("POST", "/mcp", LIMITED_KEY))
  })

  it("is no key at all on a route that takes none: the request goes on anonymous", async () => {
    const res = await call("GET", "/v1/gallery", LIMITED_KEY)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: null, authKind: null, limitedTo: null })
  })

  it("an address no route answers is still not found", async () => {
    const res = await call("GET", "/v1/probe/nowhere", LIMITED_KEY)
    expect(res.statusCode).toBe(404)
  })
})

describe("every other caller is untouched", () => {
  it("a key with no workflows listed is the account's full-access key", async () => {
    expect((await call("POST", `/v1/probe/workflows/${OTHER}/run`, FULL_KEY)).statusCode).toBe(200)
    expect((await call("POST", "/v1/probe/undeclared", FULL_KEY)).statusCode).toBe(200)
    const anonymousRoute = await call("GET", "/v1/gallery", FULL_KEY)
    expect(anonymousRoute.json()).toEqual({ userId: USER, authKind: "api_token", limitedTo: null })
    expect(h.lookups).toEqual([])
  })

  it("a browser session", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: USER, app_metadata: {}, user_metadata: {} } }, error: null })
    const session = `eyJhbGciOiJIUzI1NiJ9.limited-key-test-${Date.now()}.sig`
    expect((await call("POST", "/v1/probe/undeclared", session)).statusCode).toBe(200)
    expect((await call("POST", `/v1/probe/workflows/${OTHER}/run`, session)).statusCode).toBe(200)
  })
})
