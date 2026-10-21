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

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { refundCredits: mockRefundCredits },
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidateBalanceCache,
}))
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))

// The held-job withdrawal (refund + delete the withheld object + record the
// decision). `lib/cancel-job.ts` reaches it through a dynamic import; mocking
// it keeps this route suite off storage and the credit lifecycle.
const mockWithdrawHeldJob = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }))
vi.mock("@/lib/job-policy-gate.js", () => ({ withdrawHeldJob: mockWithdrawHeldJob }))

// A use-case wrapper's hidden run, stopped by lib/cancel-job.ts (dynamic import).
const mockCancelInnerRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock("@/lib/use-case/cancel-run.js", () => ({ cancelUseCaseInnerExecution: mockCancelInnerRun }))

// D10: the reconcile sweep's metered rule a cancel applies first
// (lib/cancel-job.ts, dynamic import) — covered in lib/__tests__/cancel-job.test.ts.
// Here: no billed metered hold, so the cancel is today's.
vi.mock("@/lib/llm-billing.js", () => ({ settleSweptMeteredLlmJob: vi.fn().mockResolvedValue("not-metered") }))
vi.mock("@/ee/billing/llm-cancel-settle.js", () => ({
  settleBilledLedgerBeforeCancelImpl: vi.fn().mockResolvedValue("not-metered"),
  ledgerBilled: () => false,
  ledgerInFlight: () => false,
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
    // The D10 evidence read (lib/cancel-job.ts) looks at a job's holds before
    // its flip: a case that registers no holds has none.
    const handler = handlers[table] ?? (table === "usage_logs" ? usageLogsHandler([]) : undefined)
    if (!handler) throw new Error(`No mock handler registered for table "${table}"`)
    return handler() as never
  })
}

/** Build a "jobs" chain that handles both select-by-id and the CAS update. */
function jobsHandler(opts: {
  jobLookup?: { data: unknown; error: unknown }
  jobsList?: { data: unknown; error: unknown }
  updateError?: unknown
  /** Rows the cancel CAS UPDATE reports as flipped. Defaults to echoing the
   *  requested rows (single → job-1, bulk → the jobsList) = "we won the
   *  race". Pass [] to simulate a concurrent terminal writer winning. */
  cancelledRows?: Array<{ id: string }>
}): TableHandler {
  return () => {
    const single = vi.fn().mockResolvedValue(opts.jobLookup ?? { data: null, error: { message: "not found" } })
    // cancel-all list chain: select().eq().in(status).or(pre-call | in-recovery)
    const orForList = vi.fn().mockResolvedValue(opts.jobsList ?? { data: [], error: null })
    const inForList = vi.fn().mockReturnValue({ or: orForList })
    // single-cancel children sweep: select("id").eq(user).eq(parent).in(status) — none here
    const noChildren = { in: vi.fn().mockResolvedValue({ data: [], error: null }) }
    // The D10 reads (lib/cancel-job.ts): one job's billing ledger
    // (select().eq().maybeSingle()) and a batch's (select().in()) — none here.
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eqAfterSelect = vi.fn().mockReturnValue({ single, in: inForList, maybeSingle, eq: vi.fn().mockReturnValue(noChildren) })
    const select = vi.fn().mockReturnValue({ eq: eqAfterSelect, in: vi.fn().mockResolvedValue({ data: [], error: null }) })

    // CAS update chains (audit D2 + tenant scoping):
    //   single: update().eq("id").eq("user_id").in("status",[...]).select("id")
    //   bulk:   update().in("id",[...]).in("status",[...]).select("id")
    const defaultRows =
      opts.cancelledRows ??
      ((opts.jobsList?.data as Array<{ id: string }> | undefined) ?? [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }])
    const updateSelect = vi.fn().mockResolvedValue({
      data: defaultRows,
      error: opts.updateError ?? null,
    })
    const updateIn2 = vi.fn().mockReturnValue({ select: updateSelect })
    const updateIn1 = vi.fn().mockReturnValue({ select: updateSelect, in: updateIn2 })
    // Self-chaining eq so .eq("id").eq("user_id") both resolve to the same node.
    const updateEqResult: Record<string, unknown> = {}
    const updateEq = vi.fn().mockReturnValue(updateEqResult)
    Object.assign(updateEqResult, { in: updateIn1, eq: updateEq })
    const update = vi.fn().mockReturnValue({ eq: updateEq, in: updateIn1 })
    return { select, update }
  }
}

