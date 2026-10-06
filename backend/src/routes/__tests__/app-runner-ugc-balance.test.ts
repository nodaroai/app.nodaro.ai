/**
 * The app's pre-run balance check (spec section 8.4, R25). Before any node runs,
 * a run of a snapshot holding UGC Clip asks the estimate for the runner's chosen
 * length, screenshot count and creator source, and is refused with a 402 when
 * the runner's balance is below the worst case. A snapshot without UGC Clip
 * never asks; an absent estimate seam is no check.
 *
 * `estimateUgcRun` is stubbed (the real `ugcEstimateInputOf` runs); the balance
 * read is stubbed on `CreditsService`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true }
})

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({}) },
}))

// Audit 2026-09-06 follow-up: the run route hands the `idempotency-key`
// header to the core, which dedups the execution. Spied here so the header
// → key plumbing is asserted without a real UNIQUE index.
const mockExecuteAppRun = vi.hoisted(() => vi.fn())
vi.mock("@/services/app-execution.js", async (importOriginal) => {
  const orig = (await importOriginal()) as { executeAppRun: (p: unknown) => Promise<unknown> }
  // Delegates to the real core unless a test queues a value — the existing
  // 202 tests keep exercising the real inserts through the supabase mock.
  mockExecuteAppRun.mockImplementation((p: unknown) => orig.executeAppRun(p))
  return { ...orig, executeAppRun: (p: unknown) => mockExecuteAppRun(p) }
})

const u = vi.hoisted(() => ({ estimate: vi.fn() }))
vi.mock("@/ee/lib/ugc-estimate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/lib/ugc-estimate.js")>()),
  estimateUgcRun: u.estimate,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { appRunnerRoutes, invalidateAppCache } from "../app-runner.js"
import { supabase } from "../../lib/supabase.js"
import { orchestrationQueue } from "../../lib/orchestration-queue.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_APP_ID = "00000000-0000-4000-8000-000000000010"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TEST_EXECUTION_ID = "00000000-0000-4000-8000-000000000030"
const TEST_RUN_ID = "00000000-0000-4000-8000-000000000040"
const TEST_SLUG = "my-cool-app"

const DB_APP_ROW = {
  id: TEST_APP_ID,
  name: "My Cool App",
  description: "A test app",
  icon_url: "https://example.com/icon.png",
  version: 1,
  snapshot_nodes: [{ id: "n1", type: "generate-image" }],
  snapshot_edges: [{ source: "n1", target: "n2" }],
  snapshot_settings: { autoSave: true },
  estimated_credits: 10,
  creator_id: "creator-123",
  max_runs_per_user_per_day: 5,
  created_at: "2026-01-01T00:00:00Z",
  workflow_id: TEST_WORKFLOW_ID,
}

const DB_RUN_ROW = {
  id: TEST_RUN_ID,
  app_id: TEST_APP_ID,
  runner_id: TEST_USER_ID,
  execution_id: TEST_EXECUTION_ID,
  created_at: "2026-01-01T12:00:00Z",
  published_apps: { version: 1 },
  workflow_executions: {
    id: TEST_EXECUTION_ID,
    status: "completed",
    node_states: { n1: { status: "completed" } },
    total_nodes: 1,
    completed_nodes: 1,
    failed_nodes: 0,
    total_credits_used: 5,
    error_message: null,
    completed_at: "2026-01-01T12:05:00Z",
  },
}

let app: FastifyInstance
/** When true, the auth-bypass hook stamps a DEGRADED personal payer (P14). */
const stampDegradedContext = { value: false }

beforeEach(async () => {
  vi.clearAllMocks()
  invalidateAppCache(TEST_SLUG)

  app = Fastify({ logger: false })

  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (stampDegradedContext.value && typeof header === "string") {
      req.billingContext = { payer: "user", userId: header, degraded: true }
    }
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await appRunnerRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})


function createChainMock(resolveValue: unknown, onSelect?: (cols: unknown) => void) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(resolveValue)
      return (...args: unknown[]) => {
        if (prop === "select") onSelect?.(args[0])
        return new Proxy({}, handler)
      }
    },
  }
  return new Proxy({}, handler)
}

import { CreditsService } from "../../ee/billing/credits.js"
import { UgcEstimateUnavailable } from "../../ee/lib/ugc-estimate.js"

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
const UGC_NODES = [
  n("shot1", "upload-image", { url: "https://example.test/a.png" }),
  n("shot2", "upload-image", { url: "https://example.test/b.png" }),
  n("shot3", "upload-image", { url: "" }),
  n("script", "ugc-script", { targetDurationSec: 15 }),
  n("creator", "ugc-creator", { source: "sampled" }),
  n("clips", "ugc-clips"),
  n("clip", "ugc-clip", { rerender: {} }),
]
const UGC_EDGES = [
  { source: "shot1", target: "script", targetHandle: "screenshot" },
  { source: "shot2", target: "script", targetHandle: "screenshot2" },
  { source: "shot3", target: "script", targetHandle: "screenshot3" },
  { source: "script", target: "clips", targetHandle: "plan" },
  { source: "creator", target: "clips", targetHandle: "creator" },
  { source: "clips", target: "clip", targetHandle: "clip" },
]
const ESTIMATE = { expected: 2563, range: [2083, 3033], worstCase: 5873, lines: [], ceiling: 0 }

