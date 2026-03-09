import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  STRIPE_PRODUCTS,
  TIER_CREDITS,
  TIER_STORAGE_LIMITS,
} from "../stripe-config.js"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const {
  mockFrom,
  mockRpc,
  selectResponses,
  resetMockState,
  mockLogTransaction,
  mockInvalidateBalanceCache,
} = vi.hoisted(() => {
  // Queue-based responses: each from(table).select().eq().single() call
  // shifts the next response off the queue. Write operations (insert,
  // update, upsert) always succeed.
  const selectResponses = new Map<string, Array<{ data: unknown; error: unknown }>>()

  function shiftResponse(table: string): { data: unknown; error: unknown } {
    const queue = selectResponses.get(table)
    if (!queue || queue.length === 0) {
      return { data: null, error: { code: "PGRST116" } }
    }
    // If only one response left, peek (don't shift) — allows repeated reads
    if (queue.length === 1) return queue[0]
    return queue.shift()!
  }

  // Build a chainable mock that:
  // - Resolves .single() using the selectResponses queue
  // - Resolves write terminals (insert/update/upsert) to success
  // - Supports arbitrary .method().method() chaining
  function createChain(table: string) {
    const chain: Record<string, unknown> = {}

    const self = () => chain

    chain.select = vi.fn(self)
    chain.eq = vi.fn(self)
    chain.insert = vi.fn(self)
    chain.update = vi.fn(self)
    chain.upsert = vi.fn(self)
    chain.single = vi.fn(() => Promise.resolve(shiftResponse(table)))

    // Make the chain "thenable" so `await supabase.from("x").update({}).eq()`
    // resolves to success for write operations.
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null })

    return chain
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table))
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockLogTransaction = vi.fn().mockResolvedValue(undefined)
  const mockInvalidateBalanceCache = vi.fn()

  function resetMockState() {
    selectResponses.clear()
    mockFrom.mockClear()
    mockRpc.mockClear()
    mockLogTransaction.mockClear()
    mockInvalidateBalanceCache.mockClear()
  }

  return {
    mockFrom,
    mockRpc,
    selectResponses,
    resetMockState,
    mockLogTransaction,
    mockInvalidateBalanceCache,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: mockFrom,
    auth: { getUser: vi.fn() },
    rpc: mockRpc,
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/billing/credits.js", () => ({
  CreditsService: {
    logTransaction: mockLogTransaction,
  },
}))

