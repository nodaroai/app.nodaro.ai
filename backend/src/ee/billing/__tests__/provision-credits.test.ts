import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  ENDED_SUBSCRIPTION_CREDITS,
  STRIPE_PRODUCTS,
  TIER_CREDITS,
  TIER_STORAGE_LIMITS,
} from "../stripe-config.js"
import { StripeEventRetryError } from "../stripe-event-retry.js"
import { LIVE_SUBSCRIPTION_STATUSES } from "../downgrade-floor.js"
import { PAID_TIER_STATUSES } from "../subscription-grant.js"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const {
  mockFrom,
  mockRpc,
  selectResponses,
  writeErrors,
  writeRows,
  listRows,
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
  // Rows a write returns when it asks for them (`.update(...).select(...)`):
  // opt-in per table (peek-last like the reads); null when none is queued.
  const writeRows = new Map<string, Array<unknown>>()
  // Rows an awaited read (no .single()) answers with: opt-in per table, peek-last.
  const listRows = new Map<string, Array<unknown>>()
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
  function shiftWriteRows(table: string): unknown {
    const queue = writeRows.get(table)
    if (!queue || queue.length === 0) return null
    if (queue.length === 1) return queue[0]
    return queue.shift()!
  }

  function createChain(table: string) {
    const chain: Record<string, unknown> = {}
    let isWrite = false
    let returning = false

    const self = () => chain
    const write = () => { isWrite = true; return chain }

    chain.select = vi.fn(() => { if (isWrite) returning = true; return chain })
    chain.eq = vi.fn(self)
    chain.neq = vi.fn(self)
    chain.is = vi.fn(self)
    chain.in = vi.fn(self)
    chain.not = vi.fn(self)
    chain.insert = vi.fn(write)
    chain.update = vi.fn(write)
    chain.upsert = vi.fn(write)
    chain.delete = vi.fn(() => {
      deleteCalls.push({ table })
      return chain
    })
    chain.single = vi.fn(() => Promise.resolve(shiftResponse(table)))
    chain.maybeSingle = vi.fn(() => Promise.resolve(shiftResponse(table)))

    // Make the chain "thenable" so `await supabase.from("x").update({}).eq()`
    // resolves. Default success unless a writeErrors entry is queued.
    chain.then = (resolve: (v: unknown) => void) => {
      if (!isWrite) {
        const queue = listRows.get(table)
        if (queue && queue.length > 0) {
          resolve({ data: queue.length === 1 ? queue[0] : queue.shift(), error: null })
          return
        }
      }
      const error = shiftWriteError(table)
      resolve({ data: isWrite && returning && !error ? shiftWriteRows(table) : null, error })
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
    writeRows.clear()
    listRows.clear()
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
    writeRows,
    listRows,
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
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))

// The free-grant exit by purchase (signup-grant.ts). Mocked at the module
// seam: these tests pin WHEN the webhook calls it, its own tests pin WHAT it does.
const { mockActivateOnPurchase, mockReleaseQuietStop } = vi.hoisted(() => ({
  mockActivateOnPurchase: vi.fn().mockResolvedValue({ activated: false, state: "granted" }),
  mockReleaseQuietStop: vi.fn().mockResolvedValue({ released: false }),
}))
vi.mock("@/ee/billing/signup-grant.js", () => ({
  activateSignupGrantOnPurchase: mockActivateOnPurchase,
}))
// The quiet stop ends on the same purchase (free credits, never money); the
// same seam — WHEN it is called is pinned here, WHAT it does in its own tests.
vi.mock("@/ee/lib/account-blocking.js", () => ({
  releaseQuietStopOnPurchase: mockReleaseQuietStop,
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

/** Enqueue the rows the next awaited read (no .single()) on a table answers with. */
function mockList(table: string, rows: unknown[]) {
  const queue = listRows.get(table) ?? []
  queue.push(rows)
  listRows.set(table, queue)
}

/** Enqueue the rows the next returning write on a table answers with. */
function mockWriteRows(table: string, rows: unknown[]) {
  const queue = writeRows.get(table) ?? []
  queue.push(rows)
  writeRows.set(table, queue)
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
    mockReleaseQuietStop.mockClear()
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

    it("handles tier upgrade (moves the tier, never SETs credits — the paid invoice grants the gap)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      // Existing subscription is basic tier, same period (not a renewal)
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.basic.monthly,
        tier: "basic",
        current_period_start: "2026-02-01T00:00:00Z",
      })

      await handleSubscriptionUpdated(baseUpdatedData)

      expect(updatePayloadsFor("profiles").some((p) => "subscription_credits" in p)).toBe(false)
      expect(updatePayloadsFor("profiles")).toContainEqual(expect.objectContaining({ subscription_tier: "pro" }))
      // The plan being left is recorded as held this period.
      expect(mockRpc).toHaveBeenCalledWith("note_plan_credit_peak", { p_user_id: "user-001", p_credits: TIER_CREDITS.basic })

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

    // Pinned 2026-10-15 with the yearly-plan monthly grant, which does the
    // same thing between the yearly renewals: unused subscription credits
    // expire at every reset. The renewal SETs the plan's monthly amount (it
    // never adds to what is left, and never reads it) and never touches the
    // top-up pool — on a monthly price and on a yearly price whose year moved.
    it.each([
      {
        cycle: "monthly",
        priceId: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        storedStart: "2026-01-01T00:00:00+00:00",
        incoming: { currentPeriodStart: "2026-02-01T00:00:00.000Z", currentPeriodEnd: "2026-03-01T00:00:00.000Z" },
      },
      {
        cycle: "yearly",
        priceId: STRIPE_PRODUCTS.standard.yearly,
        tier: "standard",
        storedStart: "2025-10-12T00:00:00+00:00",
        incoming: { currentPeriodStart: "2026-10-12T00:00:00.000Z", currentPeriodEnd: "2027-10-12T00:00:00.000Z" },
      },
    ])("renewal on a $cycle price SETs the plan's monthly amount — never adds, never touches top-ups", async ({ priceId, tier, storedStart, incoming }) => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: priceId,
        tier,
        current_period_start: storedStart,
      })

      await handleSubscriptionUpdated({ ...baseUpdatedData, priceId, ...incoming })

      const resets = updatePayloadsFor("profiles").filter((p) => "subscription_credits" in p)
      expect(resets).toEqual([
        { subscription_credits: TIER_CREDITS[tier], credits_reset_at: expect.any(String) },
      ])
      expect(updatePayloadsFor("profiles").some((p) => "topup_credits" in p)).toBe(false)
      expect(mockRpc).not.toHaveBeenCalled()
      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ source: "subscription_renewal", amount: TIER_CREDITS[tier], balanceAfter: TIER_CREDITS[tier] }),
      )
    })

    // Stripe "pause payment collection" changes nothing else on the event; the
    // monthly grant on yearly plans refuses a paused row (migration 527).
    it.each([
      { paused: true, expected: true },
      { paused: false, expected: false },
    ])("stores collection_paused = $expected from the event's pause_collection", async ({ paused, expected }) => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-02-01T00:00:00+00:00",
      })

      await handleSubscriptionUpdated({ ...baseUpdatedData, collectionPaused: paused })

      expect(updatePayloadsFor("subscriptions")).toContainEqual({ collection_paused: expected })
    })

    it("a database without the collection_paused column (staging ahead of main) still takes the rest of the update", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("subscriptions", {
        id: "sub-id",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-02-01T00:00:00+00:00",
      })
      // The main subscriptions update succeeds; the pause write is refused.
      mockWriteError("subscriptions", null as unknown as { code?: string })
      mockWriteError("subscriptions", { code: "PGRST204", message: "Could not find the 'collection_paused' column" })

      await expect(handleSubscriptionUpdated({ ...baseUpdatedData, collectionPaused: true })).resolves.toBeUndefined()

      expect(updatePayloadsFor("subscriptions")).toContainEqual(expect.objectContaining({ status: "active" }))
      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
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

    /** Every `profiles` UPDATE payload this test's handler wrote. */
    function profileUpdates(): Array<Record<string, unknown>> {
      return updatePayloadsFor("profiles")
    }

    /**
     * A paid subscription ending: its stored row (granted), the account on a
     * paid tier holding `credits`, and the compare-and-set write matching.
     */
    function endingPlan(credits: number, profile: Record<string, unknown> = {}) {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteRows("subscriptions", [{ plan_granted: true }])
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: credits, ...profile })
      mockWriteRows("profiles", [{ id: "user-001" }])
    }

    it("downgrades to free tier immediately", async () => {
      endingPlan(30)

      await handleSubscriptionCanceled(baseCanceledData)

      const calledTables = mockFrom.mock.calls.map((c: unknown[]) => c[0])
      expect(calledTables).toContain("subscriptions")
      expect(profileUpdates()).toContainEqual(expect.objectContaining({ tier: "free", subscription_tier: "free" }))
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

    it("the plan's remaining credits end with it: 0, never the free grant, nothing added", async () => {
      // More than the free grant: all of it ends with the plan.
      const held = TIER_CREDITS.free + 2500
      endingPlan(held)

      await handleSubscriptionCanceled(baseCanceledData)

      expect(ENDED_SUBSCRIPTION_CREDITS).toBe(0)
      expect(profileUpdates()).toContainEqual(expect.objectContaining({ subscription_credits: 0 }))
      expect(mockLogTransaction).toHaveBeenCalledTimes(1)
      expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: -held, balanceAfter: 0 }))
    })

    it("fewer than the free grant left: still 0 — a former subscriber is not topped up to the free grant", async () => {
      endingPlan(20)

      await handleSubscriptionCanceled(baseCanceledData)

      expect(profileUpdates()).toContainEqual(expect.objectContaining({ subscription_credits: 0 }))
      expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: -20, balanceAfter: 0 }))
      // Top-up credits are never part of the write.
      for (const update of profileUpdates()) expect(update).not.toHaveProperty("topup_credits")
    })

    it("nothing left to end: the plan still ends, but no ledger line for nothing", async () => {
      endingPlan(0)

      await handleSubscriptionCanceled(baseCanceledData)

      expect(profileUpdates()).toContainEqual(expect.objectContaining({ subscription_credits: 0, tier: "free" }))
      expect(mockLogTransaction).not.toHaveBeenCalled()
    })

    it("credits that move between the read and the write: read again, the ledger states exactly what was removed", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteRows("subscriptions", [{ plan_granted: true }])
      // The tier read, then the plan end's first read, then its second read.
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: 500 })
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: 500 })
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: 480 })
      // The first compare-and-set matches nothing (a run settled 20 in between).
      mockWriteRows("profiles", [])
      mockWriteRows("profiles", [{ id: "user-001" }])

      await handleSubscriptionCanceled(baseCanceledData)

      expect(mockLogTransaction).toHaveBeenCalledTimes(1)
      expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: -480, balanceAfter: 0 }))
    })

    it("no stored subscription row (the unpaid insert failed): the account is left as it was", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteRows("subscriptions", [])
      mockSelect("profiles", { tier: "free", subscription_tier: "free", subscription_credits: 300 })

      await handleSubscriptionCanceled(baseCanceledData)

      expect(profileUpdates()).toEqual([])
      expect(mockLogTransaction).not.toHaveBeenCalled()
    })

    it("the cancel UPDATE fails: nothing is written to the account and Stripe is asked to deliver the event again", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteError("subscriptions", { code: "XX000", message: "write failed" })
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: 9000 })

      await expect(handleSubscriptionCanceled(baseCanceledData)).rejects.toBeInstanceOf(StripeEventRetryError)

      expect(profileUpdates()).toEqual([])
      expect(mockLogTransaction).not.toHaveBeenCalled()
    })

    it("a redelivered delete after a welcome grant was claimed: the account is on the free tier, its credits are left alone", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteRows("subscriptions", [{ plan_granted: true }])
      mockSelect("profiles", { tier: "free", subscription_tier: "free", subscription_credits: TIER_CREDITS.free })

      await handleSubscriptionCanceled(baseCanceledData)

      expect(profileUpdates()).toEqual([])
      expect(mockLogTransaction).not.toHaveBeenCalled()
    })

    it("a late delete for an old subscription after a re-subscribe: the new plan's credits and tier are untouched", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteRows("subscriptions", [{ plan_granted: true }])
      mockList("subscriptions", [{ stripe_subscription_id: "sub_new" }])
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: TIER_CREDITS.pro })

      await handleSubscriptionCanceled(baseCanceledData)

      expect(profileUpdates()).toEqual([])
      expect(mockLogTransaction).not.toHaveBeenCalled()
    })

    it("a subscription that was never paid: the account is left as it was", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteRows("subscriptions", [{ plan_granted: false }])
      mockSelect("profiles", { tier: "free", subscription_tier: "free", subscription_credits: 300 })

      await handleSubscriptionCanceled(baseCanceledData)

      expect(profileUpdates()).toEqual([])
      expect(mockLogTransaction).not.toHaveBeenCalled()
    })

    it("the plan end's own live-subscription list is the paid-tier statuses", () => {
      expect(new Set(LIVE_SUBSCRIPTION_STATUSES)).toEqual(PAID_TIER_STATUSES)
    })

    it("a plan granted while the end was retrying (re-subscribe): the retry finds it live and ends nothing", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteRows("subscriptions", [{ plan_granted: true }])
      // The webhook's own check, then attempt 1 — nothing live yet — then
      // attempt 2: subscription B was paid and granted in between.
      mockList("subscriptions", [])
      mockList("subscriptions", [])
      mockList("subscriptions", [{ stripe_subscription_id: "sub_B" }])
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: 500, credits_reset_at: "2026-01-01T00:00:00Z" })
      // Attempt 1's compare-and-set misses: B's grant rewrote the row.
      mockWriteRows("profiles", [])

      await handleSubscriptionCanceled(baseCanceledData)

      expect(mockLogTransaction).not.toHaveBeenCalled()
      expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
      // One write was attempted (and matched nothing); none after B was found.
      expect(profileUpdates()).toHaveLength(1)
    })

    it("the compare-and-set includes the credit-period stamp, so a re-grant with the same credits still misses", async () => {
      endingPlan(500, { credits_reset_at: "2026-01-01T00:00:00Z" })

      await handleSubscriptionCanceled(baseCanceledData)

      const profileChains = mockFrom.mock.calls
        .map((c: unknown[], i: number) => ({ table: c[0], chain: mockFrom.mock.results[i]!.value as { update: { mock: { calls: unknown[] } }; eq: { mock: { calls: unknown[][] } } } }))
        .filter((r) => r.table === "profiles" && r.chain.update.mock.calls.length > 0)
      expect(profileChains).toHaveLength(1)
      expect(profileChains[0]!.chain.eq.mock.calls).toEqual(
        expect.arrayContaining([["subscription_credits", 500], ["credits_reset_at", "2026-01-01T00:00:00Z"]]),
      )
    })

    it("updated(canceled) first, then deleted, for an immediate cancellation: the plan ends exactly once", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockSelect("subscriptions", {
        id: "sub-id",
        status: "active",
        stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
        tier: "pro",
        current_period_start: "2026-02-01T00:00:00Z",
        current_period_end: "2026-03-01T00:00:00Z",
        cancel_at_period_end: false,
        plan_granted: true,
      })
      mockWriteRows("subscriptions", [{ id: "sub-id", plan_granted: true }])
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: 5000 })
      mockWriteRows("profiles", [{ id: "user-001" }])

      // Stripe's `updated` saying "canceled" lands first: the row is marked, the plan is not ended.
      await handleSubscriptionUpdated({
        subscriptionId: "sub_001",
        stripeCustomerId: "cus_001",
        priceId: STRIPE_PRODUCTS.pro.monthly,
        status: "canceled",
        currentPeriodStart: "2026-02-01T00:00:00Z",
        currentPeriodEnd: "2026-03-01T00:00:00Z",
        cancelAtPeriodEnd: false,
        cancelAt: null,
        canceledAt: "2026-02-10T00:00:00Z",
        metadata: null,
      })
      expect(profileUpdates().filter((u) => "subscription_credits" in u)).toEqual([])

      // The delete then ends it: once.
      await handleSubscriptionCanceled(baseCanceledData)
      expect(profileUpdates().filter((u) => "subscription_credits" in u)).toEqual([expect.objectContaining({ subscription_credits: 0, tier: "free" })])
      expect(mockLogTransaction).toHaveBeenCalledTimes(1)
      expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: -5000, source: "expiry" }))

      // A redelivery of the delete finds the account on free: nothing more.
      selectResponses.set("profiles", [{ data: { tier: "free", subscription_tier: "free", subscription_credits: 0 }, error: null }])
      await handleSubscriptionCanceled(baseCanceledData)
      expect(profileUpdates().filter((u) => "subscription_credits" in u)).toHaveLength(1)
      expect(mockLogTransaction).toHaveBeenCalledTimes(1)
    })

    it("TODAY: an admin-set paid tier on a former subscriber, then a late delete of the old subscription — that tier and its credits are ended", async () => {
      // No live subscription; the account was put on pro by an admin after its
      // old plan ended. The late delete cannot tell that tier from the old
      // plan's (no per-subscription "plan ended" marker yet), so it ends it.
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockWriteRows("subscriptions", [{ plan_granted: true }])
      mockSelect("profiles", { tier: "pro", subscription_tier: "pro", subscription_credits: TIER_CREDITS.pro })
      mockWriteRows("profiles", [{ id: "user-001" }])

      await handleSubscriptionCanceled(baseCanceledData)

      expect(profileUpdates()).toContainEqual(expect.objectContaining({ tier: "free", subscription_credits: 0 }))
      expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: -TIER_CREDITS.pro }))
    })

    it("sets storage_limit to 1GB", async () => {
      endingPlan(20)

      await handleSubscriptionCanceled(baseCanceledData)

      expect(TIER_STORAGE_LIMITS.free).toBe(1 * 1024 * 1024 * 1024)
      expect(profileUpdates()).toContainEqual(expect.objectContaining({ storage_limit_bytes: TIER_STORAGE_LIMITS.free }))
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
      // … and the same purchase ends a quiet stop.
      expect(mockReleaseQuietStop).toHaveBeenCalledTimes(1)
      expect(mockReleaseQuietStop).toHaveBeenCalledWith("user-001")
    })

    it("does NOT touch the signup grant on a redelivered (duplicate) top-up", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: false, error: null })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockActivateOnPurchase).not.toHaveBeenCalled()
      expect(mockReleaseQuietStop).not.toHaveBeenCalled()
    })

    it("does NOT touch the signup grant when the grant RPC errors (nothing was committed)", async () => {
      mockSelect("stripe_customers", { user_id: "user-001" })
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: "transient db error" } })

      await handleTransactionCompleted(baseTransactionData)

      expect(mockActivateOnPurchase).not.toHaveBeenCalled()
      expect(mockReleaseQuietStop).not.toHaveBeenCalled()
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
