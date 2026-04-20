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

vi.mock("@/billing/credits.js", () => ({
  CreditsService: { refundCredits: mockRefundCredits },
}))

vi.mock("@/routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidateBalanceCache,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { workflowExecutionRoutes } from "../workflow-execution.js"
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
      // Create execution
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: TEST_EXEC_ID },
              error: null,
            }),
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
        // Job update
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
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
        return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) } as never
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

  it("returns 404 when execution not found", async () => {
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

    const res = await authedGet(`/v1/workflow-executions/${TEST_EXEC_ID}/stream`)
    expect(res.statusCode).toBe(404)
  })
})
