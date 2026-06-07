import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks -- vi.hoisted ensures these are available inside vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockGetBalance,
  mockCheckCredits,
  mockGetModelCreditCost,
  mockReserveCredits,
  mockCommitCredits,
  mockRefundCredits,
  mockEstimateWorkflowCredits,
} = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockCheckCredits: vi.fn(),
  mockGetModelCreditCost: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockCommitCredits: vi.fn(),
  mockRefundCredits: vi.fn(),
  mockEstimateWorkflowCredits: vi.fn(),
}))

vi.mock("@/ee/services/credits.js", () => ({
  CreditsService: {
    getBalance: mockGetBalance,
    checkCredits: mockCheckCredits,
    getModelCreditCost: mockGetModelCreditCost,
    reserveCredits: mockReserveCredits,
    commitCredits: mockCommitCredits,
    refundCredits: mockRefundCredits,
    estimateWorkflowCredits: mockEstimateWorkflowCredits,
  },
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

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { creditsRoutes, invalidateBalanceCache } from "../credits.js"
import { supabase } from "../../../lib/supabase.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  // Bypass auth -- set userId from header for protected routes
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
    // Simulate the internal-orchestrator-secret auth mode (auth.ts sets this).
    if (req.headers["x-test-internal"] === "true") {
      req.isInternalCall = true
    }
  })

  await app.register(async (instance) => {
    await creditsRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  // Clear the in-memory balance cache between tests
  invalidateBalanceCache(TEST_USER_ID)
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authedGet(url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-test-user-id": TEST_USER_ID },
  })
}

function authedPost(url: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url,
    headers: { "x-test-user-id": TEST_USER_ID },
    payload: payload as Record<string, unknown>,
  })
}

/** POST as the internal orchestrator (passes the isInternalCall gate on the
 *  reserve/commit/refund routes). */
function internalPost(url: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url,
    headers: { "x-test-user-id": TEST_USER_ID, "x-test-internal": "true" },
    payload: payload as Record<string, unknown>,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /v1/user/credits", () => {
  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/user/credits",
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns balance data on success", async () => {
    const balance = {
      subscriptionCredits: 100,
      topupCredits: 50,
      dailySpent: 5,
      tier: "basic",
    }
    mockGetBalance.mockResolvedValue(balance)

    const res = await authedGet("/v1/user/credits")

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual(balance)
    expect(mockGetBalance).toHaveBeenCalledWith(TEST_USER_ID)
  })

  it("returns cached balance within 15s TTL", async () => {
    const balance = {
      subscriptionCredits: 100,
      topupCredits: 50,
      dailySpent: 5,
      tier: "basic",
    }
    mockGetBalance.mockResolvedValue(balance)

    // First request populates cache
    const res1 = await authedGet("/v1/user/credits")
    expect(res1.statusCode).toBe(200)

    // Second request should use cache
    const res2 = await authedGet("/v1/user/credits")
    expect(res2.statusCode).toBe(200)
    expect(res2.json().data).toEqual(balance)

    // CreditsService.getBalance should have been called only once
    expect(mockGetBalance).toHaveBeenCalledTimes(1)
  })

  it("returns fresh balance after cache expiry", async () => {
    const balance1 = { subscriptionCredits: 100, topupCredits: 50 }
    const balance2 = { subscriptionCredits: 90, topupCredits: 50 }
    mockGetBalance.mockResolvedValueOnce(balance1).mockResolvedValueOnce(balance2)

    // First request populates cache
    const res1 = await authedGet("/v1/user/credits")
    expect(res1.statusCode).toBe(200)
    expect(res1.json().data).toEqual(balance1)

    // Invalidate cache (simulates expiry)
    invalidateBalanceCache(TEST_USER_ID)

    // Second request should fetch fresh data
    const res2 = await authedGet("/v1/user/credits")
    expect(res2.statusCode).toBe(200)
    expect(res2.json().data).toEqual(balance2)

    expect(mockGetBalance).toHaveBeenCalledTimes(2)
  })
})

describe("GET /v1/credits/check", () => {
  it("returns 400 when model query param missing", async () => {
    const res = await authedGet("/v1/credits/check")

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("bad_request")
  })

  it("returns check result on success", async () => {
    const checkResult = { allowed: true, remaining: 95 }
    mockCheckCredits.mockResolvedValue(checkResult)
    mockGetModelCreditCost.mockResolvedValue(5)

    const res = await authedGet("/v1/credits/check?model=nano-banana")

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual({ ...checkResult, creditCost: 5 })
    expect(mockCheckCredits).toHaveBeenCalledWith(TEST_USER_ID, "nano-banana")
    expect(mockGetModelCreditCost).toHaveBeenCalledWith("nano-banana")
  })
})