/** Build a "usage_logs" chain for the refund lookup: select().in().eq() — and the
 *  D10 evidence read before a flip, select().eq().eq() (no metered action here). */
function usageLogsHandler(rows: Array<{ id: string }>): TableHandler {
  return () => {
    const eq = vi.fn().mockResolvedValue({ data: rows, error: null })
    const inFn = vi.fn().mockReturnValue({ eq })
    const select = vi.fn().mockReturnValue({ in: inFn, eq: vi.fn().mockReturnValue({ eq }) })
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
      url: "/v1/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel",
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
      url: "/v1/jobs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 403 when job belongs to different user", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending", user_id: "other-user-id", input_data: {}, output_data: {} },
          error: null,
        },
      }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel",
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
          data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "completed", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
          error: null,
        },
      }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel",
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
          data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
          error: null,
        },
      }),
      usage_logs: usageLogsHandler([{ id: "usage-log-1" }]),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 1, inFlight: false })
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    // CRITICAL: the reserved credit hold MUST be refunded — without this the
    // user pays for cancelled work that never produced output.
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(TEST_USER_ID)
  })

  it("does NOT cancel an in-flight job (provider_task_id set) — reports inFlight, no refund", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "processing", user_id: TEST_USER_ID, input_data: {}, output_data: {}, provider_task_id: "kie-task-abc" },
          error: null,
        },
      }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 0, inFlight: true })
    // It's already running on the provider — don't touch the queue or refund.
    expect(tryRemoveFromQueue).not.toHaveBeenCalled()
    expect(mockRefundCredits).not.toHaveBeenCalled()
  })

  it("cancels an in-recovery job (provider_task_id set, reconcile_attempts > 0) and refunds (audit D2)", async () => {
    // The worker abandoned this row and the reconcile cron has been retrying
    // it — without this exception the user has NO kill path for up to the
    // full exhaustion budget while staring at a stuck progress bar.
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "processing", user_id: TEST_USER_ID,
            input_data: {}, output_data: {},
            provider_task_id: "kie-task-abc", reconcile_attempts: 3,
          },
          error: null,
        },
      }),
      usage_logs: usageLogsHandler([{ id: "usage-log-1" }]),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 1, inFlight: false })
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
  })

  it("does NOT refund when the cancel CAS loses to a concurrent completion (0 rows flipped)", async () => {
    // TOCTOU (audit D2): the cron completed + committed credits between our
    // status read and the cancel UPDATE. The CAS must miss and the refund
    // must NOT fire — refunding here would gift a delivered, billed output.
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
          error: null,
        },
        cancelledRows: [],
      }),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 0, inFlight: false })
    expect(mockRefundCredits).not.toHaveBeenCalled()
  })

  it("succeeds even if no usage_log exists (e.g. zero-cost job)", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobLookup: {
          data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending", user_id: TEST_USER_ID, input_data: {}, output_data: {} },
          error: null,
        },
      }),
      usage_logs: usageLogsHandler([]),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel",
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
        jobsList: { data: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { id: "job-2" }], error: null },
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
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    expect(tryRemoveFromQueue).toHaveBeenCalledWith("job-2")
    // Both reserved holds refunded — bulk cancel previously also leaked credits.
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-2")
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(TEST_USER_ID)
  })
})

