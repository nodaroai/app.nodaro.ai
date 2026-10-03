// Podcast Track 0.11 — the component route's background wait on its inner
// execution. It used to give up at a flat POLL_ABSOLUTE_TIMEOUT_MS (90 min)
// and fail the wrapper job while the inner run — whose own cap had grown by
// the excess of a long render it dispatched — kept rendering. The wait is now
// 90 minutes + the inner execution's budget excess, read (from the rows, the
// same way the stale sweeps read it) only once the 90 minutes are spent: a
// component with nothing budgeted inside times out exactly as before.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const MIN = 60_000

const h = vi.hoisted(() => ({
  mockExecuteAppRun: vi.fn(),
  mockInsertJob: vi.fn(),
  wrapperUpdates: [] as Array<Record<string, unknown>>,
  innerStatus: "running",
  excess: 0,
  budgetReads: [] as string[],
}))

vi.mock("@/services/app-execution.js", () => ({ executeAppRun: h.mockExecuteAppRun }))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: h.mockInsertJob,
  insertJobIdempotent: vi.fn(),
  billingPairColumns: () => ({}),
}))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/routes/_collect-component-outputs.js", () => ({ collectComponentOutputs: vi.fn().mockReturnValue({}) }))
vi.mock("@/lib/execution-budget.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/execution-budget.js")>()
  return {
    ...actual, // the real BudgetedDeadline
    executionBudgetExcessMs: async (id: string) => {
      h.budgetReads.push(id)
      return h.excess
    },
  }
})
vi.mock("@/lib/supabase.js", () => {
  const appRow = {
    id: "app-1", workflow_id: "wf-inner", name: "Comp",
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
    estimated_credits: 0, snapshot_nodes: [], snapshot_edges: [],
  }
  function chain(table: string) {
    let updating: Record<string, unknown> | null = null
    const c: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "order", "limit", "insert"]) c[m] = vi.fn().mockReturnValue(c)
    c.update = vi.fn((fields: Record<string, unknown>) => { updating = fields; return c })
    const row = () =>
      table === "published_apps" ? appRow
        : table === "workflow_executions"
          ? { status: h.innerStatus, completed_nodes: 0, total_nodes: 2, node_states: {}, total_credits_used: 0 }
          : { id: "row-1" }
    c.single = vi.fn(async () => ({ data: row(), error: null }))
    c.then = (resolve: (v: unknown) => unknown) => {
      if (updating && table === "jobs") h.wrapperUpdates.push(updating)
      return resolve({ data: [row()], error: null })
    }
    return c
  }
  return { supabase: { from: vi.fn((t: string) => chain(t)) } }
})

import { componentExecuteRoutes } from "../component-execute.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.wrapperUpdates = []
  h.innerStatus = "running"
  h.excess = 0
  h.budgetReads = []
  h.mockInsertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  h.mockExecuteAppRun.mockResolvedValue({ executionId: "exec-inner", appRunId: "run-1" })
  app = Fastify()
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
    req.authKind = "jwt"
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
})

afterEach(async () => {
  vi.useRealTimers()
  await app.close()
})

async function start() {
  const res = await app.inject({ method: "POST", url: "/v1/component/execute", payload: { appSlug: "comp" } })
  expect(res.statusCode).toBe(202)
  await vi.waitFor(() => expect(h.mockExecuteAppRun).toHaveBeenCalledTimes(1))
}

async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 5 * MIN) await vi.advanceTimersByTimeAsync(Math.min(5 * MIN, left))
}

const timedOut = () => h.wrapperUpdates.filter((u) => u.status === "failed" && u.error_message === "Component execution timed out")

describe("component route — the inner-execution wait grows by the inner run's budget excess", () => {
  it("nothing budgeted inside: the wrapper fails at 90 minutes, exactly as before", async () => {
    await start()
    await advance(89 * MIN)
    expect(timedOut()).toHaveLength(0)
    expect(h.budgetReads).toEqual([])
    await advance(2 * MIN)
    await vi.waitFor(() => expect(timedOut()).toHaveLength(1))
    expect(h.budgetReads).toEqual(["exec-inner"])
  })

  it("an inner long render: still waiting at minute 95, and gives up only past 90 + the excess", async () => {
    h.excess = 60 * MIN
    await start()
    await advance(95 * MIN)
    expect(timedOut()).toHaveLength(0)
    await advance(50 * MIN) // 145 min: inside 150
    expect(timedOut()).toHaveLength(0)
    await advance(10 * MIN) // 155 min
    await vi.waitFor(() => expect(timedOut()).toHaveLength(1))
  })

  it("an inner run that completes after minute 90 is delivered, not failed", async () => {
    h.excess = 60 * MIN
    await start()
    await advance(120 * MIN)
    h.innerStatus = "completed"
    await advance(1 * MIN)
    await vi.waitFor(() => expect(h.wrapperUpdates.some((u) => u.status === "completed")).toBe(true))
    expect(timedOut()).toHaveLength(0)
  })
})
