import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, tableResponses, setLastMatchedResponse, mockHasCreditsRef } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  let lastMatchedResponse: { data: unknown; error: unknown } | null = null
  const mockHasCreditsRef = { value: true }

  function createChain(response: { data: unknown; error: unknown } | null) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() =>
        Promise.resolve(response ?? { data: null, error: { code: "PGRST116" } })
      ),
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

      expect(mockRpc).toHaveBeenCalledWith("reserve_credits", {
        p_user_id: "user-123",
        p_credits: 5,
        p_job_id: "job-456",
        p_model_identifier: "flux",
        p_provider_cost_usd: 0.05,
        p_display_cost_usd: 0.0625,
        p_is_app_run: false,
      })

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

      // Fallback: query usage_logs to find the log entry
      mockTable("usage_logs", {
        user_id: "user-123",
        job_id: "job-456",
        credits_used: 5,
        metadata: { status: "refunded" },
      })

      // Should not throw — already refunded is handled gracefully
      await expect(CreditsService.refundCredits("usage-log-abc")).resolves.toBeUndefined()
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
  })
})
