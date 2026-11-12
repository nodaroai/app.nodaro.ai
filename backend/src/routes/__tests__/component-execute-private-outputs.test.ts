import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * POST /v1/component/execute and POST /v1/component/estimate-credits on a
 * deployment that does not allow public outputs (`outputs.allowPublic: false`).
 *
 * There a component is its creator's alone, except inside a full run of a
 * workflow that holds the component node (the orchestrator's lane, proved end
 * to end in services/workflow-engine/__tests__/component-embedded-private-outputs.test.ts).
 * Anyone else reaching it by its name — the editor's "Run this node", a direct
 * call — gets the answer of a component that does not exist, for its run and
 * for its price. With public outputs allowed nothing changes.
 */

const CREATOR = "00000000-0000-4000-8000-0000000000c1"
const OTHER = "00000000-0000-4000-8000-0000000000a1"

const h = vi.hoisted(() => ({ executeAppRun: vi.fn(), insertJob: vi.fn(), tables: [] as string[] }))

vi.mock("@/services/app-execution.js", () => ({ executeAppRun: h.executeAppRun }))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: h.insertJob,
  insertJobIdempotent: h.insertJob,
  billingPairColumns: () => ({}),
}))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/routes/_collect-component-outputs.js", () => ({ collectComponentOutputs: vi.fn().mockResolvedValue({ output: {} }) }))
vi.mock("@/lib/access-blocks.js", () => ({ isUserBlocked: vi.fn().mockResolvedValue(false) }))
vi.mock("@/ee/billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/billing/credits.js")>()),
  estimateWorkflowCreditsDetailed: vi.fn().mockResolvedValue({ credits: 42, estimate: false }),
}))
vi.mock("@/lib/supabase.js", () => {
  const appRow = {
    id: "app-1",
    workflow_id: "wf-inner",
    creator_id: "00000000-0000-4000-8000-0000000000c1",
    name: "Comp",
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
    estimated_credits: 0,
    snapshot_nodes: [],
    snapshot_edges: [],
  }
  function chain(table: string, result: unknown) {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "order", "limit", "update", "insert"]) c[m] = vi.fn().mockReturnValue(c)
    c.single = vi.fn().mockResolvedValue({ data: result, error: null })
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [result], error: null })
    void table
    return c
  }
  return {
    supabase: {
      from: vi.fn().mockImplementation((table: string) => {
        h.tables.push(table)
        return chain(table, table === "published_apps" ? appRow : { id: "row-1" })
      }),
    },
  }
})

import { componentExecuteRoutes } from "../component-execute.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.tables.length = 0
  h.insertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  h.executeAppRun.mockResolvedValue({ executionId: "exec-child", appRunId: "run-1" })
  setProfile({ outputs: { allowPublic: false } })
  app = Fastify({ logger: false })
  // A signed-in caller (JWT) by x-user-id; none without it.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") {
      req.userId = header
      req.authKind = "jwt"
    }
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
})

const NOT_FOUND = { error: { code: "not_found", message: "Component not found" } }

const run = (userId?: string) =>
  app.inject({ method: "POST", url: "/v1/component/execute", headers: userId ? { "x-user-id": userId } : {}, payload: { appSlug: "comp" } })
const price = (userId?: string) =>
  app.inject({ method: "POST", url: "/v1/component/estimate-credits", headers: userId ? { "x-user-id": userId } : {}, payload: { appSlug: "comp" } })

describe("with outputs.allowPublic false", () => {
  it("another signed-in user's run by its name (the editor's Run this node, a direct call) is not found, and nothing starts", async () => {
    const res = await run(OTHER)
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual(NOT_FOUND)
    expect(h.insertJob).not.toHaveBeenCalled()
    expect(h.executeAppRun).not.toHaveBeenCalled()
  })

  it("a signed-out caller is still asked to sign in", async () => {
    expect((await run()).statusCode).toBe(401)
  })

  it("the creator runs their own component as before", async () => {
    const res = await run(CREATOR)
    expect(res.statusCode, res.body).toBe(202)
    await vi.waitFor(() => expect(h.executeAppRun).toHaveBeenCalledTimes(1))
  })

  it("its price by its name: another user gets the not-found answer, the creator the estimate", async () => {
    const other = await price(OTHER)
    expect(other.statusCode).toBe(404)
    expect(other.json()).toEqual(NOT_FOUND)
    const own = await price(CREATOR)
    expect(own.statusCode).toBe(200)
    expect(own.json()).toEqual({ estimatedCredits: 42 })
  })

  it("its price for a signed-out caller is the not-found answer too", async () => {
    const res = await price()
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual(NOT_FOUND)
  })
})

describe.each([
  ["no profile (the default)", null],
  ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
])("with public outputs allowed: %s", (_label, profile) => {
  beforeEach(() => setProfile(profile))

  it.each([
    ["another signed-in user", OTHER],
    ["the creator", CREATOR],
  ] as const)("%s runs the component by its name, as before", async (_who, userId) => {
    const res = await run(userId)
    expect(res.statusCode).toBe(202)
    await vi.waitFor(() => expect(h.executeAppRun).toHaveBeenCalledTimes(1))
  })

  it("a signed-out caller is asked to sign in, as before", async () => {
    expect((await run()).statusCode).toBe(401)
  })

  it.each([
    ["a signed-out visitor", undefined],
    ["another signed-in user", OTHER],
    ["the creator", CREATOR],
  ] as const)("%s gets its price, as before", async (_who, userId) => {
    expect((await price(userId)).json()).toEqual({ estimatedCredits: 42 })
  })
})