vi.mock("@/routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidateBalanceCache,
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import {
  resolveUserId,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionCanceled,
  handleTransactionCompleted,
} from "../provision-credits.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Enqueue a mock select response for a table. Multiple calls queue responses. */
function mockSelect(table: string, data: unknown, error: unknown = null) {
  const queue = selectResponses.get(table) ?? []
  queue.push({ data, error })
  selectResponses.set(table, queue)
}

/** Shorthand to enqueue a "not found" select response. */
function mockSelectNotFound(table: string) {
  mockSelect(table, null, { code: "PGRST116" })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("provision-credits", () => {
  beforeEach(() => {
    resetMockState()
  })

  // ════════════════════════════════════════════════════════════════════════
  // resolveUserId
  // ════════════════════════════════════════════════════════════════════════

  describe("resolveUserId", () => {
    it("returns userId from stripe_customers table", async () => {
      mockSelect("stripe_customers", { user_id: "user-abc" })

      const result = await resolveUserId("cus_123", null)

      expect(result).toBe("user-abc")
    })

    it("falls back to customData.userId when not in stripe_customers", async () => {
      mockSelectNotFound("stripe_customers")

      const result = await resolveUserId("cus_123", { userId: "user-fallback" })

      expect(result).toBe("user-fallback")
      // Should also upsert the stripe customer for future lookups
      expect(mockFrom).toHaveBeenCalledWith("stripe_customers")
    })

    it("returns null when both lookups fail", async () => {
      mockSelectNotFound("stripe_customers")

      const result = await resolveUserId("cus_123", null)

      expect(result).toBeNull()
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // handleSubscriptionCreated
  // ════════════════════════════════════════════════════════════════════════

  describe("handleSubscriptionCreated", () => {
    const baseData = {
      subscriptionId: "sub_001",
      stripeCustomerId: "cus_001",
      priceId: STRIPE_PRODUCTS.pro.monthly,
      status: "active",
      currentPeriodStart: "2026-01-01T00:00:00Z",
      currentPeriodEnd: "2026-02-01T00:00:00Z",
      metadata: { userId: "user-001" },
    }

    it("creates subscription and updates profile on success", async () => {
      // resolveUserId: stripe_customers not found, falls back to customData
      mockSelectNotFound("stripe_customers")
      // Idempotency check: subscription does not exist yet
      mockSelectNotFound("subscriptions")

      await handleSubscriptionCreated(baseData)

      const calledTables = mockFrom.mock.calls.map((c: unknown[]) => c[0])
      expect(calledTables).toContain("subscriptions")
      expect(calledTables).toContain("profiles")

      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-001",
          amount: TIER_CREDITS.pro,
          creditType: "subscription",
          source: "subscription_created",
        })
      )

      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
    })

    it("skips if subscription already exists (idempotent)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Subscription already exists
      mockSelect("subscriptions", { id: "existing-sub-id" })

      await handleSubscriptionCreated(baseData)

      expect(mockLogTransaction).not.toHaveBeenCalled()
      expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
    })

    it("sets correct tier, credits, and storage from price ID", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelectNotFound("subscriptions")

      const basicData = { ...baseData, priceId: STRIPE_PRODUCTS.basic.monthly }

      await handleSubscriptionCreated(basicData)

      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: TIER_CREDITS.basic,
          description: expect.stringContaining("basic"),
        })
      )
    })

    it("logs transaction when transactionId provided", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelectNotFound("subscriptions")

      const dataWithTx = {
        ...baseData,
        transactionId: "txn_123",
        amountUsd: 99.0,
      }

      await handleSubscriptionCreated(dataWithTx)

      // insertTransaction calls from("transactions").upsert(...)
      const calledTables = mockFrom.mock.calls.map((c: unknown[]) => c[0])
      expect(calledTables).toContain("transactions")
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // handleSubscriptionUpdated
  // ════════════════════════════════════════════════════════════════════════

  describe("handleSubscriptionUpdated", () => {
    const baseUpdatedData = {
      subscriptionId: "sub_001",
      stripeCustomerId: "cus_001",
      priceId: STRIPE_PRODUCTS.pro.monthly,
      status: "active",
      currentPeriodStart: "2026-02-01T00:00:00Z",
      currentPeriodEnd: "2026-03-01T00:00:00Z",
      metadata: null,
    }

    it("handles tier upgrade (sets credits to new tier amount)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Existing subscription is basic tier, same period (not a renewal)
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.basic.monthly,
        tier: "basic",
        current_period_start: "2026-02-01T00:00:00Z",
      })

      await handleSubscriptionUpdated(baseUpdatedData)

      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-001",
          amount: TIER_CREDITS.pro,
          description: expect.stringContaining("upgrade"),
        })
      )

      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
    })

    it("handles tier downgrade (keeps current credits until renewal)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Existing subscription is pro tier, same period
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-02-01T00:00:00Z",
      })

      const downgradeData = {
        ...baseUpdatedData,
        priceId: STRIPE_PRODUCTS.basic.monthly,
      }

      await handleSubscriptionUpdated(downgradeData)

      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("downgrade"),
        })
      )
    })

    it("handles renewal (resets credits to tier amount)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Same price but different period start (renewal)
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-01-01T00:00:00Z",
      })

      await handleSubscriptionUpdated(baseUpdatedData)

      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "subscription_renewal",
          description: expect.stringContaining("renewal"),
        })
      )
    })

    it("updates subscription record with new data", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Same tier, same period — no tier change, no renewal
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-02-01T00:00:00Z",
      })

      await handleSubscriptionUpdated(baseUpdatedData)

      // Should update both subscription record and profile
      const calledTables = mockFrom.mock.calls.map((c: unknown[]) => c[0])
      expect(calledTables).toContain("subscriptions")
      expect(calledTables).toContain("profiles")

      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // handleSubscriptionCanceled
  // ════════════════════════════════════════════════════════════════════════

  describe("handleSubscriptionCanceled", () => {
    const baseCanceledData = {
      subscriptionId: "sub_001",
      stripeCustomerId: "cus_001",
      currentPeriodEnd: "2026-02-01T00:00:00Z",
      metadata: null as Record<string, string> | null,
    }

    it("downgrades to free tier immediately", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("profiles", { subscription_credits: 30 })

      await handleSubscriptionCanceled(baseCanceledData)

      const calledTables = mockFrom.mock.calls.map((c: unknown[]) => c[0])
      expect(calledTables).toContain("subscriptions")
      expect(calledTables).toContain("profiles")

      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-001",
          creditType: "subscription",
          source: "expiry",
          description: expect.stringContaining("canceled"),
        })
      )

      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
    })

    it("caps subscription_credits at min(current, 50)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // User has 400 credits — should be capped to free tier (150)
      mockSelect("profiles", { subscription_credits: 400 })

      await handleSubscriptionCanceled(baseCanceledData)

      const freeCredits = TIER_CREDITS.free // 150
      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: freeCredits - 400, // negative (credits removed)
          balanceAfter: freeCredits,
        })
      )
    })

    it("sets storage_limit to 1GB", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("profiles", { subscription_credits: 20 })

      await handleSubscriptionCanceled(baseCanceledData)

      // Verify free tier storage constant
      expect(TIER_STORAGE_LIMITS.free).toBe(1 * 1024 * 1024 * 1024)

      const calledTables = mockFrom.mock.calls.map((c: unknown[]) => c[0])
      expect(calledTables).toContain("profiles")

      // Credits already below 50, so balanceAfter should be 20
      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          balanceAfter: 20,
        })
      )
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // handleTransactionCompleted
  // ════════════════════════════════════════════════════════════════════════

  describe("handleTransactionCompleted", () => {
    const baseTransactionData = {
      transactionId: "txn_001",
      stripeCustomerId: "cus_001" as string | null,
      subscriptionId: null as string | null,
      lineItems: [{ priceId: "price_1T8T5k6EOX16l3P8a1goDXGm" }],
      totalAmount: 2500, // $25.00 in cents
      metadata: null as Record<string, string> | null,
    }

    it("grants topup credits for valid topup transaction", async () => {
      // Idempotency check: transaction not found
      mockSelectNotFound("transactions")
      // resolveUserId: stripe_customers found
      mockSelect("stripe_customers", { user_id: "user-001" })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockRpc).toHaveBeenCalledWith("add_topup_credits", {
        p_user_id: "user-001",
        p_credits: 750,
      })

      const calledTables = mockFrom.mock.calls.map((c: unknown[]) => c[0])
      expect(calledTables).toContain("transactions")

      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
    })

    it("skips if subscriptionId is present (handled by subscription events)", async () => {
      const subTransaction = {
        ...baseTransactionData,
        subscriptionId: "sub_001",
      }

      await handleTransactionCompleted(subTransaction)

      expect(mockRpc).not.toHaveBeenCalled()
      expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
    })

    it("skips duplicate transactions (idempotent)", async () => {
      // Transaction already exists
      mockSelect("transactions", { id: "existing-tx-id" })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockRpc).not.toHaveBeenCalled()
      expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
    })

    it("returns early if no topup credits found for price", async () => {
      mockSelectNotFound("transactions")
      mockSelect("stripe_customers", { user_id: "user-001" })

      const unknownPriceData = {
        ...baseTransactionData,
        lineItems: [{ priceId: "pri_unknown_price" }],
      }

      await handleTransactionCompleted(unknownPriceData)

      expect(mockRpc).not.toHaveBeenCalled()
      expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
    })
  })
})
