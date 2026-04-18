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

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
    getJob: vi.fn(),
    remove: vi.fn(),
  },
  tryRemoveFromQueue: vi.fn().mockResolvedValue(undefined),
  redis: {},
}))

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

// Refund-on-cancel uses CreditsService.refundCredits and invalidateBalanceCache.
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

import { cancelJobsRoutes } from "../cancel-jobs.js"
import { supabase } from "../../lib/supabase.js"
import { tryRemoveFromQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await cancelJobsRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Per-table dispatching mock. Each test sets up handlers per table name
 * (e.g. "jobs", "usage_logs"). The cancel route reads/updates "jobs" and
 * then queries "usage_logs" to refund — so a single mockReturnValue is no
 * longer enough.
 */
type TableHandler = () => Record<string, unknown>

function setupTableMocks(handlers: Record<string, TableHandler>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const handler = handlers[table]
    if (!handler) throw new Error(`No mock handler registered for table "${table}"`)
    return handler() as never
  })
}

/** Build a "jobs" chain that handles both select-by-id and update-by-id. */
function jobsHandler(opts: {
  jobLookup?: { data: unknown; error: unknown }
  jobsList?: { data: unknown; error: unknown }
  updateError?: unknown
}): TableHandler {
  return () => {
    const single = vi.fn().mockResolvedValue(opts.jobLookup ?? { data: null, error: { message: "not found" } })
    const inForList = vi.fn().mockResolvedValue(opts.jobsList ?? { data: [], error: null })
    const eqAfterSelect = vi.fn().mockReturnValue({ single, in: inForList })
    const select = vi.fn().mockReturnValue({ eq: eqAfterSelect })

    const updateThen = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
    const update = vi.fn().mockReturnValue({ eq: updateThen, in: updateThen })
    return { select, update }
  }
}

/** Build a "usage_logs" chain for the refund lookup: select().in().eq(). */
function usageLogsHandler(rows: Array<{ id: string }>): TableHandler {
  return () => {
    const eq = vi.fn().mockResolvedValue({ data: rows, error: null })
    const inFn = vi.fn().mockReturnValue({ eq })
    const select = vi.fn().mockReturnValue({ in: inFn })
    return { select }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/jobs/:jobId/cancel", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: {},
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns 404 when job not found", async () => {
    setupTableMocks({
      jobs: jobsHandler({ jobLookup: { data: null, error: { message: "not found" } } }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/nonexistent-job/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 403 when job belongs to different user", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: { id: "job-1", status: "pending", user_id: "other-user-id", input_data: {}, output_data: {} },
          error: null,
        },
      }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(mockRefundCredits).not.toHaveBeenCalled()
  })

  it("returns 400 when job already completed", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: { id: "job-1", status: "completed", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
          error: null,
        },
      }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_status")
    expect(mockRefundCredits).not.toHaveBeenCalled()
  })

  it("refunds reserved credits and returns success for pending job (regression: was silent credit theft)", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: { id: "job-1", status: "pending", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
          error: null,
        },
      }),
      usage_logs: usageLogsHandler([{ id: "usage-log-1" }]),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 1 })
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("job-1")
    // CRITICAL: the reserved credit hold MUST be refunded — without this the
    // user pays for cancelled work that never produced output.
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(TEST_USER_ID)
  })

  it("succeeds even if no usage_log exists (e.g. zero-cost job)", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: { id: "job-1", status: "pending", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
          error: null,
        },
      }),
      usage_logs: usageLogsHandler([]),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/job-1/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(mockRefundCredits).not.toHaveBeenCalled()
    // Balance cache is still invalidated for consistency, even with no refund.
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(TEST_USER_ID)
  })
})

describe("POST /v1/jobs/cancel-all", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cancel-all",
      payload: {},
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("returns { cancelled: 0 } when no pending jobs", async () => {
    setupTableMocks({
      jobs: jobsHandler({ jobsList: { data: [], error: null } }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cancel-all",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 0 })
    expect(mockRefundCredits).not.toHaveBeenCalled()
  })

  it("cancels all pending jobs and refunds each one's reserved credits", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobsList: { data: [{ id: "job-1" }, { id: "job-2" }], error: null },
      }),
      usage_logs: usageLogsHandler([
        { id: "usage-log-1" },
        { id: "usage-log-2" },
      ]),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cancel-all",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 2 })
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("job-1")
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("job-2")
    // Both reserved holds refunded — bulk cancel previously also leaked credits.
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-2")
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(TEST_USER_ID)
  })
})
