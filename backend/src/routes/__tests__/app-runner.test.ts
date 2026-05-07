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

beforeEach(async () => {
  vi.clearAllMocks()
  invalidateAppCache(TEST_SLUG)

  app = Fastify({ logger: false })

  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
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

  function setupSuccessfulRunMocks() {
    let callCount = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) {
        // Slug lookup
        return createChainMock({ data: { workflow_id: TEST_WORKFLOW_ID }, error: null }) as never
      }
      if (callCount === 2) {
        // Version lookup
        return createChainMock({ data: { ...DB_APP_ROW, max_runs_per_user_per_day: null }, error: null }) as never
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