describe("POST /v1/jobs/:jobId/cancel — a parent takes its analysis child with it", () => {
  const PARENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const CHILD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const USER = "user-123"

  /** jobs handler answering lookups in order (parent first, then the child)
   *  and echoing every CAS update as flipped. */
  function jobsSequence(lookups: Array<Record<string, unknown>>) {
    const queue = [...lookups]
    return () => {
      const single = vi.fn().mockImplementation(async () => {
        const row = queue.shift()
        return row ? { data: row, error: null } : { data: null, error: { message: "not found" } }
      })
      // The children sweep (select("id").eq(user).eq(parent).in(status)) finds none,
      // and so do the D10 ledger reads (one job's, a batch's).
      const noChildren = { in: vi.fn().mockResolvedValue({ data: [], error: null }) }
      const select = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single, maybeSingle: async () => ({ data: null, error: null }), eq: vi.fn().mockReturnValue(noChildren) }),
        in: async () => ({ data: [], error: null }),
      })
      const updateSelect = vi.fn().mockImplementation(async () => ({ data: [{ id: "flipped" }], error: null }))
      const inFn = vi.fn().mockReturnValue({ select: updateSelect })
      const eq2 = vi.fn().mockReturnValue({ in: inFn })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      const update = vi.fn().mockReturnValue({ eq: eq1 })
      return { select, update }
    }
  }

  it("cancels the still-running analysis child named by input_data.analysisJobId, refunding both", async () => {
    setupTableMocks({
      jobs: jobsSequence([
        { id: PARENT, status: "processing", user_id: USER, input_data: { type: "llm-structured", analysisJobId: CHILD }, provider_task_id: null, reconcile_attempts: 0 },
        { id: CHILD, status: "processing", user_id: USER, input_data: { type: "video-analysis" }, provider_task_id: null, reconcile_attempts: 0 },
      ]),
      usage_logs: usageLogsHandler([{ id: "usage-log-1" }]),
    })

    const res = await app.inject({ method: "POST", url: `/v1/jobs/${PARENT}/cancel`, payload: { userId: USER } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 1, inFlight: false })
    expect(tryRemoveFromQueue).toHaveBeenCalledWith(PARENT)
    expect(tryRemoveFromQueue).toHaveBeenCalledWith(CHILD)
    // one reserved log per lookup → two refunds
    expect(mockRefundCredits).toHaveBeenCalledTimes(2)
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(USER)
  })

  it("leaves a finished child alone (Draft again still has its analysis)", async () => {
    setupTableMocks({
      jobs: jobsSequence([
        { id: PARENT, status: "processing", user_id: USER, input_data: { type: "llm-structured", analysisJobId: CHILD }, provider_task_id: null, reconcile_attempts: 0 },
        { id: CHILD, status: "completed", user_id: USER, input_data: { type: "video-analysis" }, provider_task_id: null, reconcile_attempts: 0 },
      ]),
      usage_logs: usageLogsHandler([{ id: "usage-log-1" }]),
    })

    const res = await app.inject({ method: "POST", url: `/v1/jobs/${PARENT}/cancel`, payload: { userId: USER } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 1, inFlight: false })
    expect(tryRemoveFromQueue).toHaveBeenCalledTimes(1)
    expect(mockRefundCredits).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// D18 — "Cancel all" must not be silently a lie.
//
// The SELECT filtered `pending|queued|processing` AND
// `provider_task_id IS NULL OR reconcile_attempts > 0`. A held job fails BOTH
// halves — it is `pending_review`, and it has a provider task — so cancel-all
// skipped it in silence and left the reservation standing. A bulk CAS cannot
// fix that on its own either: each held row needs its own refund, its own
// object deletion and its own audit row. So held ids are delegated, one at a
// time, to the single-job helper inside the same handler (held rows per user
// are 0-2, so the delegation is bounded).
// ---------------------------------------------------------------------------
describe("POST /v1/jobs/cancel-all — held jobs", () => {
  const HELD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const LIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

  it("withdraws a held job and counts it, alongside the bulk-cancelled rows", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobsList: { data: [{ id: LIVE, status: "pending" }, { id: HELD, status: "pending_review" }], error: null },
        // the delegated single-job lookup for the held id
        jobLookup: {
          data: {
            id: HELD, status: "pending_review", user_id: TEST_USER_ID,
            input_data: {}, provider_task_id: "task-1", reconcile_attempts: 0,
          },
          error: null,
        },
        cancelledRows: [{ id: LIVE }],
      }),
      usage_logs: usageLogsHandler([{ id: "usage-log-1" }]),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cancel-all",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 2 })
    expect(mockWithdrawHeldJob).toHaveBeenCalledWith(HELD)
    // The held row is NOT part of the bulk queue-removal pass: there is no
    // BullMQ entry left for a job that already finished running.
    expect(tryRemoveFromQueue).not.toHaveBeenCalledWith(HELD)
    expect(tryRemoveFromQueue).toHaveBeenCalledWith(LIVE)
  })

  it("a held job a reviewer resolved first is not counted", async () => {
    mockWithdrawHeldJob.mockResolvedValueOnce({ ok: false, reason: "lost_race" })
    setupTableMocks({
      jobs: jobsHandler({
        jobsList: { data: [{ id: HELD, status: "pending_review" }], error: null },
        jobLookup: {
          data: {
            id: HELD, status: "pending_review", user_id: TEST_USER_ID,
            input_data: {}, provider_task_id: "task-1", reconcile_attempts: 0,
          },
          error: null,
        },
        cancelledRows: [],
      }),
      usage_logs: usageLogsHandler([]),
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cancel-all",
      payload: { userId: TEST_USER_ID },
    })

    expect(res.json()).toEqual({ success: true, cancelled: 0 })
  })
})