function setupApp(nodes: unknown[], edges: unknown[]) {
  const tables: string[] = []
  let callCount = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    tables.push(table)
    callCount++
    if (callCount === 1) return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
    if (callCount === 2) {
      return createChainMock({
        data: { ...DB_APP_ROW, max_runs_per_user_per_day: null, snapshot_nodes: nodes, snapshot_edges: edges, snapshot_settings: {} },
        error: null,
      }) as never
    }
    if (table === "workflow_executions") return createChainMock({ data: { id: TEST_EXECUTION_ID }, error: null }) as never
    if (table === "app_runs") return createChainMock({ data: { id: TEST_RUN_ID }, error: null }) as never
    return createChainMock({ data: null, error: null }) as never
  })
  return tables
}

let eligibility: ReturnType<typeof vi.spyOn>
let covers: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  eligibility = vi.spyOn(CreditsService, "checkAppRunEligibility").mockResolvedValue({ allowed: true })
  covers = vi.spyOn(CreditsService, "checkBalanceCovers").mockResolvedValue({ ok: true })
  u.estimate.mockResolvedValue(ESTIMATE)
  mockExecuteAppRun.mockResolvedValue({ executionId: TEST_EXECUTION_ID, appRunId: TEST_RUN_ID, deduped: false })
})
afterEach(() => {
  eligibility.mockRestore()
  covers.mockRestore()
})

function run(payload: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: `/v1/app/${TEST_SLUG}/run`, headers: { "x-user-id": TEST_USER_ID }, payload })
}

describe("the app runner's pre-run balance check for a UGC snapshot (R25)", () => {
  it("a balance below the worst case is a 402 before any row or enqueue", async () => {
    const tables = setupApp(UGC_NODES, UGC_EDGES)
    covers.mockResolvedValue({ ok: false, balance: 4000 })
    const res = await run()
    expect(res.statusCode).toBe(402)
    expect(res.json()).toEqual({
      error: {
        code: "insufficient_credits",
        message: "This video can hold up to about 5873 credits while it renders; your balance is 4000.",
      },
    })
    expect(covers).toHaveBeenCalledWith(TEST_USER_ID, 5873, undefined, expect.any(Boolean))
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
    expect(tables).not.toContain("workflow_executions")
    expect(tables).not.toContain("app_runs")
  })

  it("the draft-run path (a runId) is refused the same way, before an execution row", async () => {
    const tables = setupApp(UGC_NODES, UGC_EDGES)
    covers.mockResolvedValue({ ok: false, balance: 4000 })
    const res = await run({ runId: TEST_RUN_ID })
    expect(res.statusCode).toBe(402)
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
    expect(tables).not.toContain("workflow_executions")
  })

  it("a balance that covers the worst case lets the run proceed", async () => {
    setupApp(UGC_NODES, UGC_EDGES)
    const res = await run()
    expect(res.statusCode).toBe(202)
    expect(covers).toHaveBeenCalledTimes(1)
    expect(mockExecuteAppRun).toHaveBeenCalledTimes(1)
  })

  it("a snapshot without UGC Clip calls neither the estimate nor the balance check", async () => {
    setupApp([n("a", "generate-image")], [])
    const res = await run()
    expect(res.statusCode).toBe(202)
    expect(u.estimate).not.toHaveBeenCalled()
    expect(covers).not.toHaveBeenCalled()
  })

  it("an absent estimate seam is no check", async () => {
    setupApp(UGC_NODES, UGC_EDGES)
    u.estimate.mockRejectedValue(new UgcEstimateUnavailable())
    const res = await run()
    expect(res.statusCode).toBe(202)
    expect(covers).not.toHaveBeenCalled()
    expect(mockExecuteAppRun).toHaveBeenCalledTimes(1)
  })

  it("any other estimate failure is not swallowed", async () => {
    setupApp(UGC_NODES, UGC_EDGES)
    u.estimate.mockRejectedValue(new Error("boom"))
    const res = await run()
    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

  it("the estimate is asked for the runner (the payer), and with no overrides counts the slots that hold an image", async () => {
    setupApp(UGC_NODES, UGC_EDGES)
    await run()
    expect(u.estimate).toHaveBeenCalledWith({ userId: TEST_USER_ID, billingContext: undefined }, { targetDurationSec: 15, screenshotCount: 2, source: "sampled" })
  })

  it("the run's overrides reach the estimate: length, creator source and screenshot slots", async () => {
    setupApp(UGC_NODES, UGC_EDGES)
    await run({
      inputOverrides: {
        script: { targetDurationSec: 25 },
        creator: { source: "photo" },
        shot3: { url: "https://example.test/c.png" },
      },
    })
    expect(u.estimate).toHaveBeenCalledWith(expect.anything(), { targetDurationSec: 25, screenshotCount: 3, source: "photo" })
  })
})
