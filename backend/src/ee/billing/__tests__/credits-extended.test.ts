import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, tableResponses, setLastMatchedResponse, mockHasCreditsRef } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  let lastMatchedResponse: { data: unknown; error: unknown } | null = null
  const mockHasCreditsRef = { value: true }

  function createChain(response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    const response = tableResponses.get(table) ?? null
    lastMatchedResponse = response
    return createChain(response)
  })

  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })

  return {
    mockFrom,
    mockRpc,
    tableResponses,
    setLastMatchedResponse: (v: { data: unknown; error: unknown } | null) => { lastMatchedResponse = v },
    mockHasCreditsRef,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: mockFrom,
    auth: { getUser: vi.fn() },
    rpc: mockRpc,
  },
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => mockHasCreditsRef.value,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { CreditsService, invalidateModelPricingCache } from "../credits.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTable(table: string, data: unknown, error: unknown = null): void {
  tableResponses.set(table, { data, error })
}

function resetMocks(): void {
  tableResponses.clear()
  setLastMatchedResponse(null)
  mockFrom.mockClear()
  mockRpc.mockClear()
  mockHasCreditsRef.value = true
  invalidateModelPricingCache()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreditsService — extended", () => {
  beforeEach(() => {
    resetMocks()
  })

  // ════════════════════════════════════════════════════════════════════════
  // getBalance
  // ════════════════════════════════════════════════════════════════════════

  describe("getBalance", () => {
    it("returns complete balance breakdown", async () => {
      const todayUTC = new Date().toISOString().slice(0, 10)
      mockTable("profiles", {
        subscription_credits: 200,
        topup_credits: 50,
        tier: "pro",
        subscription_tier: null,
        daily_spent_credits: 5,
        last_daily_reset: todayUTC,
        current_period_end: "2026-03-21T00:00:00Z",
      })

      mockTable("tier_config", {
        daily_credit_limit: 100,
        monthly_credits: 530,
        features: { hd_export: true },
      })

      mockTable("subscriptions", {
        current_period_end: "2026-04-15T00:00:00Z",
      })

      const balance = await CreditsService.getBalance("user-123")

      expect(balance.total).toBe(250)
      expect(balance.subscription).toBe(200)
      expect(balance.topup).toBe(50)
      expect(balance.dailySpent).toBe(5)
      expect(balance.dailyLimit).toBe(100)
      expect(balance.monthlyAllocation).toBe(530)
      expect(balance.tier).toBe("pro")
      expect(balance.features).toEqual({ hd_export: true })
      expect(balance.periodEnd).toBe("2026-04-15T00:00:00Z")
    })

    it("returns defaults when profile not found", async () => {
      mockTable("profiles", null, { code: "PGRST116" })

      const balance = await CreditsService.getBalance("nonexistent-user")

      expect(balance.total).toBe(0)
      expect(balance.subscription).toBe(0)
      expect(balance.topup).toBe(0)
      expect(balance.tier).toBe("free")
      expect(balance.features).toEqual({})
      expect(balance.periodEnd).toBeNull()
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // reserveCredits
  // ════════════════════════════════════════════════════════════════════════

  describe("reserveCredits", () => {
    it("calls reserve_credits RPC with correct params", async () => {
      // Model pricing lookup
      mockTable("model_pricing", {
        credit_cost: 5,
        is_enabled: true,
        tier_restriction: null,
      })

      mockRpc.mockResolvedValueOnce({ data: "usage-log-abc", error: null })

      const result = await CreditsService.reserveCredits(
        "user-123",
        "job-456",
        "flux",
        0.05,
        0.0625,
        { watermarkOverride: false },
      )

      expect(mockRpc).toHaveBeenCalledWith("reserve_credits", expect.objectContaining({
        p_user_id: "user-123",
        p_credits: 5,
        p_job_id: "job-456",
        p_model_identifier: "flux",
        p_provider_cost_usd: 0.05,
        p_display_cost_usd: 0.0625,
        p_is_app_run: false,
        // p_daily_limit added in migration 169 — free-tier cap when no profile tier resolves.
        p_daily_limit: 50,
      }))

      expect(result.usageLogId).toBe("usage-log-abc")
      expect(result.creditsReserved).toBe(5)
      expect(result.watermark).toBe(false)
    })

    it("propagates RPC error", async () => {
      mockTable("model_pricing", {
        credit_cost: 5,
        is_enabled: true,
        tier_restriction: null,
      })

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "insufficient_credits" },
      })

      await expect(
        CreditsService.reserveCredits("user-123", "job-456", "flux", 0.05, 0.0625, { watermarkOverride: false })
      ).rejects.toThrow("Credit reservation failed: insufficient_credits")
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // commitCredits
  // ════════════════════════════════════════════════════════════════════════

  describe("commitCredits", () => {
    it("calls commit_credits RPC", async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: null })

      await CreditsService.commitCredits("usage-log-abc")

      expect(mockRpc).toHaveBeenCalledWith("commit_credits", {
        p_usage_log_id: "usage-log-abc",
        p_actual_credits: undefined,
      })
    })

    it("passes actualCredits when provided for partial refund", async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: null })

      await CreditsService.commitCredits("usage-log-abc", 3)

      expect(mockRpc).toHaveBeenCalledWith("commit_credits", {
        p_usage_log_id: "usage-log-abc",
        p_actual_credits: 3,
      })
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // refundCredits
  // ════════════════════════════════════════════════════════════════════════

  describe("refundCredits", () => {
    it("calls refund_credits RPC", async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: null })

      await CreditsService.refundCredits("usage-log-abc")

      expect(mockRpc).toHaveBeenCalledWith("refund_credits", {
        p_usage_log_id: "usage-log-abc",
      })
    })

    it("is idempotent when already refunded (fallback path)", async () => {
      // RPC not found — triggers fallback
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "function not found" },
      })

      // Fallback reads the canonical `status` column (not metadata.status) to
      // decide eligibility — matches the SQL refund_credits guard.
      mockTable("usage_logs", {
        user_id: "user-123",
        job_id: "job-456",
        credits_used: 5,
        status: "refunded",
        metadata: { from_sub: 5, from_topup: 0 },
      })

      // Should not throw — already refunded is handled gracefully
      await expect(CreditsService.refundCredits("usage-log-abc")).resolves.toBeUndefined()
      // No pool-restoring RPC should have been called
      expect(mockRpc).not.toHaveBeenCalledWith("add_subscription_credits", expect.anything())
      expect(mockRpc).not.toHaveBeenCalledWith("add_topup_credits", expect.anything())
    })

    it("skips refund when usage log status is 'committed' (already settled)", async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: "fn missing" } })
      mockTable("usage_logs", {
        user_id: "user-123",
        job_id: "job-456",
        credits_used: 5,
        status: "committed",
        metadata: { from_sub: 5, from_topup: 0 },
      })

      await CreditsService.refundCredits("usage-log-committed")

      // A committed row must NOT be refunded — would otherwise double-credit
      // the user (they got the output AND the credits back).
      expect(mockRpc).not.toHaveBeenCalledWith("add_subscription_credits", expect.anything())
      expect(mockRpc).not.toHaveBeenCalledWith("add_topup_credits", expect.anything())
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // getModelCreditCost
  // ════════════════════════════════════════════════════════════════════════

  describe("getModelCreditCost", () => {
    it("returns DB value and falls back to static cost", async () => {
      // First call: DB returns a row
      mockTable("model_pricing", {
        credit_cost: 12,
        is_enabled: true,
        tier_restriction: null,
      })

      const dbCost = await CreditsService.getModelCreditCost("gpt-image")
      expect(dbCost).toBe(12)

      // Invalidate cache so the next call hits DB again
      invalidateModelPricingCache()

      // Second call: DB returns no row — should fall back to static (1 for "flux")
      mockTable("model_pricing", null, { code: "PGRST116" })

      const staticCost = await CreditsService.getModelCreditCost("flux")
      expect(staticCost).toBe(2)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // logTransaction
  // ════════════════════════════════════════════════════════════════════════

  describe("logTransaction", () => {
    it("inserts to credit_transactions", async () => {
      await CreditsService.logTransaction({
        userId: "user-123",
        amount: -5,
        creditType: "subscription",
        source: "usage",
        description: "Job job-456: flux",
        jobId: "job-456",
        balanceAfter: 95,
      })

      expect(mockFrom).toHaveBeenCalledWith("credit_transactions")
    })

    it("returns true on success", async () => {
      const result = await CreditsService.logTransaction({
        userId: "user-123",
        amount: 100,
        creditType: "subscription",
        source: "subscription_created",
        balanceAfter: 100,
      })
      expect(result).toBe(true)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // reserveCredits — zero-cost models
  // ════════════════════════════════════════════════════════════════════════

  describe("reserveCredits — zero-cost models", () => {
    it("creates usage log but skips credit deduction for zero-cost models", async () => {
      mockTable("model_pricing", {
        credit_cost: 0,
        is_enabled: true,
        tier_restriction: null,
      })

      const result = await CreditsService.reserveCredits(
        "user-123", "job-456", "composite", 0, 0,
        { watermarkOverride: false },
      )

      expect(result.creditsReserved).toBe(0)
      expect(result.watermark).toBe(false)
      // Should NOT call reserve_credits RPC for zero-cost
      expect(mockRpc).not.toHaveBeenCalledWith("reserve_credits", expect.anything())
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // reserveCredits — self-hosted skip
  // ════════════════════════════════════════════════════════════════════════

  describe("reserveCredits — self-hosted mode", () => {
    it("returns skip result when credits disabled", async () => {
      mockHasCreditsRef.value = false
      const result = await CreditsService.reserveCredits(
        "user-123", "job-456", "flux", 0.05, 0.0625,
      )
      expect(result.usageLogId).toBe("self-hosted-skip")
      expect(result.creditsReserved).toBe(0)
      expect(result.watermark).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // commitCredits — self-hosted and fallback
  // ════════════════════════════════════════════════════════════════════════

  describe("commitCredits — edge cases", () => {
    it("is a no-op when credits disabled", async () => {
      mockHasCreditsRef.value = false
      await CreditsService.commitCredits("usage-log-abc")
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it("is a no-op for self-hosted-skip usage log ID", async () => {
      await CreditsService.commitCredits("self-hosted-skip")
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it("falls back to manual update when RPC fails", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "function not found" },
      })

      await CreditsService.commitCredits("usage-log-abc")

      // Should call from("usage_logs").update(...)
      expect(mockFrom).toHaveBeenCalledWith("usage_logs")
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // refundCredits — self-hosted and edge cases
  // ════════════════════════════════════════════════════════════════════════

  describe("refundCredits — edge cases", () => {
    it("is a no-op when credits disabled", async () => {
      mockHasCreditsRef.value = false
      await CreditsService.refundCredits("usage-log-abc")
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it("is a no-op for self-hosted-skip usage log ID", async () => {
      await CreditsService.refundCredits("self-hosted-skip")
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it("restores credits from sub pool in fallback path", async () => {
      // RPC fails
      mockRpc
        .mockResolvedValueOnce({ data: null, error: { message: "not found" } })
        // add_subscription_credits RPC
        .mockResolvedValueOnce({ data: null, error: null })

      // usage_logs query returns sub-only deduction; status="reserved" makes
      // it eligible for refund.
      mockTable("usage_logs", {
        user_id: "user-123",
        job_id: "job-456",
        credits_used: 5,
        status: "reserved",
        metadata: { from_sub: 5, from_topup: 0 },
      })

      await CreditsService.refundCredits("usage-log-abc")

      expect(mockRpc).toHaveBeenCalledWith("add_subscription_credits", {
        p_user_id: "user-123",
        p_credits: 5,
      })
    })

    it("restores credits from topup pool in fallback path", async () => {
      mockRpc
        .mockResolvedValueOnce({ data: null, error: { message: "not found" } })
        .mockResolvedValueOnce({ data: null, error: null })

      mockTable("usage_logs", {
        user_id: "user-123",
        job_id: "job-456",
        credits_used: 3,
        status: "reserved",
        metadata: { from_sub: 0, from_topup: 3 },
      })

      await CreditsService.refundCredits("usage-log-topup")

      expect(mockRpc).toHaveBeenCalledWith("add_topup_credits", {
        p_user_id: "user-123",
        p_credits: 3,
      })
    })

    it("restores to topup as fallback when metadata has no pool split", async () => {
      mockRpc
        .mockResolvedValueOnce({ data: null, error: { message: "not found" } })
        .mockResolvedValueOnce({ data: null, error: null })

      mockTable("usage_logs", {
        user_id: "user-123",
        job_id: "job-456",
        credits_used: 4,
        status: "reserved",
        metadata: {},
      })

      await CreditsService.refundCredits("usage-log-no-pool")

      expect(mockRpc).toHaveBeenCalledWith("add_topup_credits", {
        p_user_id: "user-123",
        p_credits: 4,
      })
    })

    it("claims status atomically BEFORE restoring credits (race-safe)", async () => {
      // Verify the order: the status-flip UPDATE must complete before any
      // pool-restoring RPC fires. If a concurrent caller already flipped the
      // row, the conditional UPDATE returns 0 rows and we must NOT restore.
      mockRpc
        .mockResolvedValueOnce({ data: null, error: { message: "fn missing" } }) // refund_credits RPC fails
        .mockResolvedValueOnce({ data: null, error: null }) // would-be add_*_credits

      // Override the chain for usage_logs so the SECOND access (the conditional
      // UPDATE...select.maybeSingle) returns no row — simulating "another
      // caller already flipped this row from reserved to refunded."
      const originalImpl = mockFrom.getMockImplementation()
      let usageLogsCall = 0
      mockFrom.mockImplementation((table: string) => {
        if (table !== "usage_logs") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
          }
        }
        usageLogsCall += 1
        // Call 1: SELECT — returns the reserved row.
        // Call 2: UPDATE...SELECT.maybeSingle — returns null (claim lost).
        const isFirstCall = usageLogsCall === 1
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(isFirstCall ? {
            data: {
              user_id: "user-123",
              job_id: "job-456",
              credits_used: 5,
              status: "reserved",
              metadata: { from_sub: 5, from_topup: 0 },
            },
            error: null,
          } : { data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
        }
      })

      try {
        await CreditsService.refundCredits("usage-log-raced")

        // Critical: pool-restoring RPCs must NOT fire when claim is lost,
        // otherwise concurrent refunds would double-credit the user.
        expect(mockRpc).not.toHaveBeenCalledWith("add_subscription_credits", expect.anything())
        expect(mockRpc).not.toHaveBeenCalledWith("add_topup_credits", expect.anything())
      } finally {
        // Restore the default impl so later tests don't see the overridden chain
        if (originalImpl) mockFrom.mockImplementation(originalImpl)
      }
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // adminAdjustCredits
  // ════════════════════════════════════════════════════════════════════════

  describe("adminAdjustCredits", () => {
    it("returns 999999 when credits disabled", async () => {
      mockHasCreditsRef.value = false
      const result = await CreditsService.adminAdjustCredits({
        userId: "user-123",
        amount: 100,
        creditType: "subscription",
        description: "Test adjustment",
        adminUserId: "admin-1",
      })
      expect(result.newBalance).toBe(999999)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // checkAppRunEligibility
  // ════════════════════════════════════════════════════════════════════════

  describe("checkAppRunEligibility", () => {
    it("returns allowed when credits disabled", async () => {
      mockHasCreditsRef.value = false
      const result = await CreditsService.checkAppRunEligibility("user-123")
      expect(result.allowed).toBe(true)
    })

    it("returns allowed for paid tier users", async () => {
      mockTable("profiles", {
        tier: "pro",
        subscription_tier: null,
        topup_credits: 0,
        app_credits_allowance: 0,
      })
      const result = await CreditsService.checkAppRunEligibility("user-123")
      expect(result.allowed).toBe(true)
    })

    it("returns allowed for free tier with topup credits", async () => {
      mockTable("profiles", {
        tier: "free",
        subscription_tier: null,
        topup_credits: 50,
        app_credits_allowance: 0,
      })
      const result = await CreditsService.checkAppRunEligibility("user-123")
      expect(result.allowed).toBe(true)
    })

    it("returns not allowed for free tier with no app credits", async () => {
      mockTable("profiles", {
        tier: "free",
        subscription_tier: null,
        topup_credits: 0,
        app_credits_allowance: 0,
      })
      const result = await CreditsService.checkAppRunEligibility("user-123")
      expect(result.allowed).toBe(false)
      expect(result.error).toContain("app credits")
      expect(result.appCreditsAllowance).toBe(0)
    })

    it("returns allowed for free tier with positive app allowance", async () => {
      mockTable("profiles", {
        tier: "free",
        subscription_tier: null,
        topup_credits: 0,
        app_credits_allowance: 10,
      })
      const result = await CreditsService.checkAppRunEligibility("user-123")
      expect(result.allowed).toBe(true)
      expect(result.appCreditsAllowance).toBe(10)
    })

    it("returns allowed when profile not found (fail open)", async () => {
      mockTable("profiles", null, { code: "PGRST116" })
      const result = await CreditsService.checkAppRunEligibility("user-123")
      expect(result.allowed).toBe(true)
    })
  })
})