// A use-case wrapper owns a hidden run and a reserved fee. The bulk flip would
// refund the fee and leave the run dispatching and billing, so cancel-all hands
// the wrapper to the single-job helper, which also stops the run.
describe("POST /v1/jobs/cancel-all — use-case wrappers", () => {
  const WRAPPER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
  const LIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

  it("cancels a use-case wrapper through the single-job helper — fee refunded, hidden run stopped — and bulk-flips the rest", async () => {
    setupTableMocks({
      jobs: jobsHandler({
        jobsList: { data: [{ id: LIVE, status: "pending", provider: "kie" }, { id: WRAPPER, status: "processing", provider: "use-case" }], error: null },
        jobLookup: {
          data: {
            id: WRAPPER, status: "processing", user_id: TEST_USER_ID, provider: "use-case",
            input_data: { type: "tighten-episode", _executionId: "exec-inner", _feeCredits: 10 }, provider_task_id: null, reconcile_attempts: 0,
          },
          error: null,
        },
        cancelledRows: [{ id: LIVE }],
      }),
      usage_logs: usageLogsHandler([{ id: "fee-log" }]),
    })

    const res = await app.inject({ method: "POST", url: "/v1/jobs/cancel-all", payload: { userId: TEST_USER_ID } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 2 })
    expect(mockCancelInnerRun).toHaveBeenCalledTimes(1)
    expect(mockCancelInnerRun).toHaveBeenCalledWith("exec-inner", TEST_USER_ID, expect.any(String))
    expect(mockRefundCredits).toHaveBeenCalledWith("fee-log")
  })
})

