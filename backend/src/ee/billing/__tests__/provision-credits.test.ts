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
  writeErrors,
  deleteCalls,
  resetMockState,
  mockLogTransaction,
  mockInvalidateBalanceCache,
} = vi.hoisted(() => {
  // Queue-based responses: each from(table).select().eq().single() call
  // shifts the next response off the queue. Write operations (insert,
  // update, upsert) default to success unless `writeErrors` overrides them.
  const selectResponses = new Map<string, Array<{ data: unknown; error: unknown }>>()
  const writeErrors = new Map<string, Array<{ code?: string; message?: string } | null>>()
  // Records every from(table).delete() so tests can assert rollbacks.
  const deleteCalls: Array<{ table: string }> = []

  function shiftResponse(table: string): { data: unknown; error: unknown } {
    const queue = selectResponses.get(table)
    if (!queue || queue.length === 0) {
      return { data: null, error: { code: "PGRST116" } }
    }
    // If only one response left, peek (don't shift) — allows repeated reads
    if (queue.length === 1) return queue[0]
    return queue.shift()!
  }

  function shiftWriteError(table: string): { code?: string; message?: string } | null {
    const queue = writeErrors.get(table)
    if (!queue || queue.length === 0) return null
    if (queue.length === 1) return queue[0]
    return queue.shift()!
  }

  // Build a chainable mock that:
  // - Resolves .single() using the selectResponses queue
  // - Resolves write terminals (insert/update/upsert) to success or to a
  //   queued error (via mockWriteError)
  // - Supports arbitrary .method().method() chaining
  function createChain(table: string) {
    const chain: Record<string, unknown> = {}

    const self = () => chain

    chain.select = vi.fn(self)
    chain.eq = vi.fn(self)
    chain.in = vi.fn(self)
    chain.insert = vi.fn(self)
    chain.update = vi.fn(self)
    chain.upsert = vi.fn(self)
    chain.delete = vi.fn(() => {
      deleteCalls.push({ table })
      return chain
    })
    chain.single = vi.fn(() => Promise.resolve(shiftResponse(table)))

    // Make the chain "thenable" so `await supabase.from("x").update({}).eq()`
    // resolves. Default success unless a writeErrors entry is queued.
    chain.then = (resolve: (v: unknown) => void) => {
      const error = shiftWriteError(table)
      resolve({ data: null, error })
    }

    return chain
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table))
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockLogTransaction = vi.fn().mockResolvedValue(undefined)
  const mockInvalidateBalanceCache = vi.fn()

  function resetMockState() {
    selectResponses.clear()
    writeErrors.clear()
    deleteCalls.length = 0
    mockFrom.mockClear()
    mockRpc.mockClear()
    mockLogTransaction.mockClear()
    mockInvalidateBalanceCache.mockClear()
  }

  return {
    mockFrom,
    mockRpc,
    selectResponses,
    writeErrors,
    deleteCalls,
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

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    logTransaction: mockLogTransaction,
  },
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidateBalanceCache,
}))

