import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const { mockOrchestrationQueueAdd, mockTryRemoveFromQueue, mockCheckIsAdmin } = vi.hoisted(() => ({
  mockOrchestrationQueueAdd: vi.fn().mockResolvedValue({ id: "orch-job-1" }),
  mockTryRemoveFromQueue: vi.fn().mockResolvedValue(undefined),
  mockCheckIsAdmin: vi.fn().mockResolvedValue(false),
}))

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
  checkIsAdmin: mockCheckIsAdmin,
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: {
    add: mockOrchestrationQueueAdd,
  },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
    getJob: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  renderQueue: {
    add: vi.fn().mockResolvedValue({ id: "render-job-1" }),
  },
  redis: {},
  tryRemoveFromQueue: mockTryRemoveFromQueue,
}))

vi.mock("@/lib/sse.js", () => ({
  createSSEStream: vi.fn().mockReturnValue({
    sendEvent: vi.fn(),
    sendComment: vi.fn(),
    close: vi.fn(),
    isClosed: false,
  }),
}))

vi.mock("@/lib/execution-events.js", () => ({
  executionEvents: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}))

const mockRefundCredits = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockInvalidateBalanceCache = vi.hoisted(() => vi.fn())

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { refundCredits: mockRefundCredits },
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidateBalanceCache,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { workflowExecutionRoutes, toExecutionSummary } from "../workflow-execution.js"
import { supabase } from "../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TEST_EXEC_ID = "00000000-0000-4000-8000-000000000060"
const TEST_JOB_ID = "00000000-0000-4000-8000-000000000070"

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
    await workflowExecutionRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authedPost(url: string, payload: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url,
    headers: { "x-user-id": TEST_USER_ID },
    payload,
  })
}

function authedGet(url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-user-id": TEST_USER_ID },
  })
}

// ==========================================================================
// POST /v1/workflows/:id/run
// ==========================================================================

