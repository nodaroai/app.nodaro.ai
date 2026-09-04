import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

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
  mockAllowanceFor,
} = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockCheckCredits: vi.fn(),
  mockGetModelCreditCost: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockCommitCredits: vi.fn(),
  mockRefundCredits: vi.fn(),
  mockEstimateWorkflowCredits: vi.fn(),
  mockAllowanceFor: vi.fn(),
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

const pluginBillingHolder = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: () => ({ billing: pluginBillingHolder.value }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

// Same seam as ee/routes/__tests__/credits-balance.test.ts: the real module
// statically imports surface-profile.js + config.js, and the config mock below
// exports only the predicates this suite needs.
vi.mock("@/lib/deployment-payer.js", () => ({
  deploymentPayerActive: vi.fn(),
  deploymentPayerId: vi.fn(),
  // Track A's allowance rider reads this one on every non-null allowance; a
  // factory mock that omits it makes the named import throw inside the handler.
  allowanceEnforcementActive: vi.fn(() => false),
}))

// Track A rides the per-user allowance alongside the balance on
// GET /v1/user/credits under a payer, so registering the route now pulls in
// the allowance service. Left real it reaches the bare `supabase.from` stub
// above and throws ("Cannot read properties of undefined (reading 'select')")
// straight into the handler's catch → a 500 that would read as the payer guard
// refusing an ordinary requester. Mocked D13-aware (see the beforeEach): the
// payer itself has no allocation — it holds the real credits — and everyone
// else does, which is exactly the distinction the guard cases below turn on.
vi.mock("@/ee/billing/deployment-allowance-service.js", () => ({
  allowanceFor: mockAllowanceFor,
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
  hasOrganizations: () => true,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { creditsRoutes, invalidateBalanceCache } from "../credits.js"
import { supabase } from "../../../lib/supabase.js"
import { deploymentPayerActive, deploymentPayerId } from "../../../lib/deployment-payer.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const PAYER_ID = "00000000-0000-4000-8000-0000000009e1"

let app: FastifyInstance
/** When set, the auth-bypass hook stamps it as `req.billingContext` (P14). */
let stampBillingContext: FastifyRequest["billingContext"] | undefined

beforeEach(async () => {
  vi.clearAllMocks()
  // clearAllMocks resets CALLS, not implementations.
  vi.mocked(deploymentPayerActive).mockReturnValue(false)
  vi.mocked(deploymentPayerId).mockReturnValue(null)
  // D13: the payer holds the real credits rather than an allocation, so its own
  // allowance is null; every other user has one. Only reached under a payer —
  // the handler skips the rider entirely when `deploymentPayerActive()` is false.
  mockAllowanceFor.mockImplementation(async (id: string) =>
    id === PAYER_ID ? null : { granted: 400_000, remaining: 399_900, spent: 0 },
  )

  app = Fastify({ logger: false })

  // Bypass auth -- set userId from header for protected routes
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
    // `authKind` is set ONLY when the header is present: mainline requests in
    // this suite leave it undefined, which is what byte-identity needs.
    const kind = req.headers["x-test-auth-kind"]
    if (kind && typeof kind === "string") {
      req.authKind = kind as typeof req.authKind
    }
    // Simulate the internal-orchestrator-secret auth mode (auth.ts sets this).
    if (req.headers["x-test-internal"] === "true") {
      req.isInternalCall = true
    }
    // Simulate the billing hook's resolve (P14) — stamped per test.
    if (stampBillingContext) {
      req.billingContext = stampBillingContext
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
      // P14/W4f: the hook-resolved payer rides the options — undefined here
      // (no workspace header on this request), so the reserve is personal.
      { billingContext: undefined },
    )
  })

  it("P14/W4f: the hook-resolved workspace payer rides the reservation — no body field exists", async () => {
    const wsCtx = {
      payer: "workspace",
      userId: TEST_USER_ID,
      workspaceId: "ws-1",
      orgId: "org-1",
      memberCap: null,
      entitlements: {
        watermark: false,
        dailyCapCredits: null,
        parallelism: 12,
        tierForGates: "business",
        freeTierBlocklist: false,
        webFreeMode: false,
        appCreditsAllowance: false,
      },
    }
    stampBillingContext = wsCtx as never
    try {
      mockReserveCredits.mockResolvedValue({ usageLogId: "u-1", creditsReserved: 4, watermark: false })
      const res = await internalPost("/v1/credits/reserve", {
        jobId: "job-1",
        modelIdentifier: "nano-banana",
        // A forged body field must be ignored — the header-validated hook is
        // the only door (this key is not even in the Zod schema).
        billingContext: { payer: "workspace", workspaceId: "evil" },
      })
      expect(res.statusCode).toBe(200)
      const options = mockReserveCredits.mock.calls[0]?.[5] as { billingContext?: unknown }
      expect(options.billingContext).toBe(wsCtx)
    } finally {
      stampBillingContext = undefined
    }
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
  it("P14/W8: a workspace payer answers the budget preview through the plugin's ONE formula, degrading to null without it", async () => {
    mockEstimateWorkflowCredits.mockReturnValue(40)
    const wsCtx = {
      payer: "workspace" as const,
      userId: TEST_USER_ID,
      workspaceId: "ws-1",
      orgId: "org-1",
      memberCap: 500,
      entitlements: {
        watermark: false as const,
        dailyCapCredits: null,
        parallelism: 12,
        tierForGates: "business" as const,
        freeTierBlocklist: false as const,
        webFreeMode: false as const,
        appCreditsAllowance: false as const,
      },
    }
    stampBillingContext = wsCtx as never
    try {
      // Plugin present with the headroom member — full preview. `resolve`
      // must exist too: the gated seam accessor (billingService) only hands
      // back a service capable of resolving. NOTE (harness honesty): the
      // context is stamped directly here, bypassing the billing hook — the
      // "a workflowId reaches the workspace branch only through the run
      // predicate" half lives in the PLUGIN's resolver, not in this file.
      pluginBillingHolder.value = {
        resolve: vi.fn(),
        headroom: vi.fn(async () => ({ headroomCredits: 1200, workspaceLabel: "Class 5B" })),
      }
      const withMember = await authedPost("/v1/credits/estimate-workflow", {
        nodes: [{ type: "generate-image" }],
        workflowId: "00000000-0000-4000-8000-00000000aaaa",
      })
      expect(withMember.statusCode).toBe(200)
      expect(withMember.json().data).toEqual({
        totalCredits: 40,
        nodeCount: 1,
        payer: "workspace",
        workspaceId: "ws-1",
        memberCap: 500,
        headroomCredits: 1200,
        workspaceLabel: "Class 5B",
      })

      // Older plugin (no member) — "workspace pays, no preview", never an error.
      pluginBillingHolder.value = { resolve: vi.fn() }
      const withoutMember = await authedPost("/v1/credits/estimate-workflow", {
        nodes: [{ type: "generate-image" }],
      })
      expect(withoutMember.statusCode).toBe(200)
      expect(withoutMember.json().data).toMatchObject({ payer: "workspace", headroomCredits: null })
    } finally {
      stampBillingContext = undefined
      pluginBillingHolder.value = undefined
    }
  })

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
    expect(body.data).toEqual({ totalCredits: 14, nodeCount: 3, payer: "user" })
    expect(mockEstimateWorkflowCredits).toHaveBeenCalledWith(nodes)
  })
})

// ---------------------------------------------------------------------------
// The payer-balance leak, on the two doors credits-balance.ts's guard did not
// cover (spec invariant 7 / D10).
//
// A relay credential authenticates AS the payer (middleware/auth.ts sets
// authKind "app_token" and req.userId = the payer), and `GET /v1/user/credits`
// answered CreditsService.getBalance(payer) — the operator's real wallet — with
// no scope, authKind or payer check. `/v1/credits/check` answers the same pool
// as a sufficiency verdict.
// ---------------------------------------------------------------------------

describe("payer balance is JWT-only (GET /v1/user/credits, GET /v1/credits/check)", () => {
  function payerGet(url: string, authKind?: string) {
    return app.inject({
      method: "GET",
      url,
      headers: {
        "x-test-user-id": PAYER_ID,
        ...(authKind ? { "x-test-auth-kind": authKind } : {}),
      },
    })
  }

  beforeEach(() => {
    vi.mocked(deploymentPayerActive).mockReturnValue(true)
    vi.mocked(deploymentPayerId).mockReturnValue(PAYER_ID)
    mockGetBalance.mockResolvedValue({ credits: 50_000, subscriptionCredits: 50_000, topupCredits: 0, tier: "pro" })
    mockCheckCredits.mockResolvedValue({ hasEnough: true, balance: 50_000, required: 1 })
    mockGetModelCreditCost.mockResolvedValue(1)
  })

  afterEach(() => invalidateBalanceCache(PAYER_ID))

  for (const route of ["/v1/user/credits", "/v1/credits/check?model=nano-banana"]) {
    it(`403s an api_token authenticating as the payer on ${route}`, async () => {
      const res = await payerGet(route, "api_token")
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("payer_balance_jwt_only")
      expect(mockGetBalance).not.toHaveBeenCalled()
      expect(mockCheckCredits).not.toHaveBeenCalled()
    })

    it(`403s an OAuth app_token (the relay credential) on ${route}`, async () => {
      const res = await payerGet(route, "app_token")
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("payer_balance_jwt_only")
    })

    it(`still answers the payer's own browser session (jwt) on ${route}`, async () => {
      const res = await payerGet(route, "jwt")
      expect(res.statusCode).toBe(200)
    })

    it(`leaves an ordinary requester's programmatic read alone on ${route}`, async () => {
      const res = await app.inject({
        method: "GET",
        url: route,
        headers: { "x-test-user-id": TEST_USER_ID, "x-test-auth-kind": "api_token" },
      })
      expect(res.statusCode).toBe(200)
    })

    it(`is byte-identical with no deployment payer configured on ${route}`, async () => {
      vi.mocked(deploymentPayerActive).mockReturnValue(false)
      vi.mocked(deploymentPayerId).mockReturnValue(null)
      const res = await payerGet(route, "app_token")
      expect(res.statusCode).toBe(200)
    })
  }

  // The cache is keyed by userId ALONE, so the payer's own browser session
  // warms it — a guard placed after the read would hand that entry to the
  // app_token. This is the ordering assertion.
  it("refuses even when the payer's own session has already warmed the cache", async () => {
    expect((await payerGet("/v1/user/credits", "jwt")).statusCode).toBe(200)
    const res = await payerGet("/v1/user/credits", "app_token")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("payer_balance_jwt_only")
  })
})
