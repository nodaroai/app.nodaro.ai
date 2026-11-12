// @test-watches tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
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

// The fixture unit `fixture-echo` (tools/units/__fixtures__), through its golden descriptor, composed into
// the server's one door to the unit descriptors.
vi.mock("@/lib/unit-descriptors.js", async (importOriginal) => {
  const real = (await importOriginal()) as typeof import("../../lib/unit-descriptors.js")
  const { descriptor } = await import("../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  const units = [...real.UNIT_NODE_DESCRIPTORS, descriptor as unknown as (typeof real.UNIT_NODE_DESCRIPTORS)[number]]
  return { ...real, UNIT_NODE_DESCRIPTORS: units, unitDescriptorOf: (t: string | undefined) => units.find((u) => u.type === t) }
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
// A node unit's app fields (unit.json appFields, tools/units/README.md "A unit's app fields") take only the
// values they declare, on every key a run request sets — exposed by the app or not, null included: a value
// outside them is a 400 before any run, with the wording of a legacy fixed-list strip field
// (app-runner-quick-fields.test.ts). A flat input naming a field the app does not expose is dropped, as for any
// node. A legacy node keeps its own rules: an unexposed raw override on one still passes unchecked.
// ---------------------------------------------------------------------------

const UNIT_SETTINGS = {
  presentationSettings: {
    inputItems: [
      { type: "field", id: "f1", nodeId: "split", field: "size" },
      { type: "field", id: "f2", nodeId: "split", field: "maxLayers" },
    ],
  },
}
const UNIT_NODES = [
  { id: "split", type: "fixture-echo", data: { label: "Layers", size: "1K", maxLayers: 9 } },
  { id: "v2v", type: "video-to-video", data: {} },
]

function setupUnitMocks(settings: unknown = UNIT_SETTINGS) {
  let callCount = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    callCount++
    if (callCount === 1) return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
    if (callCount === 2) {
      return createChainMock({
        data: { ...DB_APP_ROW, max_runs_per_user_per_day: null, snapshot_nodes: UNIT_NODES, snapshot_settings: settings },
        error: null,
      }) as never
    }
    if (table === "workflow_executions") return createChainMock({ data: { id: TEST_EXECUTION_ID }, error: null }) as never
    if (table === "app_runs") return createChainMock({ data: { id: TEST_RUN_ID }, error: null }) as never
    return createChainMock({ data: null, error: null }) as never
  })
}

const run = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/app/${TEST_SLUG}/run`, headers: { "x-user-id": TEST_USER_ID }, payload })
const runNested = (overrides: Record<string, unknown>) => run({ inputOverrides: { split: overrides } })
/** The input overrides the run was started with. */
const ranWith = () => (mockExecuteAppRun.mock.calls[0]?.[0] as { inputOverrides?: unknown } | undefined)?.inputOverrides

describe("app runner holds a unit's app field to its declaration", () => {
  it("allowed values run, and reach the run as the node's own fields", async () => {
    setupUnitMocks()
    const res = await runNested({ size: "2K", maxLayers: 42 })
    expect(res.json().error?.message ?? "").not.toContain("Invalid value")
    expect(mockExecuteAppRun).toHaveBeenCalled()
    expect(ranWith()).toEqual({ split: { size: "2K", maxLayers: 42 } })
  })

  it("the flat inputs lane (SDK, CLI, MCP run_app) lands the same, a numeric string as a number", async () => {
    setupUnitMocks()
    const res = await run({ inputs: { layers_size: "auto", layers_maxlayers: "99" } })
    expect(res.json().error?.message ?? "").not.toContain("Invalid value")
    expect(ranWith()).toEqual({ split: { size: "auto", maxLayers: 99 } })
  })

  it("a value outside the select's options is a 400 before any run", async () => {
    setupUnitMocks()
    const res = await runNested({ size: "4K" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "Invalid value for size: 4K. Allowed: auto, 1K, 1.5K, 2K" })
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

  it("an integer outside its range, or not a whole number, is a 400 before any run", async () => {
    for (const maxLayers of [0, 100, 9.5, "9"]) {
      vi.clearAllMocks()
      setupUnitMocks()
      const res = await runNested({ maxLayers })
      expect(res.statusCode, String(maxLayers)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
      expect(res.json().error.message).toBe(`Invalid value for maxLayers: ${maxLayers}. Use a whole number between 1 and 99.`)
      expect(mockExecuteAppRun).not.toHaveBeenCalled()
    }
  })

  it("a flat input out of range is refused the same way", async () => {
    setupUnitMocks()
    const res = await run({ inputs: { layers_maxlayers: "500" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("Invalid value for maxLayers: 500. Use a whole number between 1 and 99.")
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

  it("a publisher's restriction holds, and a restricted value is still held to the declaration", async () => {
    setupUnitMocks({ presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "split", field: "size", allowedValues: ["1K", "2K", "8K"] }] } })
    const outside = await runNested({ size: "auto" })
    expect(outside.statusCode).toBe(400)
    expect(outside.json().error.message).toBe("Invalid value for size: auto. Allowed: 1K, 2K, 8K")
    vi.clearAllMocks()
    setupUnitMocks({ presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "split", field: "size", allowedValues: ["1K", "2K", "8K"] }] } })
    const undeclared = await runNested({ size: "8K" })
    expect(undeclared.statusCode).toBe(400)
    expect(undeclared.json().error.message).toBe("Invalid value for size: 8K. Allowed: auto, 1K, 1.5K, 2K")
  })

  it("null is refused: the merge would delete the key, and the unit would read no value instead of its default", async () => {
    setupUnitMocks()
    const res = await runNested({ maxLayers: null })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "Invalid value for maxLayers: null. Use a whole number between 1 and 99." })
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
    vi.clearAllMocks()
    setupUnitMocks()
    const select = await runNested({ size: null })
    expect(select.json().error.message).toBe("Invalid value for size: null. Allowed: auto, 1K, 1.5K, 2K")
  })

  it("a field the creator did not expose: a flat input naming it is dropped, as for a legacy node", async () => {
    setupUnitMocks({ presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "split", field: "size" }] } })
    const res = await run({ inputs: { layers_size: "2K", layers_maxlayers: 500, maxLayers: 500 } })
    expect(res.json().error?.message ?? "").not.toContain("Invalid value")
    expect(ranWith()).toEqual({ split: { size: "2K" } })
  })

  it("a field the creator did not expose: a raw nested override is held to the declaration all the same", async () => {
    // The unit's maxLayers, not exposed by this app.
    setupUnitMocks({ presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "split", field: "size" }] } })
    const unit = await run({ inputOverrides: { split: { maxLayers: 500 } } })
    expect(unit.statusCode).toBe(400)
    expect(unit.json().error).toEqual({ code: "validation_error", message: "Invalid value for maxLayers: 500. Use a whole number between 1 and 99." })
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
    // A declared value there runs: the field keeps the creator's saved value unless the run sets a declared one.
    vi.clearAllMocks()
    setupUnitMocks({ presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "split", field: "size" }] } })
    const declared = await run({ inputOverrides: { split: { maxLayers: 12 } } })
    expect(declared.json().error?.message ?? "").not.toContain("Invalid value")
    expect(ranWith()).toEqual({ split: { maxLayers: 12 } })
  })

  it("a legacy node is unchanged: an unexposed raw override on its fixed-list strip field still passes unchecked", async () => {
    setupUnitMocks({ presentationSettings: { inputItems: [{ type: "field", id: "f1", nodeId: "split", field: "size" }] } })
    const legacy = await run({ inputOverrides: { v2v: { provider: "not-a-model" } } })
    expect(legacy.json().error?.message ?? "").not.toContain("Invalid value")
    expect(ranWith()).toEqual({ v2v: { provider: "not-a-model" } })
  })

  it("a draft run (POST /v1/app/:slug/runs, whose inputs a Retry re-applies) is held the same way", async () => {
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      if (callCount === 2) return createChainMock({ data: { ...DB_APP_ROW, snapshot_nodes: UNIT_NODES, snapshot_settings: UNIT_SETTINGS }, error: null }) as never
      return createChainMock({ data: { id: TEST_RUN_ID, created_at: "t", input_values: {}, status: "draft" }, error: null }) as never
    })
    const draft = (inputValues: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/v1/app/${TEST_SLUG}/runs`, headers: { "x-user-id": TEST_USER_ID }, payload: { inputValues: { split: inputValues } } })
    const refused = await draft({ maxLayers: 0 })
    expect(refused.statusCode).toBe(400)
    expect(refused.json().error.message).toBe("Invalid value for maxLayers: 0. Use a whole number between 1 and 99.")
    callCount = 0
    const accepted = await draft({ maxLayers: 3 })
    expect(accepted.statusCode).toBe(201)
  })
})