describe("POST /v1/workflows/:id/run", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/run`,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await authedPost("/v1/workflows/not-a-uuid/run")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 404 when workflow not found", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: "PGRST116", message: "not found" },
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 409 when workflow already running", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        // Workflow lookup
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_WORKFLOW_ID, user_id: TEST_USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      // Active execution check
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ id: TEST_EXEC_ID }],
                error: null,
              }),
            }),
          }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("already_running")
    expect(res.json().executionId).toBe(TEST_EXEC_ID)
  })

  it("returns 202 on success and enqueues orchestration job", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        // Workflow lookup
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_WORKFLOW_ID, user_id: TEST_USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      if (callNum === 2) {
        // Active execution check — no active
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      // Create execution — via insertWithIdempotencyKey. With no
      // Idempotency-Key header in the test request, the helper takes
      // the plain-INSERT branch (no key = no dedup). Mock both chains
      // for robustness — `upsert` path is exercised when the test sends
      // a header.
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: TEST_EXEC_ID },
              error: null,
            }),
          }),
        }),
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: TEST_EXEC_ID }],
            error: null,
          }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`)
    expect(res.statusCode).toBe(202)
    expect(res.json().executionId).toBe(TEST_EXEC_ID)
    expect(res.json().status).toBe("pending")

    expect(mockOrchestrationQueueAdd).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({
        executionId: TEST_EXEC_ID,
        workflowId: TEST_WORKFLOW_ID,
        userId: TEST_USER_ID,
        triggerType: "manual",
      }),
      expect.objectContaining({ jobId: TEST_EXEC_ID }),
    )
  })

  it("forwards inputOverrides into the enqueued job (was silently dropped)", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_WORKFLOW_ID, user_id: TEST_USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      if (callNum === 2) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        } as never
      }
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: TEST_EXEC_ID }, error: null }),
          }),
        }),
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: TEST_EXEC_ID }], error: null }),
        }),
      } as never
    })

    const overrides = { "node-1": { prompt: "overridden at run time" } }
    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`, {
      inputOverrides: overrides,
    })
    expect(res.statusCode).toBe(202)

    // Regression: MCP run_workflow (and the editor/SDK) send per-node overrides;
    // the route used to drop them, so the run used the workflow's saved data.
    expect(mockOrchestrationQueueAdd).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({ inputOverrides: overrides }),
      expect.objectContaining({ jobId: TEST_EXEC_ID }),
    )
  })

  // -------------------------------------------------------------------------
  // inputOverrides normalization (MCP run_workflow flat shape)
  //
  // The MCP `run_workflow` tool advertises `inputs: Record<nodeId, unknown>`
  // and forwards it verbatim as `inputOverrides`, so a natural call sends a
  // SCALAR or ARRAY per node id ({ "node-1": "blue car" }). The route's old
  // strict nested schema rejected that and dropped the ENTIRE map. These
  // tests pin the per-entry normalization to the nested
  // `{ nodeId: { field: value } }` shape the orchestrator consumes.
  // -------------------------------------------------------------------------

  /**
   * Build the supabase.from() mock for a successful run, with the workflow
   * lookup returning the given `nodes` graph (so the route can resolve each
   * node's primary input field).
   */
  function mockRunWithGraph(nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>) {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        // Workflow lookup — now also selects `nodes`.
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_WORKFLOW_ID, user_id: TEST_USER_ID, nodes },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      if (callNum === 2) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        } as never
      }
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: TEST_EXEC_ID }, error: null }),
          }),
        }),
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: TEST_EXEC_ID }], error: null }),
        }),
      } as never
    })
  }

  function enqueuedJob(): Record<string, unknown> {
    return mockOrchestrationQueueAdd.mock.calls[0]?.[1] as Record<string, unknown>
  }

  it("normalizes a FLAT scalar override into the node's primary field (MCP shape)", async () => {
    mockRunWithGraph([{ id: "text-1", type: "text-prompt", data: {} }])

    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`, {
      inputOverrides: { "text-1": "blue car" },
    })
    expect(res.statusCode).toBe(202)

    // text-prompt's primary input field is `text` (INPUT_FIELD_MAP).
    expect(enqueuedJob().inputOverrides).toEqual({ "text-1": { text: "blue car" } })
  })

  it("normalizes a FLAT scalar override for an upload-image node into `url`", async () => {
    mockRunWithGraph([{ id: "img-1", type: "upload-image", data: {} }])

    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`, {
      inputOverrides: { "img-1": "https://cdn/blue-car.png" },
    })
    expect(res.statusCode).toBe(202)

    expect(enqueuedJob().inputOverrides).toEqual({
      "img-1": { url: "https://cdn/blue-car.png" },
    })
  })

  it("wraps a FLAT array override into a single-column list node's `items` field", async () => {
    mockRunWithGraph([{ id: "list-1", type: "list", data: {} }])

    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`, {
      inputOverrides: { "list-1": ["a", "b", "c"] },
    })
    expect(res.statusCode).toBe(202)

    // single-column list → `items` (resolveListInfo).
    expect(enqueuedJob().inputOverrides).toEqual({
      "list-1": { items: ["a", "b", "c"] },
    })
  })

  it("preserves an already-NESTED override verbatim (editor/SDK shape)", async () => {
    mockRunWithGraph([{ id: "node-1", type: "generate-image", data: {} }])

    const overrides = { "node-1": { prompt: "x" } }
    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`, {
      inputOverrides: overrides,
    })
    expect(res.statusCode).toBe(202)

    expect(enqueuedJob().inputOverrides).toEqual(overrides)
  })

  it("keeps valid overrides when one entry is BAD — a single bad entry never drops the whole map", async () => {
    mockRunWithGraph([{ id: "text-1", type: "text-prompt", data: {} }])

    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`, {
      inputOverrides: {
        "text-1": "blue car", // valid scalar → resolves to { text }
        "ghost-1": "dropped", // unknown node id → no graph node → dropped
      },
    })
    expect(res.statusCode).toBe(202)

    // The valid entry survives; the unknown-node entry is dropped (not thrown,
    // not nuking the whole map — the old strict schema dropped EVERYTHING).
    expect(enqueuedJob().inputOverrides).toEqual({ "text-1": { text: "blue car" } })
  })

  it("returns 500 when execution insert fails", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_WORKFLOW_ID, user_id: TEST_USER_ID },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      if (callNum === 2) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "insert failed" },
            }),
          }),
        }),
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "insert failed" },
          }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflows/${TEST_WORKFLOW_ID}/run`)
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

// ==========================================================================
// GET /v1/workflow-executions/:id
// ==========================================================================

describe("GET /v1/workflow-executions/:id", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow-executions/${TEST_EXEC_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await authedGet("/v1/workflow-executions/not-a-uuid")
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 when execution not found", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockImplementation((table) => {
      if (table === "workflow_executions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "PGRST116", message: "not found" },
                }),
              }),
            }),
          }),
        } as never
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "PGRST116", message: "not found" },
                }),
              }),
            }),
          }),
        }),
      } as never
    })

    const res = await authedGet(`/v1/workflow-executions/${TEST_EXEC_ID}`)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 200 with execution data", async () => {
    const executionRow = {
      id: TEST_EXEC_ID,
      workflow_id: TEST_WORKFLOW_ID,
      user_id: TEST_USER_ID,
      status: "running",
      trigger_type: "manual",
      trigger_data: null,
      node_states: {},
      total_nodes: 3,
      completed_nodes: 1,
      failed_nodes: 0,
      total_credits_used: 5,
      error_message: null,
      started_at: "2026-01-01T00:01:00Z",
      completed_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:01:00Z",
    }

    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: executionRow,
              error: null,
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet(`/v1/workflow-executions/${TEST_EXEC_ID}`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.id).toBe(TEST_EXEC_ID)
    expect(data.workflowId).toBe(TEST_WORKFLOW_ID)
    expect(data.status).toBe("running")
    expect(data.triggerType).toBe("manual")
    expect(data.totalNodes).toBe(3)
    expect(data.completedNodes).toBe(1)
  })

  it("falls back to standalone jobs when no workflow_execution exists", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockImplementation((table) => {
      if (table === "workflow_executions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "PGRST116", message: "not found" },
                }),
              }),
            }),
          }),
        } as never
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: TEST_JOB_ID,
                    workflow_id: TEST_WORKFLOW_ID,
                    user_id: TEST_USER_ID,
                    workflow_execution_id: null,
                    status: "processing",
                    provider: "web-scrape",
                    input_data: { type: "web-scrape", actor: "rss" },
                    credits: 3,
                    error_message: null,
                    started_at: "2026-01-01T00:01:00Z",
                    completed_at: null,
                    created_at: "2026-01-01T00:00:00Z",
                    updated_at: "2026-01-01T00:01:30Z",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      } as never
    })

    const res = await authedGet(`/v1/workflow-executions/${TEST_JOB_ID}`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.id).toBe(TEST_JOB_ID)
    expect(data.workflowId).toBe(TEST_WORKFLOW_ID)
    expect(data.status).toBe("running")
    expect(data.triggerType).toBe("single-node")
    expect(data.totalNodes).toBe(1)
    expect(data.nodeStates[TEST_JOB_ID].jobId).toBe(TEST_JOB_ID)
  })
})

// ==========================================================================
// POST /v1/workflow-executions/:id/cancel
// ==========================================================================

describe("POST /v1/workflow-executions/:id/cancel", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/workflow-executions/${TEST_EXEC_ID}/cancel`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await authedPost(`/v1/workflow-executions/not-a-uuid/cancel`)
    expect(res.statusCode).toBe(400)
  })

  it("returns 409 when execution is already completed", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: TEST_EXEC_ID, status: "completed" },
              error: null,
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedPost(`/v1/workflow-executions/${TEST_EXEC_ID}/cancel`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_cancellable")
  })

  it("returns success for pending execution (immediate cancel)", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        // Select execution
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_EXEC_ID, status: "pending" },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      if (callNum === 2) {
        // Update execution status
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        } as never
      }
      // Active jobs query (fire-and-forget)
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflow-executions/${TEST_EXEC_ID}/cancel`)
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns success with after_current mode (stopping)", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_EXEC_ID, status: "running" },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflow-executions/${TEST_EXEC_ID}/cancel`, {
      mode: "after_current",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("returns success with discard mode, writes status discarded, and does NOT cancel/refund jobs", async () => {
    const mockFrom = vi.mocked(supabase.from)
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    let callNum = 0
    mockFrom.mockImplementation((table: string) => {
      callNum++
      if (callNum === 1) {
        // Select execution
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_EXEC_ID, status: "running" },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      if (callNum === 2) {
        // Update execution status — capture for assertion
        expect(table).toBe("workflow_executions")
        return { update: updateSpy } as never
      }
      // No further DB calls expected for discard (no jobs query)
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: null }),
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflow-executions/${TEST_EXEC_ID}/cancel`, {
      mode: "discard",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)

    // The execution UPDATE must set status:"discarded" (no completed_at).
    expect(updateSpy).toHaveBeenCalledTimes(1)
    const updatePayload = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(updatePayload.status).toBe("discarded")
    expect(updatePayload).not.toHaveProperty("completed_at")

    // Let the (non-existent) fire-and-forget microtask drain to be safe.
    await new Promise((r) => setImmediate(r))

    // CRITICAL: discard must NOT cancel in-flight jobs or refund credits.
    // Only two `from()` calls happen (select execution + update execution).
    expect(mockFrom).toHaveBeenCalledTimes(2)
    expect(mockRefundCredits).not.toHaveBeenCalled()
    expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
  })

  it("returns 400 for an unknown cancel mode", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: TEST_EXEC_ID, status: "running" },
              error: null,
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedPost(`/v1/workflow-executions/${TEST_EXEC_ID}/cancel`, {
      mode: "destroy",
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("bad_request")
  })

  it("falls back to cancelling a standalone job", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        // Execution not found
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "PGRST116", message: "not found" },
                }),
              }),
            }),
          }),
        } as never
      }
      if (callNum === 2) {
        // Job lookup
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: TEST_JOB_ID, status: "pending" },
                  error: null,
                }),
              }),
            }),
          }),
        } as never
      }
      if (callNum === 3) {
        // Job update — CAS chain (audit D2): update().eq(id).in(status).select(id)
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({ data: [{ id: TEST_JOB_ID }], error: null }),
              }),
            }),
          }),
        } as never
      }
      // Call 4: usage_logs lookup for refund (added by workflow-cancel
      // credit-refund fix). Return no rows so refund is a no-op.
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflow-executions/${TEST_JOB_ID}/cancel`)
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it("refunds reserved credits when cancelling a standalone job (regression: was silent leak)", async () => {
    // Mirror of cancel-jobs.ts #1508 — this parallel cancel route had the
    // same gap: marked job cancelled without refunding the usage_log hold.
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }) }) }) }) } as never
      }
      if (callNum === 2) {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: TEST_JOB_ID, status: "pending" }, error: null }) }) }) }) } as never
      }
      if (callNum === 3) {
        // CAS chain (audit D2): update().eq(id).in(status).select(id)
        return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: TEST_JOB_ID }], error: null }) }) }) }) } as never
      }
      // Call 4: usage_logs lookup — return one reserved hold for this job.
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ id: "usage-log-1" }], error: null }),
          }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflow-executions/${TEST_JOB_ID}/cancel`)
    expect(res.statusCode).toBe(200)
    // CRITICAL: the reserved credit hold MUST be refunded — this is the
    // financial leak the route previously suffered.
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(TEST_USER_ID)
  })

  it("returns 404 when neither execution nor job found", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: "PGRST116", message: "not found" },
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedPost(`/v1/workflow-executions/${TEST_EXEC_ID}/cancel`)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 409 when standalone job already completed", async () => {
    const mockFrom = vi.mocked(supabase.from)
    let callNum = 0
    mockFrom.mockImplementation(() => {
      callNum++
      if (callNum === 1) {
        // Execution not found
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "PGRST116", message: "not found" },
                }),
              }),
            }),
          }),
        } as never
      }
      // Job found but completed
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: TEST_JOB_ID, status: "completed" },
                error: null,
              }),
            }),
          }),
        }),
      } as never
    })

    const res = await authedPost(`/v1/workflow-executions/${TEST_JOB_ID}/cancel`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_cancellable")
  })
})

// ==========================================================================
// GET /v1/workflows/:id/executions
// ==========================================================================

describe("GET /v1/workflows/:id/executions", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${TEST_WORKFLOW_ID}/executions`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid workflow UUID", async () => {
    const res = await authedGet("/v1/workflows/not-a-uuid/executions")
    expect(res.statusCode).toBe(400)
  })

  it("returns 200 with empty list", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet(`/v1/workflows/${TEST_WORKFLOW_ID}/executions`)
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it("returns 200 with execution summaries", async () => {
    const execRow = {
      id: TEST_EXEC_ID,
      status: "completed",
      trigger_type: "manual",
      node_states: {},
      total_nodes: 2,
      completed_nodes: 2,
      failed_nodes: 0,
      total_credits_used: 10,
      error_message: null,
      started_at: "2026-01-01T00:01:00Z",
      completed_at: "2026-01-01T00:05:00Z",
      created_at: "2026-01-01T00:00:00Z",
    }

    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [execRow],
                error: null,
              }),
            }),
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet(`/v1/workflows/${TEST_WORKFLOW_ID}/executions`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(TEST_EXEC_ID)
    expect(data[0].status).toBe("completed")
    expect(data[0].triggerType).toBe("manual")
    expect(data[0].totalNodes).toBe(2)
  })

  it("maps standalone job statuses correctly", async () => {
    const jobRow = {
      id: TEST_JOB_ID,
      status: "processing",
      input_data: { type: "generate-image" },
      credits: 4,
      error_message: null,
      started_at: "2026-01-01T00:01:00Z",
      completed_at: null,
      created_at: "2026-01-01T00:00:00Z",
    }

    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
            is: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [jobRow],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet(`/v1/workflows/${TEST_WORKFLOW_ID}/executions`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toHaveLength(1)
    // "processing" maps to "running"
    expect(data[0].status).toBe("running")
    expect(data[0].triggerType).toBe("single-node")
    expect(data[0].totalNodes).toBe(1)
  })
})

