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
  published_apps: { version: 1, workflow_id: TEST_WORKFLOW_ID },
  workflow_executions: {
    id: TEST_EXECUTION_ID,
    user_id: TEST_USER_ID,
    workflow_id: TEST_WORKFLOW_ID,
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

// ---------------------------------------------------------------------------
// Helper: create a chainable Supabase query mock
// ---------------------------------------------------------------------------

function createChainMock(resolveValue: unknown) {
  const self: Record<string, unknown> = {}
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") {
        // Make it thenable so it resolves when awaited
        return (resolve: (v: unknown) => void) => resolve(resolveValue)
      }
      // Any chained method returns the proxy itself
      if (!self[prop as string]) {
        self[prop as string] = new Proxy({}, handler)
      }
      return (..._args: unknown[]) => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

// ---------------------------------------------------------------------------
// GET /v1/app/:slug
// ---------------------------------------------------------------------------

describe("GET /v1/app/:slug", () => {
  it("returns 404 when app not found", async () => {
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      // First call: slug lookup — not found
      return createChainMock({ data: null, error: { code: "PGRST116", message: "not found" } }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}`,
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with camelCase response on success", async () => {
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // resolveSlug → workflow_id
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      // All versions by workflow_id
      return createChainMock({ data: [DB_APP_ROW], error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.id).toBe(TEST_APP_ID)
    expect(body.name).toBe("My Cool App")
    expect(body.iconUrl).toBe("https://example.com/icon.png")
    expect(body.snapshotNodes).toEqual([{ id: "n1", type: "generate-image" }])
    expect(body.snapshotEdges).toEqual([{ source: "n1", target: "n2" }])
    expect(body.estimatedCredits).toBe(10)
    expect(body.creatorId).toBe("creator-123")
    expect(body.maxRunsPerUserPerDay).toBe(5)
    expect(body.createdAt).toBe("2026-01-01T00:00:00Z")
    expect(body.versions).toEqual([{ version: 1, id: TEST_APP_ID, createdAt: "2026-01-01T00:00:00Z" }])
    expect(body.workflowId).toBe(TEST_WORKFLOW_ID)
    // Ensure no snake_case keys leaked
    expect(body.icon_url).toBeUndefined()
    expect(body.snapshot_nodes).toBeUndefined()
    expect(body.creator_id).toBeUndefined()
  })

  it("does not require auth", async () => {
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // resolveSlug → workflow_id
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      // All versions by workflow_id
      return createChainMock({ data: [DB_APP_ROW], error: null }) as never
    })

    // No x-user-id header
    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}`,
    })

    expect(res.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// POST /v1/app/:slug/run
// ---------------------------------------------------------------------------

describe("POST /v1/app/:slug/run", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      payload: {},
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 404 when app not found", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: null, error: { message: "not found" } }) as never
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 429 when daily rate limit exceeded", async () => {
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) {
        // Slug lookup
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      if (callCount === 2) {
        // Version lookup
        return createChainMock({ data: { ...DB_APP_ROW, max_runs_per_user_per_day: 5 }, error: null }) as never
      }
      if (table === "app_runs") {
        // Rate limit check
        return createChainMock({ count: 5, data: null, error: null }) as never
      }
      return createChainMock({ data: null, error: null }) as never
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })

    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe("rate_limit_exceeded")
  })

  function setupSuccessfulRunMocks(rowOverrides: Record<string, unknown> = {}) {
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) {
        // Slug lookup
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      if (callCount === 2) {
        // Version lookup
        return createChainMock({
          data: { ...DB_APP_ROW, max_runs_per_user_per_day: null, ...rowOverrides },
          error: null,
        }) as never
      }
      if (table === "workflow_executions") {
        return createChainMock({ data: { id: TEST_EXECUTION_ID }, error: null }) as never
      }
      if (table === "app_runs") {
        return createChainMock({ data: { id: TEST_RUN_ID }, error: null }) as never
      }
      return createChainMock({ data: null, error: null }) as never
    })
  }

  it("P14 (stage-9 C1): a DEGRADED payer on workspace-homed work refuses BEFORE any row — draft path included", async () => {
    stampDegradedContext.value = true
    const writes: string[] = []
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) {
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      if (callCount === 2) {
        return createChainMock({ data: { ...DB_APP_ROW, max_runs_per_user_per_day: null }, error: null }) as never
      }
      if (table === "workflows") {
        return createChainMock({ data: { workspace_id: "ws-home" }, error: null }) as never
      }
      if (table === "workflow_executions" || table === "app_runs") {
        writes.push(table)
      }
      return createChainMock({ data: null, error: null }) as never
    })

    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/app/${TEST_SLUG}/run`,
        headers: { "x-user-id": TEST_USER_ID },
        payload: { runId: "00000000-0000-4000-8000-0000000000dd" },
      })
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("billing_unavailable")
      // The refusal preceded EVERY write — no orphaned pending execution
      // to 409-brick the (user, workflow) pair, no flipped draft.
      expect(writes).toEqual([])
      expect(orchestrationQueue.add).not.toHaveBeenCalled()
    } finally {
      stampDegradedContext.value = false
    }
  })
  it("returns 202 on success (creates execution + app_run + enqueues job)", async () => {
    setupSuccessfulRunMocks()

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { inputOverrides: { n1: { prompt: "a cat" } } },
    })

    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.executionId).toBe(TEST_EXECUTION_ID)
    expect(body.runId).toBe(TEST_RUN_ID)
    expect(body.status).toBe("pending")

    expect(orchestrationQueue.add).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({
        executionId: TEST_EXECUTION_ID,
        workflowId: TEST_WORKFLOW_ID,
        userId: TEST_USER_ID,
        triggerType: "app_run",
        inputOverrides: { n1: { prompt: "a cat" } },
        appVersionId: TEST_APP_ID,
      }),
      { jobId: TEST_EXECUTION_ID }
    )
  })

  it("merges flat `inputs` with nested `inputOverrides` (overlay wins per field)", async () => {
    // The SDK's apps.run(slug, inputs, { inputOverrides }) and the CLI's
    // `--input … --override …` send BOTH. Picking one silently ran the app with
    // default prompt text; the two are complementary — flat inputs are the base,
    // the raw nested overrides win field-by-field on top.
    setupSuccessfulRunMocks({
      snapshot_nodes: [
        { id: "n1", type: "text-prompt", data: { label: "Prompt" } },
        { id: "n2", type: "upload-image", data: { label: "Photo" } },
      ],
      snapshot_settings: {
        presentationSettings: {
          inputItems: [
            { type: "node", nodeId: "n1" },
            { type: "node", nodeId: "n2" },
          ],
        },
      },
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        inputs: { prompt: "a cat", photo: "https://r2/photo.jpg" },
        inputOverrides: {
          n1: { promptPrefix: "cinematic still,", promptSuffix: "shot on 35mm" },
          n3: { seed: 7 },
        },
      },
    })

    expect(res.statusCode).toBe(202)
    expect(orchestrationQueue.add).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({
        inputOverrides: {
          n1: {
            text: "a cat",
            promptPrefix: "cinematic still,",
            promptSuffix: "shot on 35mm",
          },
          n2: { url: "https://r2/photo.jpg" },
          n3: { seed: 7 },
        },
      }),
      expect.any(Object)
    )
  })

  it("returns 202 without inputOverrides", async () => {
    setupSuccessfulRunMocks()

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })

    expect(res.statusCode).toBe(202)
    expect(orchestrationQueue.add).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({
        inputOverrides: undefined,
      }),
      expect.any(Object)
    )
  })

  // ── audit 2026-09-06 follow-up: idempotency-key header ──
  it("forwards a well-formed header to the core as the idempotency key and echoes a dedup hit", async () => {
    setupSuccessfulRunMocks()
    mockExecuteAppRun.mockResolvedValueOnce({ executionId: TEST_EXECUTION_ID, appRunId: TEST_RUN_ID, deduped: true })
    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID, "idempotency-key": "mcp:app-retry-01" },
      payload: { inputOverrides: {} },
    })
    expect(res.statusCode).toBe(202)
    expect(mockExecuteAppRun).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "mcp:app-retry-01" }))
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json().deduped).toBe(true)
  })

  it("ignores a header shorter than the minimum key length", async () => {
    setupSuccessfulRunMocks()
    mockExecuteAppRun.mockResolvedValueOnce({ executionId: TEST_EXECUTION_ID, appRunId: TEST_RUN_ID, deduped: false })
    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID, "idempotency-key": "short" },
      payload: { inputOverrides: {} },
    })
    expect(res.statusCode).toBe(202)
    expect(mockExecuteAppRun.mock.calls[0]?.[0]?.idempotencyKey).toBeUndefined()
    expect(res.headers["x-dedup-hit"]).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // The override lock (issue #1555). A published app runs the CREATOR's
  // snapshot and the override map is the STRANGER's — it may not re-point a
  // Webhook Output, a publisher or a scraper. Refused before any row is
  // written; the orchestrator's merge refuses too.
  // -------------------------------------------------------------------------

  it("refuses an override that re-points the snapshot's Webhook Output — 400 locked_field, no row, no run", async () => {
    const writes: string[] = []
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) {
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      if (callCount === 2) {
        return createChainMock({
          data: {
            ...DB_APP_ROW,
            max_runs_per_user_per_day: null,
            snapshot_nodes: [
              { id: "text-1", type: "text-prompt", data: { text: "hello" } },
              { id: "hook-1", type: "webhook-output", data: { url: "https://creator.example/hook" } },
            ],
          },
          error: null,
        }) as never
      }
      if (table === "workflow_executions" || table === "app_runs") writes.push(table)
      return createChainMock({ data: null, error: null }) as never
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        inputOverrides: {
          "text-1": { text: "a legitimate input" },
          "hook-1": { url: "https://attacker.example/collect" },
        },
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("locked_field")
    expect(res.json().error.message).toContain('"url" on webhook-output node "hook-1"')
    expect(res.json().error.message).not.toContain("attacker")
    expect(writes).toEqual([])
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
  })

  it("refuses an injected UGC run state — 400 locked_field, no run", async () => {
    setupSuccessfulRunMocks({
      snapshot_nodes: [{ id: "ugc-1", type: "ugc-creator", data: { source: "sampled", gender: "woman", keepResult: false } }],
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { inputOverrides: { "ugc-1": { keepResult: true } } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("locked_field")
    expect(res.json().error.message).toContain('inputOverrides cannot set "keepResult" on a UGC node "ugc-1".')
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

  it("refuses the flat `inputs` lane the same way once it is translated onto an outbound node", async () => {
    // A publisher cannot expose a destination as an app input today (no
    // INPUT_FIELD_MAP entry, no exposableFields), so a translated flat input
    // never lands on one — but a NESTED override merged over it can. The
    // check runs on the MERGED map, after both lanes are combined.
    setupSuccessfulRunMocks({
      snapshot_nodes: [{ id: "scrape-1", type: "web-scrape", data: { target: "https://creator.example" } }],
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { inputs: {}, inputOverrides: { "scrape-1": { target: "https://attacker.example/?q=secret" } } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("locked_field")
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
  })

})

// ---------------------------------------------------------------------------
// GET /v1/app/:slug/runs
// ---------------------------------------------------------------------------

describe("GET /v1/app/:slug/runs", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 404 when app not found", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: null, error: { message: "not found" } }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with paginated results", async () => {
    const runItem = {
      id: TEST_RUN_ID,
      app_id: TEST_APP_ID,
      created_at: "2026-01-01T12:00:00Z",
      execution_id: TEST_EXECUTION_ID,
      workflow_executions: {
        user_id: TEST_USER_ID,
        workflow_id: TEST_WORKFLOW_ID,
        status: "completed",
        node_states: { n1: { status: "completed" } },
        completed_nodes: 1,
        total_nodes: 1,
        completed_at: "2026-01-01T12:05:00Z",
      },
    }

    let callCount = 0
    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // resolveSlug → workflow_id
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      if (callCount === 2) {
        // All versions by workflow_id
        return createChainMock({ data: [{ id: TEST_APP_ID, version: 1, thumbnail_node_id: null }], error: null }) as never
      }
      // Runs query
      return createChainMock({ data: [runItem], error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe(TEST_RUN_ID)
    expect(body.data[0].executionId).toBe(TEST_EXECUTION_ID)
    expect(body.data[0].status).toBe("completed")
    expect(body.data[0].completedNodes).toBe(1)
    expect(body.data[0].totalNodes).toBe(1)
    expect(body.data[0].createdAt).toBe("2026-01-01T12:00:00Z")
    expect(body.data[0].version).toBe(1)
    expect(body.nextCursor).toBeUndefined()
  })

  it("returns 200 with empty list", async () => {
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // resolveSlug → workflow_id
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      if (callCount === 2) {
        // All versions by workflow_id
        return createChainMock({ data: [{ id: TEST_APP_ID, version: 1, thumbnail_node_id: null }], error: null }) as never
      }
      // Runs query
      return createChainMock({ data: [], error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
    expect(res.json().nextCursor).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// GET /v1/app/:slug/runs/:runId
// ---------------------------------------------------------------------------

describe("GET /v1/app/:slug/runs/:runId", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 for invalid runId (not UUID)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs/not-a-uuid`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 when run not found", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: null, error: { code: "PGRST116", message: "not found" } }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with execution data", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: DB_RUN_ROW, error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.id).toBe(TEST_RUN_ID)
    expect(body.appId).toBe(TEST_APP_ID)
    expect(body.executionId).toBe(TEST_EXECUTION_ID)
    expect(body.createdAt).toBe("2026-01-01T12:00:00Z")
    expect(body.version).toBe(1)
    // Verify execution sub-object is camelCased
    expect(body.execution).toBeDefined()
    expect(body.execution.id).toBe(TEST_EXECUTION_ID)
    expect(body.execution.status).toBe("completed")
    expect(body.execution.nodeStates).toEqual({ n1: { status: "completed" } })
    expect(body.execution.totalNodes).toBe(1)
    expect(body.execution.completedNodes).toBe(1)
    expect(body.execution.failedNodes).toBe(0)
    expect(body.execution.totalCreditsUsed).toBe(5)
    expect(body.execution.errorMessage).toBeNull()
    expect(body.execution.completedAt).toBe("2026-01-01T12:05:00Z")
  })

  it("returns 200 with null execution when not joined", async () => {
    const runWithoutExec = {
      ...DB_RUN_ROW,
      published_apps: { version: 1 },
      workflow_executions: null,
    }

    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: runWithoutExec, error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().execution).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// A run's execution is the runner's own (decided 2026-10-06)
// ---------------------------------------------------------------------------

describe("a run shows only an execution its runner owns", () => {
  /** Another user, whose execution a run row must never surface. */
  const VICTIM_ID = "00000000-0000-4000-8000-0000000000a1"
  const VICTIM_SECRET = "https://r2.example/victim-only.png"
  const victimExecution = {
    ...DB_RUN_ROW.workflow_executions,
    user_id: VICTIM_ID,
    node_states: { n1: { status: "completed", output: { url: VICTIM_SECRET } } },
  }

  it("attacker: a run row pointing at another user's execution answers 404 with no data", async () => {
    // User B (TEST_USER_ID) owns the run row; its execution_id names user A's execution.
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: { ...DB_RUN_ROW, workflow_executions: victimExecution }, error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(res.body).not.toContain(VICTIM_SECRET)
    expect(res.body).not.toContain(TEST_EXECUTION_ID)
  })

  it("an execution of another workflow than the app's answers 404", async () => {
    const otherWorkflow = { ...DB_RUN_ROW.workflow_executions, workflow_id: "00000000-0000-4000-8000-0000000000b2" }
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: { ...DB_RUN_ROW, workflow_executions: otherWorkflow }, error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
  })

  it("the run list leaves out a row whose execution is not the runner's", async () => {
    const own = {
      id: TEST_RUN_ID,
      app_id: TEST_APP_ID,
      created_at: "2026-01-01T12:00:00Z",
      execution_id: TEST_EXECUTION_ID,
      workflow_executions: { ...DB_RUN_ROW.workflow_executions },
    }
    const forged = {
      ...own,
      id: "00000000-0000-4000-8000-0000000000c3",
      workflow_executions: victimExecution,
    }
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation(() => {
      callCount++
      if (callCount === 1) return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      if (callCount === 2) {
        return createChainMock({ data: [{ id: TEST_APP_ID, version: 1, thumbnail_node_id: "n1" }], error: null }) as never
      }
      return createChainMock({ data: [forged, own], error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((r: { id: string }) => r.id)).toEqual([TEST_RUN_ID])
    expect(res.body).not.toContain(VICTIM_SECRET)
  })

  it("the archive leaves out a row whose execution is not the runner's", async () => {
    const base = {
      app_id: TEST_APP_ID,
      created_at: "2026-01-01T12:00:00Z",
      deleted_at: "2026-01-02T12:00:00Z",
      execution_id: TEST_EXECUTION_ID,
      published_apps: { slug: TEST_SLUG, name: "App", icon_url: null, version: 1, thumbnail_node_id: "n1", workflow_id: TEST_WORKFLOW_ID },
    }
    const own = { ...base, id: TEST_RUN_ID, runner_id: TEST_USER_ID, workflow_executions: { ...DB_RUN_ROW.workflow_executions } }
    const forged = { ...base, id: "00000000-0000-4000-8000-0000000000c4", runner_id: TEST_USER_ID, workflow_executions: victimExecution }
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: [forged, own], error: null }) as never
    })

    const res = await app.inject({
      method: "GET",
      url: "/v1/me/archived-runs",
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((r: { id: string }) => r.id)).toEqual([TEST_RUN_ID])
    expect(res.body).not.toContain(VICTIM_SECRET)
  })

  it("the PATCH writes only its allowlisted columns — server-owned fields in the body are ignored", async () => {
    const updates: unknown[] = []
    vi.mocked(supabase.from).mockImplementation(() => {
      const chain = createChainMock({ data: { id: TEST_RUN_ID, name: "Renamed" }, error: null })
      return {
        update: (payload: unknown) => {
          updates.push(payload)
          return chain
        },
      } as never
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Renamed",
        executionId: TEST_EXECUTION_ID,
        execution_id: TEST_EXECUTION_ID,
        runnerId: VICTIM_ID,
        runner_id: VICTIM_ID,
        appId: TEST_APP_ID,
        status: "completed",
        creditsUsed: 0,
        deletedAt: null,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(updates).toEqual([{ name: "Renamed" }])
  })

  it("a PATCH that names only server-owned fields changes nothing (400)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { executionId: TEST_EXECUTION_ID, execution_id: TEST_EXECUTION_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe("the draft lane writes an execution only onto a run of this app", () => {
  const OLD_VERSION_ID = "00000000-0000-4000-8000-000000000011"
  const OTHER_APP_ID = "00000000-0000-4000-8000-0000000000e1"

  /**
   * A table-aware mock that APPLIES the route's filters (eq / in / is) to a
   * stored row, so a missing scope shows up as a wrong write — the plain
   * chain mock ignores every argument.
   */
  function setupDraftLane(run: Record<string, unknown>) {
    const runs = new Map<string, Record<string, unknown>>([[run.id as string, { ...run }]])
    const executionInserts: unknown[] = []
    const runUpdates: unknown[] = []
    const versions = [
      { id: TEST_APP_ID, workflow_id: TEST_WORKFLOW_ID, deleted_at: null },
      { id: OLD_VERSION_ID, workflow_id: TEST_WORKFLOW_ID, deleted_at: null },
      { id: OTHER_APP_ID, workflow_id: "00000000-0000-4000-8000-0000000000e2", deleted_at: null },
    ]
    function chain(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      let op: "select" | "insert" | "update" = "select"
      let payload: Record<string, unknown> | undefined
      const rowsOf = (): Array<Record<string, unknown>> =>
        table === "app_runs" ? [...runs.values()] : table === "published_apps" ? versions : []
      const resolve = (single: boolean) => {
        if (table === "workflow_executions") {
          if (op === "insert") executionInserts.push(payload)
          return { data: { id: TEST_EXECUTION_ID }, error: null }
        }
        if (table === "published_apps" && single) {
          return { data: { ...DB_APP_ROW, max_runs_per_user_per_day: null }, error: null }
        }
        const matched = rowsOf().filter((r) => filters.every((f) => f(r)))
        if (table === "app_runs" && op === "update") {
          for (const r of matched) {
            runUpdates.push(payload)
            runs.set(r.id as string, { ...r, ...payload })
          }
        }
        if (single) return matched.length === 1 ? { data: matched[0], error: null } : { data: null, error: { code: "PGRST116" } }
        return { data: matched, error: null }
      }
      const c: Record<string, unknown> = {
        select: () => c,
        insert: (p: Record<string, unknown>) => { op = "insert"; payload = p; return c },
        update: (p: Record<string, unknown>) => { op = "update"; payload = p; return c },
        eq: (col: string, v: unknown) => { filters.push((r) => r[col] === undefined || r[col] === v); return c },
        in: (col: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[col])); return c },
        is: (col: string, v: unknown) => { filters.push((r) => (r[col] ?? null) === v); return c },
        order: () => c,
        limit: () => c,
        single: async () => resolve(true),
        maybeSingle: async () => {
          const r = resolve(true)
          return r.data ? r : { data: null, error: null }
        },
        then: (ok: (v: unknown) => void) => ok(resolve(false)),
      }
      return c
    }
    vi.mocked(supabase.from).mockImplementation(((table: string) => chain(table)) as never)
    return { runs, executionInserts, runUpdates }
  }

  const runRow = (overrides: Record<string, unknown>) => ({
    id: TEST_RUN_ID,
    app_id: TEST_APP_ID,
    runner_id: TEST_USER_ID,
    execution_id: null,
    status: "draft",
    deleted_at: null,
    ...overrides,
  })

  const post = () =>
    app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { runId: TEST_RUN_ID },
    })

  it("a runId from another app answers 404, leaves the row unchanged, and starts no execution", async () => {
    const before = runRow({ app_id: OTHER_APP_ID, status: "completed", execution_id: "00000000-0000-4000-8000-0000000000e3" })
    const { runs, executionInserts, runUpdates } = setupDraftLane(before)

    const res = await post()

    expect(res.statusCode).toBe(404)
    expect(runUpdates).toEqual([])
    expect(runs.get(TEST_RUN_ID)).toEqual(before)
    // Checked before the execution row is written — no orphaned pending execution.
    expect(executionInserts).toEqual([])
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
  })

  it("a draft made on an older version of the same app still runs", async () => {
    const { runs, executionInserts } = setupDraftLane(runRow({ app_id: OLD_VERSION_ID }))

    const res = await post()

    expect(res.statusCode).toBe(202)
    expect(executionInserts).toHaveLength(1)
    expect(runs.get(TEST_RUN_ID)).toMatchObject({ execution_id: TEST_EXECUTION_ID, status: "running" })
  })

  it("someone else's run answers 404 and starts no execution", async () => {
    const before = runRow({ runner_id: "00000000-0000-4000-8000-0000000000a9" })
    const { runs, executionInserts } = setupDraftLane(before)

    const res = await post()

    expect(res.statusCode).toBe(404)
    expect(runs.get(TEST_RUN_ID)).toEqual(before)
    expect(executionInserts).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DELETE /v1/app/:slug/runs/:runId
// ---------------------------------------------------------------------------

describe("DELETE /v1/app/:slug/runs/:runId", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 for invalid runId (not UUID)", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/app/${TEST_SLUG}/runs/not-a-uuid`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 when run not found", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: null, error: { code: "PGRST116", message: "not found" } }) as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with archived: true on successful soft-delete", async () => {
    // Soft-delete is a single update-and-return-row call.
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: { id: TEST_RUN_ID }, error: null }) as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(res.json().archived).toBe(true)
  })

  it("returns 404 when run is already archived (idempotent guard)", async () => {
    // The update path filters `.is(deleted_at, null)`, so an already-archived
    // run produces an empty update result that we surface as 404.
    vi.mocked(supabase.from).mockImplementation(() => {
      return createChainMock({ data: null, error: { code: "PGRST116", message: "no rows" } }) as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })
})