// ---------------------------------------------------------------------------
// Ruling 22 — cancelling a parent cancels its still-running child jobs (rows
// whose `parent_job_id` names it), each through the same single-job cancel.
// A finished child is left alone, and the sweep reads only the caller's rows.
// The "jobs" table here is a tiny in-memory fake that honours eq / in filters,
// so the ownership and status filters are exercised, not just asserted.
// ---------------------------------------------------------------------------
describe("POST /v1/jobs/:jobId/cancel — a parent takes its still-running children with it", () => {
  const PARENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const PENDING_CHILD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const DONE_CHILD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const FOREIGN_CHILD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
  const USER = "user-123"
  const OTHER = "user-999"

  type Row = Record<string, unknown> & { id: string }

  function fakeJobs(rows: Row[]) {
    const updates: Array<{ patch: Record<string, unknown>; ids: string[] }> = []
    const selects: Array<Array<[string, string, unknown]>> = []
    const matches = (row: Row, filters: Array<[string, string, unknown]>) =>
      filters.every(([op, col, val]) => (op === "eq" ? row[col] === val : (val as unknown[]).includes(row[col])))
    const handler = () => ({
      select: () => {
        const filters: Array<[string, string, unknown]> = []
        selects.push(filters)
        const b: Record<string, unknown> = {
          eq: (col: string, val: unknown) => { filters.push(["eq", col, val]); return b },
          in: (col: string, val: unknown[]) => { filters.push(["in", col, val]); return b },
          single: async () => {
            const hit = rows.find((r) => matches(r, filters))
            return hit ? { data: { ...hit }, error: null } : { data: null, error: { message: "not found" } }
          },
          // The D10 ledger read (lib/cancel-job.ts): these rows hold none.
          maybeSingle: async () => {
            const hit = rows.find((r) => matches(r, filters))
            return { data: hit ? { ...hit } : null, error: null }
          },
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: rows.filter((r) => matches(r, filters)).map((r) => ({ id: r.id })), error: null }),
        }
        return b
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Array<[string, string, unknown]> = []
        const b: Record<string, unknown> = {
          eq: (col: string, val: unknown) => { filters.push(["eq", col, val]); return b },
          in: (col: string, val: unknown[]) => { filters.push(["in", col, val]); return b },
          select: async () => {
            const hit = rows.filter((r) => matches(r, filters))
            for (const r of hit) Object.assign(r, patch)
            updates.push({ patch, ids: hit.map((r) => r.id) })
            return { data: hit.map((r) => ({ id: r.id })), error: null }
          },
        }
        return b
      },
    })
    return { handler, updates, selects }
  }

  const job = (id: string, status: string, extra: Record<string, unknown> = {}): Row => ({
    id, status, user_id: USER, input_data: {}, provider: null, provider_task_id: null, reconcile_attempts: 0, parent_job_id: null, ...extra,
  })

  it("cancels a pending child with its parent, and refunds it too", async () => {
    const rows = [job(PARENT, "processing"), job(PENDING_CHILD, "pending", { parent_job_id: PARENT })]
    const fake = fakeJobs(rows)
    setupTableMocks({ jobs: fake.handler, usage_logs: usageLogsHandler([{ id: "usage-log-1" }]) })

    const res = await app.inject({ method: "POST", url: `/v1/jobs/${PARENT}/cancel`, payload: { userId: USER } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ success: true, cancelled: 1, inFlight: false })
    expect(rows.map((r) => r.status)).toEqual(["cancelled", "cancelled"])
    expect(tryRemoveFromQueue).toHaveBeenCalledWith(PENDING_CHILD)
    expect(mockRefundCredits).toHaveBeenCalledTimes(2)
  })

  it("leaves a completed child alone", async () => {
    const rows = [job(PARENT, "processing"), job(DONE_CHILD, "completed", { parent_job_id: PARENT })]
    const fake = fakeJobs(rows)
    setupTableMocks({ jobs: fake.handler, usage_logs: usageLogsHandler([{ id: "usage-log-1" }]) })

    const res = await app.inject({ method: "POST", url: `/v1/jobs/${PARENT}/cancel`, payload: { userId: USER } })

    expect(res.statusCode).toBe(200)
    expect(rows.find((r) => r.id === DONE_CHILD)?.status).toBe("completed")
    expect(fake.updates.flatMap((u) => u.ids)).toEqual([PARENT])
    expect(tryRemoveFromQueue).toHaveBeenCalledTimes(1)
    expect(mockRefundCredits).toHaveBeenCalledTimes(1)
  })

  it("never touches another user's job, even one naming this parent", async () => {
    const rows = [
      job(PARENT, "processing"),
      job(FOREIGN_CHILD, "pending", { parent_job_id: PARENT, user_id: OTHER }),
    ]
    const fake = fakeJobs(rows)
    setupTableMocks({ jobs: fake.handler, usage_logs: usageLogsHandler([{ id: "usage-log-1" }]) })

    const res = await app.inject({ method: "POST", url: `/v1/jobs/${PARENT}/cancel`, payload: { userId: USER } })

    expect(res.statusCode).toBe(200)
    expect(rows.find((r) => r.id === FOREIGN_CHILD)?.status).toBe("pending")
    expect(fake.updates.flatMap((u) => u.ids)).toEqual([PARENT])
    // The owner filter is in the children query itself, not a post-filter.
    const childQuery = fake.selects.find((f) => f.some(([, col]) => col === "parent_job_id"))
    expect(childQuery).toContainEqual(["eq", "user_id", USER])
    expect(tryRemoveFromQueue).not.toHaveBeenCalledWith(FOREIGN_CHILD)
  })

  it("does not sweep children when the parent itself was not cancelled (in flight)", async () => {
    const rows = [
      job(PARENT, "processing", { provider_task_id: "task-1" }),
      job(PENDING_CHILD, "pending", { parent_job_id: PARENT }),
    ]
    const fake = fakeJobs(rows)
    setupTableMocks({ jobs: fake.handler, usage_logs: usageLogsHandler([]) })

    const res = await app.inject({ method: "POST", url: `/v1/jobs/${PARENT}/cancel`, payload: { userId: USER } })

    expect(res.json()).toEqual({ success: true, cancelled: 0, inFlight: true })
    expect(rows.find((r) => r.id === PENDING_CHILD)?.status).toBe("pending")
  })

  it("an analysis child that is also a parent_job_id child is cancelled once", async () => {
    const rows = [
      job(PARENT, "processing", { input_data: { analysisJobId: PENDING_CHILD } }),
      job(PENDING_CHILD, "processing", { parent_job_id: PARENT }),
    ]
    const fake = fakeJobs(rows)
    setupTableMocks({ jobs: fake.handler, usage_logs: usageLogsHandler([]) })

    const res = await app.inject({ method: "POST", url: `/v1/jobs/${PARENT}/cancel`, payload: { userId: USER } })

    expect(res.statusCode).toBe(200)
    expect(rows.map((r) => r.status)).toEqual(["cancelled", "cancelled"])
    expect(vi.mocked(tryRemoveFromQueue).mock.calls.filter(([id]) => id === PENDING_CHILD)).toHaveLength(1)
  })
})