// ==========================================================================
// GET /v1/executions (global)
// ==========================================================================

describe("GET /v1/executions", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/executions",
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 200 with empty list", async () => {
    const emptyResult = { data: [], error: null }
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockImplementation((table: string) => {
      if (table === "workflow_executions") {
        // select().order().limit().eq()  — non-admin adds user_id filter after limit
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(emptyResult),
              }),
            }),
          }),
        } as never
      }
      if (table === "jobs") {
        // select().is().not().order().limit().eq()
        return {
          select: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue(emptyResult),
                  }),
                }),
              }),
            }),
          }),
        } as never
      }
      return {} as never
    })

    const res = await authedGet("/v1/executions")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it("returns 403 when non-admin tries viewAll", async () => {
    mockCheckIsAdmin.mockResolvedValueOnce(false)

    const res = await authedGet("/v1/executions?viewAll=true")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("allows admin viewAll", async () => {
    mockCheckIsAdmin.mockResolvedValueOnce(true)

    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
        is: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          }),
        }),
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
          is: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    } as never)

    const res = await authedGet("/v1/executions?viewAll=true")
    expect(res.statusCode).toBe(200)
    expect(mockCheckIsAdmin).toHaveBeenCalledWith(TEST_USER_ID)
  })
})

// ==========================================================================
// GET /v1/workflow-executions/:id/stream (SSE)
// ==========================================================================