describe("POST /v1/credits/model-costs", () => {
  it("returns 400 for empty models array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/credits/model-costs",
      payload: { models: [] },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 400 for > 50 models", async () => {
    const models = Array.from({ length: 51 }, (_, i) => `model-${i}`)
    const res = await app.inject({
      method: "POST",
      url: "/v1/credits/model-costs",
      payload: { models },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns costs map + empty missing/errors on full success", async () => {
    mockGetModelCreditCost
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(3)

    const res = await app.inject({
      method: "POST",
      url: "/v1/credits/model-costs",
      payload: { models: ["nano-banana", "flux", "kling"] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual({
      "nano-banana": 4,
      flux: 10,
      kling: 3,
    })
    expect(body.missing).toEqual([])
    expect(body.errors).toEqual([])
  })

  it("returns 200 with partial data + missing[] when one identifier has no price", async () => {
    // Per-model fault isolation: one PriceNotConfiguredError must NOT take
    // down the whole batch (which used to 503 the editor's cost preview).
    const { PriceNotConfiguredError } = await import("@/ee/billing/credits.js")
    mockGetModelCreditCost
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new PriceNotConfiguredError("mystery-model"))
      .mockResolvedValueOnce(3)

    const res = await app.inject({
      method: "POST",
      url: "/v1/credits/model-costs",
      payload: { models: ["nano-banana", "mystery-model", "kling"] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual({ "nano-banana": 4, kling: 3 })
    expect(body.missing).toEqual(["mystery-model"])
    expect(body.errors).toEqual([])
  })

  it("returns 200 with errors[] for non-price failures (DB blip, etc.)", async () => {
    mockGetModelCreditCost
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error("transient DB error"))

    const res = await app.inject({
      method: "POST",
      url: "/v1/credits/model-costs",
      payload: { models: ["nano-banana", "flux"] },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual({ "nano-banana": 4 })
    expect(body.missing).toEqual([])
    expect(body.errors).toEqual(["flux"])
  })
})

describe("POST /v1/credits/reserve", () => {
  it("returns 403 for a non-internal caller (user JWT / API token cannot drive credit mutations)", async () => {
    const res = await authedPost("/v1/credits/reserve", {
      jobId: "job-1",
      modelIdentifier: "nano-banana",
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("returns 400 on missing required fields", async () => {
    const res = await internalPost("/v1/credits/reserve", {
      jobId: "job-1",
      // modelIdentifier missing
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns reservation result on success (internal caller)", async () => {
    const reserveResult = {
      usageLogId: "usage-log-1",
      creditsReserved: 4,
      watermark: false,
    }
    mockReserveCredits.mockResolvedValue(reserveResult)

    const res = await internalPost("/v1/credits/reserve", {
      jobId: "job-1",
      modelIdentifier: "nano-banana",
      providerCostUsd: 0.02,
      displayCostUsd: 0.025,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual(reserveResult)
    expect(mockReserveCredits).toHaveBeenCalledWith(
      TEST_USER_ID,
      "job-1",
      "nano-banana",
      0.02,
      0.025,
    )
  })
})

describe("POST /v1/credits/commit", () => {
  it("returns 403 for a non-internal caller", async () => {
    const res = await authedPost("/v1/credits/commit", { usageLogId: "usage-log-1", actualCredits: 0 })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(mockCommitCredits).not.toHaveBeenCalled()
  })

  it("returns success on valid commit (internal caller)", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { user_id: TEST_USER_ID },
            error: null,
          }),
        }),
      }),
    } as never)

    mockCommitCredits.mockResolvedValue(undefined)

    const res = await internalPost("/v1/credits/commit", {
      usageLogId: "usage-log-1",
      actualCredits: 3,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(mockCommitCredits).toHaveBeenCalledWith("usage-log-1", 3)
  })
})

describe("POST /v1/credits/refund", () => {
  it("returns 403 for a non-internal caller (closes the self-refund free-generation exploit)", async () => {
    const res = await authedPost("/v1/credits/refund", { usageLogId: "usage-log-1" })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(mockRefundCredits).not.toHaveBeenCalled()
  })

  it("returns success on valid refund (internal caller)", async () => {
    const mockFrom = vi.mocked(supabase.from)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { user_id: TEST_USER_ID },
            error: null,
          }),
        }),
      }),
    } as never)

    mockRefundCredits.mockResolvedValue(undefined)

    const res = await internalPost("/v1/credits/refund", {
      usageLogId: "usage-log-1",
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
  })
})

describe("POST /v1/credits/estimate-workflow", () => {
  it("returns estimated total credits", async () => {
    mockEstimateWorkflowCredits.mockReturnValue(14)

    const nodes = [
      { type: "generate-image" },
      { type: "image-to-video" },
      { type: "combine-videos" },
    ]

    const res = await app.inject({
      method: "POST",
      url: "/v1/credits/estimate-workflow",
      payload: { nodes },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual({ totalCredits: 14, nodeCount: 3 })
    expect(mockEstimateWorkflowCredits).toHaveBeenCalledWith(nodes)
  })
})
