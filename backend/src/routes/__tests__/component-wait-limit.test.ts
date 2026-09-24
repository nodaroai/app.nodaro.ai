// GET /v1/component/execute/:jobId/wait-limit — how long the SERVER waits on a
// component run (podcast Track 0.11 follow-up, decision 2026-09-24: "the
// editor's component executor waits as long as the server allows"). The
// figure is the component route's own background wait: POLL_ABSOLUTE_TIMEOUT_MS
// plus the inner execution's budget excess, read through the SAME
// `executionBudgetExcessMs` every other outside clock uses — plus whether the
// run may still dispatch a long render it has not reached yet
// (`pendingBudgetedNodes`, `executionMayDispatchBudgetedJob`), so a client
// asking at minute 30 does not abandon a render that starts at minute 40.
// Owner-scoped; only a component wrapper answers.
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  filters: [] as Array<Record<string, unknown>>,
  excessByExecution: new Map<string, number>(),
  budgetReads: [] as string[],
  pendingExecutions: new Set<string>(),
  pendingReads: [] as string[],
  userRole: undefined as string | undefined,
  appScopes: undefined as string[] | undefined,
}))

vi.mock("@/services/app-execution.js", () => ({ executeAppRun: vi.fn() }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(), insertJobIdempotent: vi.fn(), billingPairColumns: () => ({}) }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/routes/_collect-component-outputs.js", () => ({ collectComponentOutputs: vi.fn() }))
vi.mock("@/lib/execution-budget.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/execution-budget.js")>()
  return {
    ...actual,
    executionBudgetExcessMs: async (id: string) => {
      h.budgetReads.push(id)
      return h.excessByExecution.get(id) ?? 0
    },
    executionMayDispatchBudgetedJob: async (id: string) => {
      h.pendingReads.push(id)
      return h.pendingExecutions.has(id)
    },
  }
})
vi.mock("@/lib/supabase.js", () => {
  function chain() {
    const filters: Record<string, unknown> = {}
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.eq = (col: string, v: unknown) => { filters[col] = v; return c }
    c.maybeSingle = async () => {
      h.filters.push({ ...filters })
      const row = h.rows.get(filters.id as string)
      const owned = !row || filters.user_id === undefined || row.user_id === filters.user_id
      return { data: row && owned ? row : null, error: null }
    }
    return c
  }
  return { supabase: { from: vi.fn(() => chain()) } }
})

import { componentExecuteRoutes } from "../component-execute.js"
import { POLL_ABSOLUTE_TIMEOUT_MS } from "../../services/workflow-engine/types.js"

const WRAPPER = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const MIN = 60_000

let app: FastifyInstance

beforeEach(async () => {
  h.rows = new Map([
    [WRAPPER, { user_id: "user-1", provider: "component", input_data: { _executionId: "exec-inner" } }],
    [OTHER, { user_id: "user-1", provider: "kie", input_data: {} }],
  ])
  h.filters = []
  h.excessByExecution = new Map()
  h.budgetReads = []
  h.pendingExecutions = new Set()
  h.pendingReads = []
  h.userRole = undefined
  h.appScopes = undefined
  app = Fastify()
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
    req.userRole = h.userRole
    if (h.appScopes) req.appAuthorization = { appId: "a", authorizationId: "z", scopes: h.appScopes } as never
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
})

const get = (id: string) => app.inject({ method: "GET", url: `/v1/component/execute/${id}/wait-limit` })

describe("GET /v1/component/execute/:jobId/wait-limit", () => {
  it("nothing budgeted inside: the server's base wait, zero excess", async () => {
    const res = await get(WRAPPER)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: { budgetExcessMs: 0, waitLimitMs: POLL_ABSOLUTE_TIMEOUT_MS, pendingBudgetedNodes: false },
    })
    expect(h.budgetReads).toEqual(["exec-inner"])
    expect(h.pendingReads).toEqual(["exec-inner"])
  })

  it("a long render in the run that has not been dispatched yet: zero excess, pendingBudgetedNodes true", async () => {
    h.pendingExecutions.add("exec-inner")
    const res = await get(WRAPPER)
    expect(res.json()).toEqual({
      data: { budgetExcessMs: 0, waitLimitMs: POLL_ABSOLUTE_TIMEOUT_MS, pendingBudgetedNodes: true },
    })
  })

  it("a long render inside: the base wait grown by the inner execution's excess — the server's own limit", async () => {
    h.excessByExecution.set("exec-inner", 150 * MIN)
    const res = await get(WRAPPER)
    expect(res.json()).toEqual({
      data: { budgetExcessMs: 150 * MIN, waitLimitMs: POLL_ABSOLUTE_TIMEOUT_MS + 150 * MIN, pendingBudgetedNodes: false },
    })
  })

  it("a wrapper whose inner execution is not stamped yet: base wait, nothing pending, no lookup", async () => {
    h.rows.set(WRAPPER, { user_id: "user-1", provider: "component", input_data: {} })
    const res = await get(WRAPPER)
    expect(res.json()).toEqual({
      data: { budgetExcessMs: 0, waitLimitMs: POLL_ABSOLUTE_TIMEOUT_MS, pendingBudgetedNodes: false },
    })
    expect(h.budgetReads).toEqual([])
    expect(h.pendingReads).toEqual([])
  })

  it("is owner-scoped: another user's wrapper is not found (and never read for its budget)", async () => {
    h.rows.set(WRAPPER, { user_id: "someone-else", provider: "component", input_data: { _executionId: "exec-inner" } })
    const res = await get(WRAPPER)
    expect(res.statusCode).toBe(404)
    expect(h.filters[0]).toMatchObject({ id: WRAPPER, user_id: "user-1" })
    expect(h.budgetReads).toEqual([])
    expect(h.pendingReads).toEqual([])
  })

  it("only a component wrapper answers", async () => {
    expect((await get(OTHER)).statusCode).toBe(404)
  })

  it("a non-UUID id is a 400", async () => {
    expect((await get("not-a-uuid")).statusCode).toBe(400)
  })

  it("an app token needs jobs:read", async () => {
    h.appScopes = ["workflows:read"]
    expect((await get(WRAPPER)).statusCode).toBe(403)
    h.appScopes = ["jobs:read"]
    expect((await get(WRAPPER)).statusCode).toBe(200)
  })
})