describe("GET /v1/workflow-executions/:id/stream", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/workflow-executions/${TEST_EXEC_ID}/stream`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 for invalid UUID", async () => {
    const res = await authedGet("/v1/workflow-executions/not-a-uuid/stream")
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 when neither execution nor job matches", async () => {
    // The fallback chain has 3 .eq() / .is() calls before .single() (jobs path)
    // vs 2 .eq() before .single() (workflow_executions path). Building separate
    // mock chains: workflow_executions returns null+error, then jobs path is
    // ALSO checked and ALSO null.
    const nullMiss = {
      data: null,
      error: { code: "PGRST116", message: "not found" },
    }
    const wfChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(nullMiss),
          }),
        }),
      }),
    }
    const jobsChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(nullMiss),
            }),
          }),
        }),
      }),
    }
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockImplementation((table: string) => {
      if (table === "workflow_executions") return wfChain as never
      if (table === "jobs") return jobsChain as never
      return wfChain as never
    })

    const res = await authedGet(`/v1/workflow-executions/${TEST_EXEC_ID}/stream`)
    expect(res.statusCode).toBe(404)
  })

  it("falls back to jobs when id is a standalone single-node job (no more SSE 404 spam)", async () => {
    // Reconcile blind-spot regression: the executions-list endpoint merges
    // jobs into the surface, so any job_id can land at /stream. The old
    // SSE route only checked workflow_executions and 404'd standalone jobs,
    // flooding the editor devtools on every reload.
    //
    // We spy on `createSSEStream` to assert the route got past the
    // workflow_executions miss and into the SSE-creation branch. The mock
    // returns a no-op SSE handle whose `close()` triggers reply.send() so
    // app.inject() resolves instead of hanging on an open SSE stream.
    const sendEventSpy = vi.fn()
    const { createSSEStream } = await import("@/lib/sse.js")
    const originalImpl = vi.mocked(createSSEStream).getMockImplementation()
    vi.mocked(createSSEStream).mockImplementationOnce((_req, reply) => {
      return {
        sendEvent: sendEventSpy,
        sendComment: vi.fn(),
        close: () => { (reply as { send: () => void }).send() },
        isClosed: false,
      } as never
    })

    const wfChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: "PGRST116", message: "not found" },
            }),
          }),
        }),
      }),
    }
    const jobRow = {
      id: TEST_EXEC_ID,
      workflow_id: "wf-1",
      user_id: "test-user-id",
      workflow_execution_id: null,
      status: "completed",
      provider: null,
      mcp_client: null,
      input_data: { type: "image-to-video" },
      credits: 30,
      error_message: null,
      started_at: "2026-05-20T20:00:00Z",
      completed_at: "2026-05-20T20:05:00Z",
      created_at: "2026-05-20T20:00:00Z",
      updated_at: "2026-05-20T20:05:00Z",
    }
    const jobsChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: jobRow, error: null }),
            }),
          }),
        }),
      }),
    }
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockImplementation((table: string) => {
      if (table === "workflow_executions") return wfChain as never
      if (table === "jobs") return jobsChain as never
      return wfChain as never
    })

    const res = await authedGet(`/v1/workflow-executions/${TEST_EXEC_ID}/stream`)
    expect(res.statusCode).not.toBe(404)
    // Two events for a terminal job: metadata + done.
    expect(sendEventSpy).toHaveBeenCalledTimes(2)
    expect(sendEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "metadata" }))
    expect(sendEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "done" }))

    // Restore the module-level mock impl so other tests aren't affected.
    if (originalImpl) vi.mocked(createSSEStream).mockImplementation(originalImpl)
  })

  it("falls back to jobs for standalone generate-video single-node job (parity with i2v fallback)", async () => {
    // The unified generate-video node also lands at /stream as a standalone
    // job (the executions-list endpoint merges component-less jobs into the
    // surface). Even though the worker job name is "image-to-video" /
    // "text-to-video" after payload-builder dispatch, the `input_data.type`
    // field is the node-type label and stays "generate-video" on the row.
    // Confirm the SSE fallback path doesn't choke on the new type string.
    const sendEventSpy = vi.fn()
    const { createSSEStream } = await import("@/lib/sse.js")
    const originalImpl = vi.mocked(createSSEStream).getMockImplementation()
    vi.mocked(createSSEStream).mockImplementationOnce((_req, reply) => {
      return {
        sendEvent: sendEventSpy,
        sendComment: vi.fn(),
        close: () => { (reply as { send: () => void }).send() },
        isClosed: false,
      } as never
    })

    const wfChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: "PGRST116", message: "not found" },
            }),
          }),
        }),
      }),
    }
    const jobRow = {
      id: TEST_EXEC_ID,
      workflow_id: "wf-1",
      user_id: "test-user-id",
      workflow_execution_id: null,
      status: "completed",
      provider: null,
      mcp_client: null,
      input_data: { type: "generate-video" },
      credits: 30,
      error_message: null,
      started_at: "2026-05-25T20:00:00Z",
      completed_at: "2026-05-25T20:05:00Z",
      created_at: "2026-05-25T20:00:00Z",
      updated_at: "2026-05-25T20:05:00Z",
    }
    const jobsChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: jobRow, error: null }),
            }),
          }),
        }),
      }),
    }
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockImplementation((table: string) => {
      if (table === "workflow_executions") return wfChain as never
      if (table === "jobs") return jobsChain as never
      return wfChain as never
    })

    const res = await authedGet(`/v1/workflow-executions/${TEST_EXEC_ID}/stream`)
    expect(res.statusCode).not.toBe(404)
    expect(sendEventSpy).toHaveBeenCalledTimes(2)
    // The metadata event must carry the generate-video nodeType through the
    // jobToExecutionResponse projection so the editor's running-job overlay
    // can paint the correct node card.
    expect(sendEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "metadata",
        data: expect.objectContaining({
          nodeStates: expect.objectContaining({
            [TEST_EXEC_ID]: expect.objectContaining({ nodeType: "generate-video" }),
          }),
        }),
      }),
    )
    expect(sendEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "done" }))

    if (originalImpl) vi.mocked(createSSEStream).mockImplementation(originalImpl)
  })
})

// ---------------------------------------------------------------------------
// toExecutionSummary — list-payload trimming (perf)
//
// The two paginated list endpoints (GET /v1/executions, GET
// /v1/workflows/:id/executions) map rows through toExecutionSummary. The
// per-node `inputs` blob (resolved upstream inputs — large, debug-only) is
// never rendered by the list UI or its node-info modal (which reads `output`),
// so it's stripped here exactly as toExecutionResponse does for the detail/
// poll path. The detail endpoint still returns full node_states.
// ---------------------------------------------------------------------------

describe("toExecutionSummary — strips debug inputs from list node_states", () => {
  it("drops per-node `inputs` but preserves output/status/type/timing", () => {
    const summary = toExecutionSummary({
      id: "e1",
      status: "completed",
      node_states: {
        n1: {
          status: "completed",
          nodeType: "generate-image",
          jobId: "j1",
          output: { imageUrl: "https://cdn/x.png" },
          inputs: { prompt: "a long resolved prompt", referenceImageUrls: ["https://a", "https://b"] },
          startedAt: "t0",
          completedAt: "t1",
        },
        n2: { status: "running" },
      },
    }) as { nodeStates: Record<string, Record<string, unknown>> }

    // inputs stripped from the list payload...
    expect(summary.nodeStates.n1).not.toHaveProperty("inputs")
    // ...but everything the list row + node-info modal render is preserved
    expect(summary.nodeStates.n1.output).toEqual({ imageUrl: "https://cdn/x.png" })
    expect(summary.nodeStates.n1.status).toBe("completed")
    expect(summary.nodeStates.n1.nodeType).toBe("generate-image")
    expect(summary.nodeStates.n1.jobId).toBe("j1")
    expect(summary.nodeStates.n1.startedAt).toBe("t0")
    expect(summary.nodeStates.n1.completedAt).toBe("t1")
    expect(summary.nodeStates.n2).toEqual({ status: "running" })
  })
})
