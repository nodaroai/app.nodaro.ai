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

// ---------------------------------------------------------------------------
// R4 — an app card's allowed values are checked on the SERVER, per field of a
// multi-dimension picker. A restriction the UI honours but the runner does not
// is no restriction: run_app, the SDK and a hand-built body skip the UI.
// ---------------------------------------------------------------------------

const PICKER_SETTINGS = {
  presentationSettings: {
    cardMeta: { person: { pickerAllowedValuesByField: { age: ["age-20s"] } } },
  },
}
const PICKER_NODES = [{ id: "person", type: "person", data: {} }]

function setupAppMocks(onVersionSelect?: (cols: unknown) => void) {
  let callCount = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    callCount++
    if (callCount === 1) return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
    if (callCount === 2) {
      return createChainMock(
        {
          data: { ...DB_APP_ROW, max_runs_per_user_per_day: null, snapshot_nodes: PICKER_NODES, snapshot_settings: PICKER_SETTINGS },
          error: null,
        },
        onVersionSelect,
      ) as never
    }
    if (table === "workflow_executions") return createChainMock({ data: { id: TEST_EXECUTION_ID }, error: null }) as never
    if (table === "app_runs") return createChainMock({ data: { id: TEST_RUN_ID }, error: null }) as never
    return createChainMock({ data: null, error: null }) as never
  })
}

describe("app runner refuses a picker value the card does not allow (R4)", () => {
  it("POST /run — a value outside the per-field list is a 400 before any run", async () => {
    setupAppMocks()
    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { inputOverrides: { person: { age: "age-teen" } } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(res.json().error.message).toContain("Invalid value for age: age-teen")
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

  it("POST /run — the flat `inputs` lane is checked too", async () => {
    setupAppMocks()
    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { inputs: {}, inputOverrides: { person: { age: "age-teen" } } },
    })
    expect(res.statusCode).toBe(400)
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

  it("POST /run — an allowed value gets past the restriction check", async () => {
    setupAppMocks()
    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { inputOverrides: { person: { age: "age-20s" } } },
    })
    expect(res.json().error?.message ?? "").not.toContain("Invalid value for age")
    expect(mockExecuteAppRun).toHaveBeenCalled()
  })

  it("POST /runs (draft) — checked against the snapshot's nodes, which the lookup now selects", async () => {
    let selected: unknown
    setupAppMocks((cols) => {
      selected = cols
    })
    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/runs`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { inputValues: { person: { age: "age-teen" } } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("Invalid value for age: age-teen")
    expect(String(selected)).toContain("snapshot_nodes")
  })

  it("POST /runs (draft) — an allowed value creates the draft", async () => {
    setupAppMocks()
    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/runs`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { inputValues: { person: { age: "age-20s" } } },
    })
    expect(res.statusCode).not.toBe(400)
  })
})
