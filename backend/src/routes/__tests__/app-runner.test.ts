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

import { appRunnerRoutes } from "../app-runner.js"
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
// GET /v1/app/:slug
// ---------------------------------------------------------------------------

describe("GET /v1/app/:slug", () => {
  it("returns 404 when app not found", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}`,
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 404 when app is inactive (error from supabase)", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "no rows" },
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}`,
    })

    expect(res.statusCode).toBe(404)
  })

  it("returns 200 with camelCase response on success", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: DB_APP_ROW,
      error: null,
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

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
    // Ensure no snake_case keys leaked
    expect(body.icon_url).toBeUndefined()
    expect(body.snapshot_nodes).toBeUndefined()
    expect(body.creator_id).toBeUndefined()
  })

  it("does not require auth", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: DB_APP_ROW,
      error: null,
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

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
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "not found" },
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

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
    let appRunsCallCount = 0

    // Mock supabase.from to handle multiple tables
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { ...DB_APP_ROW, max_runs_per_user_per_day: 5 },
          error: null,
        })
        const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      if (table === "app_runs") {
        appRunsCallCount++
        if (appRunsCallCount <= 1) {
          // Rate limit check: select("id", { count: "exact", head: true }).eq(app_id).eq(runner_id).gte(created_at)
          const mockGte = vi.fn().mockResolvedValue({
            count: 5,
            data: null,
            error: null,
          })
          const mockEq2 = vi.fn().mockReturnValue({ gte: mockGte })
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
          return { select: mockSelect } as never
        }
        // Active execution check: select(...).eq(app_id).eq(runner_id).in(status).limit(1)
        const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
        const mockIn = vi.fn().mockReturnValue({ limit: mockLimit })
        const mockEq2 = vi.fn().mockReturnValue({ in: mockIn })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      return {} as never
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

  it("returns 409 when already running", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { ...DB_APP_ROW, max_runs_per_user_per_day: null },
          error: null,
        })
        const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      if (table === "app_runs") {
        // Active execution check via app_runs join — returns active run
        const mockLimit = vi.fn().mockResolvedValue({
          data: [{ execution_id: TEST_EXECUTION_ID }],
          error: null,
        })
        const mockIn = vi.fn().mockReturnValue({ limit: mockLimit })
        const mockEq2 = vi.fn().mockReturnValue({ in: mockIn })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      return {} as never
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/app/${TEST_SLUG}/run`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("already_running")
    expect(res.json().executionId).toBe(TEST_EXECUTION_ID)
  })

  function setupSuccessfulRunMocks() {
    let appRunsCallCount = 0

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { ...DB_APP_ROW, max_runs_per_user_per_day: null },
          error: null,
        })
        const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      if (table === "app_runs") {
        appRunsCallCount++
        if (appRunsCallCount <= 1) {
          // Active execution check via join — no active runs
          const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null })
          const mockIn = vi.fn().mockReturnValue({ limit: mockLimit })
          const mockEq2 = vi.fn().mockReturnValue({ in: mockIn })
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
          return { select: mockSelect } as never
        }
        // Insert app_run
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_RUN_ID },
          error: null,
        })
        const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
        const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
        return { insert: mockInsert } as never
      }
      if (table === "workflow_executions") {
        // Insert execution
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_EXECUTION_ID },
          error: null,
        })
        const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
        const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
        return { insert: mockInsert } as never
      }
      return {} as never
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
        triggerType: "manual",
        inputOverrides: { n1: { prompt: "a cat" } },
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
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        const mockSingle = vi.fn().mockResolvedValue({
          data: null,
          error: { message: "not found" },
        })
        const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      return {} as never
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

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_APP_ID },
          error: null,
        })
        const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      if (table === "app_runs") {
        // The query chain: select -> eq(app_id) -> eq(runner_id) -> order -> limit
        const mockLimit = vi.fn().mockResolvedValue({
          data: [runItem],
          error: null,
        })
        const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
        const mockEq2 = vi.fn().mockReturnValue({ order: mockOrder })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      return {} as never
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
    expect(body.nextCursor).toBeUndefined()
  })

  it("returns 200 with empty list", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        const mockSingle = vi.fn().mockResolvedValue({
          data: { id: TEST_APP_ID },
          error: null,
        })
        const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      if (table === "app_runs") {
        const mockLimit = vi.fn().mockResolvedValue({
          data: [],
          error: null,
        })
        const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit })
        const mockEq2 = vi.fn().mockReturnValue({ order: mockOrder })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      return {} as never
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
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with execution data", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: DB_RUN_ROW,
      error: null,
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

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
      workflow_executions: null,
    }

    const mockSingle = vi.fn().mockResolvedValue({
      data: runWithoutExec,
      error: null,
    })
    const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

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
    // First call: find run (ownership check)
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "app_runs") {
        const mockSingle = vi.fn().mockResolvedValue({
          data: null,
          error: { code: "PGRST116", message: "not found" },
        })
        const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { select: mockSelect } as never
      }
      return {} as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 on successful delete", async () => {
    let deleteCallCount = 0

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "app_runs") {
        deleteCallCount++
        if (deleteCallCount <= 1) {
          // First call: ownership check (select)
          const mockSingle = vi.fn().mockResolvedValue({
            data: { id: TEST_RUN_ID },
            error: null,
          })
          const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
          return { select: mockSelect } as never
        }
        // Second call: actual delete
        const mockEq2 = vi.fn().mockResolvedValue({ error: null })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { delete: mockDelete } as never
      }
      return {} as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns 500 when delete fails", async () => {
    let deleteCallCount = 0

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "app_runs") {
        deleteCallCount++
        if (deleteCallCount <= 1) {
          // Ownership check succeeds
          const mockSingle = vi.fn().mockResolvedValue({
            data: { id: TEST_RUN_ID },
            error: null,
          })
          const mockEq2 = vi.fn().mockReturnValue({ single: mockSingle })
          const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
          return { select: mockSelect } as never
        }
        // Delete fails
        const mockEq2 = vi.fn().mockResolvedValue({
          error: { message: "FK constraint" },
        })
        const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
        const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 })
        return { delete: mockDelete } as never
      }
      return {} as never
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/app/${TEST_SLUG}/runs/${TEST_RUN_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})