// The free-grant exit by purchase (signup-grant.ts). Mocked at the module
// seam: these tests pin WHEN the webhook calls it, its own tests pin WHAT it does.
const { mockActivateOnPurchase } = vi.hoisted(() => ({
  mockActivateOnPurchase: vi.fn().mockResolvedValue({ activated: false, state: "granted" }),
}))
vi.mock("@/ee/billing/signup-grant.js", () => ({
  activateSignupGrantOnPurchase: mockActivateOnPurchase,
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
  handleAutoRechargeSucceeded,
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

/** Enqueue an error response for the next write (insert/update/upsert) on a table. */
function mockWriteError(table: string, error: { code?: string; message?: string }) {
  const queue = writeErrors.get(table) ?? []
  queue.push(error)
  writeErrors.set(table, queue)
}

/** All payloads passed to from(table).update(...) across every mock chain. */
function updatePayloadsFor(table: string): Array<Record<string, unknown>> {
  return mockFrom.mock.calls.flatMap((call: unknown[], i: number) => {
    if (call[0] !== table) return []
    const chain = mockFrom.mock.results[i]?.value as {
      update?: { mock: { calls: Array<[Record<string, unknown>]> } }
    }
    return chain?.update?.mock.calls.map((c) => c[0]) ?? []
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("provision-credits", () => {
  beforeEach(() => {
    resetMockState()
    mockActivateOnPurchase.mockClear()
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

    it("rolls the pre-subscribe balance into topup credits (free grant survives)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelectNotFound("subscriptions")
      // User still holds 139 of the free signup grant when they subscribe.
      // The tier grant SET below would wipe it — it must carry over to topup.
      mockSelect("profiles", { subscription_credits: 139, topup_credits: 0 })

      await handleSubscriptionCreated(baseData)

      expect(mockRpc).toHaveBeenCalledWith("add_topup_credits", {
        p_user_id: "user-001",
        p_credits: 139,
      })
      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-001",
          amount: 139,
          creditType: "topup",
          source: "subscription_created",
          balanceAfter: 139,
        }),
      )
    })

    it("does not roll over when the pre-subscribe balance is zero", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelectNotFound("subscriptions")
      mockSelect("profiles", { subscription_credits: 0, topup_credits: 500 })

      await handleSubscriptionCreated(baseData)

      expect(mockRpc).not.toHaveBeenCalledWith("add_topup_credits", expect.anything())
      expect(mockLogTransaction).not.toHaveBeenCalledWith(
        expect.objectContaining({ creditType: "topup" }),
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
      cancelAtPeriodEnd: false,
      cancelAt: null as string | null,
      canceledAt: null as string | null,
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

    it("persists scheduled-cancellation fields on the subscription row", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Same tier + same period: the ONLY thing this event carries is the
      // user's portal cancel-at-period-end request. Newer Stripe API shape:
      // cancel_at set, cancel_at_period_end still false.
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-02-01T00:00:00+00:00",
      })

      await handleSubscriptionUpdated({
        ...baseUpdatedData,
        cancelAt: "2026-03-01T00:00:00.000Z",
        canceledAt: "2026-02-05T12:00:00.000Z",
      })

      expect(updatePayloadsFor("subscriptions")).toContainEqual(
        expect.objectContaining({
          cancel_at_period_end: false,
          cancel_at: "2026-03-01T00:00:00.000Z",
          canceled_at: "2026-02-05T12:00:00.000Z",
        }),
      )
    })

    it("clears cancellation fields when the subscription is reactivated", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-02-01T00:00:00+00:00",
      })

      await handleSubscriptionUpdated(baseUpdatedData)

      expect(updatePayloadsFor("subscriptions")).toContainEqual(
        expect.objectContaining({
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
        }),
      )
    })

    it("does not misread the Postgres timestamp format as a renewal (no credit refill)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Same instant the created-handler stored, but read back in Postgres wire
      // format (+00:00) while the webhook computes toISOString() (.000Z). A
      // string compare flags EVERY subscription.updated as a renewal and
      // refills subscription_credits mid-cycle for free.
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-02-01T00:00:00+00:00",
      })

      await handleSubscriptionUpdated(baseUpdatedData)

      expect(mockLogTransaction).not.toHaveBeenCalledWith(
        expect.objectContaining({ source: "subscription_renewal" }),
      )
    })

    it("still detects a real renewal when the period start moves across formats", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-01-01T00:00:00+00:00",
      })

      await handleSubscriptionUpdated(baseUpdatedData)

      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ source: "subscription_renewal" }),
      )
    })

    it("does not invent a renewal when the stored period start is null", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: null,
      })

      await handleSubscriptionUpdated(baseUpdatedData)

      expect(mockLogTransaction).not.toHaveBeenCalledWith(
        expect.objectContaining({ source: "subscription_renewal" }),
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

    it("caps subscription_credits at min(current, the free grant)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // User holds more than the free grant, so cancelling must claw back down.
      const held = TIER_CREDITS.free + 2500
      mockSelect("profiles", { subscription_credits: held })

      await handleSubscriptionCanceled(baseCanceledData)

      const freeCredits = TIER_CREDITS.free
      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: freeCredits - held, // negative (credits removed)
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

    it("grants topup credits via the atomic idempotent RPC", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: true, error: null }) // RPC granted

      await handleTransactionCompleted(baseTransactionData)

      // Claim + grant happen atomically inside the RPC (no separate JS insert).
      expect(mockRpc).toHaveBeenCalledWith("grant_topup_credits_idempotent", {
        p_user_id: "user-001",
        p_credits: 8500,
        p_stripe_transaction_id: "txn_001",
        p_amount_usd: 25, // 2500 cents / 100
      })
      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
    })

    it("sizes a load-session grant from the settled amount via the rate function", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: true, error: null })

      await handleTransactionCompleted({
        ...baseTransactionData,
        lineItems: [], // ad-hoc price_data line items carry no known priceId
        totalAmount: 3700, // $37 — between the $25 and $50 anchors
        metadata: { userId: "user-001", kind: "load", loadUsd: "37" },
      })

      // 8500 + ((37-25)/25) * (17500-8500) = 12,820 — recomputed from the
      // settled amount, never from metadata.
      expect(mockRpc).toHaveBeenCalledWith("grant_topup_credits_idempotent", {
        p_user_id: "user-001",
        p_credits: 12820,
        p_stripe_transaction_id: "txn_001",
        p_amount_usd: 37,
      })
    })

    it("rejects a load session with a non-whole-dollar settled amount", async () => {
      await handleTransactionCompleted({
        ...baseTransactionData,
        lineItems: [],
        totalAmount: 3750, // $37.50 — not a whole dollar
        metadata: { userId: "user-001", kind: "load" },
      })
      expect(mockRpc).not.toHaveBeenCalled()
    })

    it("rejects a load session whose amount is outside the rate bounds", async () => {
      await handleTransactionCompleted({
        ...baseTransactionData,
        lineItems: [],
        totalAmount: 200000, // $2,000 > MAX_LOAD_USD
        metadata: { userId: "user-001", kind: "load" },
      })
      expect(mockRpc).not.toHaveBeenCalled()
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

    it("does not re-grant when the idempotent RPC reports already-processed (duplicate)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Redelivery/replay: the claim already exists, so the RPC returns false
      // without re-granting (no double-credit).
      mockRpc.mockResolvedValueOnce({ data: false, error: null })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
    })

    it("does not invalidate or compensate when the grant RPC errors (atomic → nothing committed)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: "transient db error" } })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
      // Regression guard: NO compensating delete — claim+grant are atomic in the
      // RPC, so a failure leaves nothing committed (deleting a claim was the old,
      // double-grant-prone fix).
      expect(deleteCalls).not.toContainEqual({ table: "transactions" })
    })

    it("returns early if no topup credits found for price (no RPC)", async () => {
      const unknownPriceData = {
        ...baseTransactionData,
        lineItems: [{ priceId: "pri_unknown_price" }],
      }

      await handleTransactionCompleted(unknownPriceData)

      expect(mockRpc).not.toHaveBeenCalled()
      expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
      expect(mockActivateOnPurchase).not.toHaveBeenCalled()
    })

    // ── The free-grant exit by purchase ──────────────────────────────────
    // A withheld signup grant leaves 'withheld' on the first SETTLED purchase
    // (any pack, any card). The hook runs on exactly the path that granted
    // credits: never on a redelivery, never on a failed grant — a redelivered
    // webhook must not re-open a grant an admin has since taken back.

    it("unlocks the signup grant on a FRESH top-up — the purchase is the proof", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: true, error: null })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockActivateOnPurchase).toHaveBeenCalledTimes(1)
      expect(mockActivateOnPurchase).toHaveBeenCalledWith("user-001")
    })

    it("does NOT touch the signup grant on a redelivered (duplicate) top-up", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: false, error: null })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockActivateOnPurchase).not.toHaveBeenCalled()
    })

    it("does NOT touch the signup grant when the grant RPC errors (nothing was committed)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: "transient db error" } })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockActivateOnPurchase).not.toHaveBeenCalled()
    })

    it("a failing grant hook never fails the purchase", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: true, error: null })
      mockActivateOnPurchase.mockRejectedValueOnce(new Error("grant hook exploded"))

      await expect(handleTransactionCompleted(baseTransactionData)).resolves.toBeUndefined()
      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
    })

    it("reports the activation through the request logger when the route passes one", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: true, error: null })
      mockActivateOnPurchase.mockResolvedValueOnce({ activated: true, state: "granted" })
      const log = { info: vi.fn(), error: vi.fn() }

      await handleTransactionCompleted(baseTransactionData, log as never)

      expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-001" }), expect.stringMatching(/activated by purchase/))
      expect(log.error).not.toHaveBeenCalled()
    })

    it("reports a failing hook through the request logger, and still completes the purchase", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: true, error: null })
      mockActivateOnPurchase.mockRejectedValueOnce(new Error("grant hook exploded"))
      const log = { info: vi.fn(), error: vi.fn() }

      await expect(handleTransactionCompleted(baseTransactionData, log as never)).resolves.toBeUndefined()

      expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-001" }), expect.stringMatching(/failed/))
      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // handleAutoRechargeSucceeded — same exit, same gate
  // ════════════════════════════════════════════════════════════════════════

  describe("handleAutoRechargeSucceeded", () => {
    const recharge = { piId: "pi_auto_1", userId: "user-001", amountReceivedCents: 2500 }

    it("unlocks the signup grant on a FRESH auto-recharge grant", async () => {
      mockRpc.mockResolvedValueOnce({ data: true, error: null })

      await handleAutoRechargeSucceeded(recharge)

      expect(mockActivateOnPurchase).toHaveBeenCalledWith("user-001")
    })

    it("does NOT touch the signup grant on a duplicate or a failed grant", async () => {
      mockRpc.mockResolvedValueOnce({ data: false, error: null })
      await handleAutoRechargeSucceeded(recharge)

      mockRpc.mockResolvedValueOnce({ data: null, error: { message: "db down" } })
      await handleAutoRechargeSucceeded(recharge)

      expect(mockActivateOnPurchase).not.toHaveBeenCalled()
    })
  })
})
