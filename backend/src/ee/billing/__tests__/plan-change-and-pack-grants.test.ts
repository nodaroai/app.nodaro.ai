/**
 * What a plan change and a credit pack grant, at the webhook handlers.
 *
 *   - A tier change seen on `customer.subscription.updated` moves no credits.
 *     Credits for an upgrade arrive only with its PAID invoice
 *     (`invoice.paid`, `billing_reason = subscription_update`), as the gap
 *     between the old and the new plan, through one keyed, idempotent RPC
 *     (`grant_plan_change_credits`, migration 600) that also holds the
 *     period's peak, so moving down and back up inside one period grants
 *     nothing twice (proven against Postgres by
 *     supabase/tests/plan-change-credits.behavior.sql).
 *   - A tier change notes the outgoing plan's credits as the period's peak.
 *   - A renewal still SETs the plan's full monthly amount.
 *   - A credit pack that settled for nothing grants nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { STRIPE_PRODUCTS, TIER_CREDITS } from "../stripe-config.js"

const {
  mockFrom,
  mockRpc,
  selectResponses,
  resetMockState,
  mockLogTransaction,
  mockInvalidateBalanceCache,
} = vi.hoisted(() => {
  const selectResponses = new Map<string, Array<{ data: unknown; error: unknown }>>()

  function shiftResponse(table: string): { data: unknown; error: unknown } {
    const queue = selectResponses.get(table)
    if (!queue || queue.length === 0) return { data: null, error: { code: "PGRST116" } }
    if (queue.length === 1) return queue[0]
    return queue.shift()!
  }

  function createChain(table: string) {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.select = vi.fn(self)
    chain.eq = vi.fn(self)
    chain.in = vi.fn(self)
    chain.not = vi.fn(self)
    chain.insert = vi.fn(self)
    chain.update = vi.fn(self)
    chain.upsert = vi.fn(self)
    chain.single = vi.fn(() => Promise.resolve(shiftResponse(table)))
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    return chain
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table))
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockLogTransaction = vi.fn().mockResolvedValue(undefined)
  const mockInvalidateBalanceCache = vi.fn()

  function resetMockState() {
    selectResponses.clear()
    mockFrom.mockClear()
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ data: null, error: null })
    mockLogTransaction.mockClear()
    mockInvalidateBalanceCache.mockClear()
  }

  return { mockFrom, mockRpc, selectResponses, resetMockState, mockLogTransaction, mockInvalidateBalanceCache }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: mockRpc },
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: mockLogTransaction } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: mockInvalidateBalanceCache }))
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))
vi.mock("@/ee/billing/signup-grant.js", () => ({
  activateSignupGrantOnPurchase: vi.fn().mockResolvedValue({ activated: false, state: "granted" }),
}))
vi.mock("@/ee/lib/account-blocking.js", () => ({
  releaseQuietStopOnPurchase: vi.fn().mockResolvedValue({ released: false }),
}))

import {
  handleSubscriptionUpdated,
  handleInvoicePaid,
  handleTransactionCompleted,
} from "../provision-credits.js"

function mockSelect(table: string, data: unknown, error: unknown = null) {
  const queue = selectResponses.get(table) ?? []
  queue.push({ data, error })
  selectResponses.set(table, queue)
}

/** Every payload passed to from(table).<method>(...). */
function payloadsFor(table: string, method: "update" | "upsert" | "insert"): Array<Record<string, unknown>> {
  return mockFrom.mock.calls.flatMap((call: unknown[], i: number) => {
    if (call[0] !== table) return []
    const chain = mockFrom.mock.results[i]?.value as Record<string, { mock: { calls: Array<[Record<string, unknown>]> } }>
    return chain?.[method]?.mock.calls.map((c) => c[0]) ?? []
  })
}

function rpcCalls(name: string): Array<Record<string, unknown>> {
  return mockRpc.mock.calls.filter((c: unknown[]) => c[0] === name).map((c: unknown[]) => c[1] as Record<string, unknown>)
}

beforeEach(() => {
  resetMockState()
})

describe("customer.subscription.updated — a tier change moves no credits", () => {
  const base = {
    subscriptionId: "sub_001",
    stripeCustomerId: "cus_001",
    status: "active",
    currentPeriodStart: "2026-02-01T00:00:00.000Z",
    currentPeriodEnd: "2026-03-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    cancelAt: null as string | null,
    canceledAt: null as string | null,
    metadata: null,
  }

  it("an upgrade never SETs subscription_credits (the paid invoice grants the gap)", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", {
      id: "sub-id",
      stripe_price_id: STRIPE_PRODUCTS.basic.monthly,
      tier: "basic",
      current_period_start: "2026-02-01T00:00:00+00:00",
    })

    await handleSubscriptionUpdated({ ...base, priceId: STRIPE_PRODUCTS.pro.monthly })

    expect(payloadsFor("profiles", "update").filter((p) => "subscription_credits" in p)).toEqual([])
    // The tier itself still follows Stripe.
    expect(payloadsFor("profiles", "update")).toContainEqual(expect.objectContaining({ subscription_tier: "pro" }))
  })

  it("a downgrade then an upgrade inside one period sets nothing either way", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", {
      id: "sub-id",
      stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
      tier: "pro",
      current_period_start: "2026-02-01T00:00:00+00:00",
    })
    await handleSubscriptionUpdated({ ...base, priceId: STRIPE_PRODUCTS.basic.monthly })

    mockSelect("subscriptions", {
      id: "sub-id",
      stripe_price_id: STRIPE_PRODUCTS.basic.monthly,
      tier: "basic",
      current_period_start: "2026-02-01T00:00:00+00:00",
    })
    await handleSubscriptionUpdated({ ...base, priceId: STRIPE_PRODUCTS.pro.monthly })

    expect(payloadsFor("profiles", "update").filter((p) => "subscription_credits" in p)).toEqual([])
  })

  it("a tier change notes the outgoing plan's credits as this period's peak", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", {
      id: "sub-id",
      stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
      tier: "pro",
      current_period_start: "2026-02-01T00:00:00+00:00",
    })

    await handleSubscriptionUpdated({ ...base, priceId: STRIPE_PRODUCTS.basic.monthly })

    expect(rpcCalls("note_plan_credit_peak")).toEqual([{ p_user_id: "user-001", p_credits: TIER_CREDITS.pro }])
  })

  it("a renewal still SETs the full monthly amount and calls no plan-change RPC", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", {
      id: "sub-id",
      stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
      tier: "pro",
      current_period_start: "2026-01-01T00:00:00+00:00",
    })

    await handleSubscriptionUpdated({ ...base, priceId: STRIPE_PRODUCTS.pro.monthly })

    expect(payloadsFor("profiles", "update").filter((p) => "subscription_credits" in p)).toEqual([
      { subscription_credits: TIER_CREDITS.pro, credits_reset_at: expect.any(String) },
    ])
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe("customer.subscription.updated — a monthly <-> yearly switch is not a renewal", () => {
  const event = {
    subscriptionId: "sub_001",
    stripeCustomerId: "cus_001",
    status: "active",
    cancelAtPeriodEnd: false,
    cancelAt: null as string | null,
    canceledAt: null as string | null,
    metadata: null,
  }

  it("a monthly -> yearly -> monthly round trip inside one period sets no credits and restarts the credit period each time", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    // Monthly, Nov 1 → Dec 1; switched to yearly on Nov 20 (Stripe restarts the period there).
    mockSelect("subscriptions", {
      id: "sub-id",
      stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
      tier: "pro",
      current_period_start: "2026-11-01T00:00:00+00:00",
      current_period_end: "2026-12-01T00:00:00+00:00",
    })
    await handleSubscriptionUpdated({
      ...event,
      priceId: STRIPE_PRODUCTS.pro.yearly,
      currentPeriodStart: "2026-11-20T00:00:00.000Z",
      currentPeriodEnd: "2027-11-20T00:00:00.000Z",
    })

    // ...and back to monthly on Nov 22.
    mockSelect("subscriptions", {
      id: "sub-id",
      stripe_price_id: STRIPE_PRODUCTS.pro.yearly,
      tier: "pro",
      current_period_start: "2026-11-20T00:00:00+00:00",
      current_period_end: "2027-11-20T00:00:00+00:00",
    })
    await handleSubscriptionUpdated({
      ...event,
      priceId: STRIPE_PRODUCTS.pro.monthly,
      currentPeriodStart: "2026-11-22T00:00:00.000Z",
      currentPeriodEnd: "2026-12-22T00:00:00.000Z",
    })

    expect(payloadsFor("profiles", "update").filter((p) => "subscription_credits" in p)).toEqual([])
    expect(payloadsFor("profiles", "update").filter((p) => "credits_reset_at" in p)).toEqual([])
    expect(rpcCalls("restart_plan_credit_period")).toEqual([
      { p_user_id: "user-001", p_held_credits: TIER_CREDITS.pro },
      { p_user_id: "user-001", p_held_credits: TIER_CREDITS.pro },
    ])
    expect(mockLogTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("Subscription renewal") }),
    )
  })

  it.each([
    { when: "where the stored period ends", start: "2026-12-01T00:00:00.000Z" },
    { when: "after the stored period ends (a late event)", start: "2027-01-01T00:00:00.000Z" },
  ])("a real renewal starting $when still SETs the full monthly amount", async ({ start }) => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", {
      id: "sub-id",
      stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
      tier: "pro",
      current_period_start: "2026-11-01T00:00:00+00:00",
      current_period_end: "2026-12-01T00:00:00+00:00",
    })

    await handleSubscriptionUpdated({
      ...event,
      priceId: STRIPE_PRODUCTS.pro.monthly,
      currentPeriodStart: start,
      currentPeriodEnd: "2027-02-01T00:00:00.000Z",
    })

    expect(payloadsFor("profiles", "update").filter((p) => "subscription_credits" in p)).toEqual([
      { subscription_credits: TIER_CREDITS.pro, credits_reset_at: expect.any(String) },
    ])
    expect(rpcCalls("restart_plan_credit_period")).toEqual([])
  })
})

describe("invoice.paid — the paid plan-change invoice grants the gap, once", () => {
  const upgradeInvoice = {
    invoiceId: "in_upgrade_1",
    subscriptionId: "sub_001",
    stripeCustomerId: "cus_001",
    amountPaid: 1850,
    metadata: null,
    billingReason: "subscription_update",
    lines: [
      { priceId: STRIPE_PRODUCTS.basic.monthly, amount: -650 },
      { priceId: STRIPE_PRODUCTS.pro.monthly, amount: 2500 },
    ],
  }

  it("grants through the keyed RPC: old plan as the floor, new plan as the target", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ claimed: true, granted_credits: TIER_CREDITS.pro - TIER_CREDITS.basic }], error: null })

    await handleInvoicePaid(upgradeInvoice)

    expect(rpcCalls("grant_plan_change_credits")).toEqual([
      {
        p_user_id: "user-001",
        p_invoice_id: "in_upgrade_1",
        p_from_credits: TIER_CREDITS.basic,
        p_to_credits: TIER_CREDITS.pro,
        p_amount_usd: 18.5,
        p_tier: "pro",
      },
    ])
    // The RPC writes the transactions row itself (it IS the claim): no
    // second row recording the plan's full credits for this invoice.
    expect(payloadsFor("transactions", "upsert")).toEqual([])
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
  })

  it("a replayed invoice is a no-op after its claim", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ claimed: false, granted_credits: 0 }], error: null })

    await handleInvoicePaid(upgradeInvoice)

    expect(rpcCalls("grant_plan_change_credits")).toHaveLength(1)
    expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
  })

  it("a downgrade swept into the same invoice raises the floor to the plan already held", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ claimed: true, granted_credits: 0 }], error: null })

    await handleInvoicePaid({
      ...upgradeInvoice,
      lines: [
        { priceId: STRIPE_PRODUCTS.pro.monthly, amount: -1200 }, // unused pro (the earlier downgrade)
        { priceId: STRIPE_PRODUCTS.basic.monthly, amount: 300 }, // remaining basic
        { priceId: STRIPE_PRODUCTS.basic.monthly, amount: -300 }, // unused basic (this upgrade)
        { priceId: STRIPE_PRODUCTS.pro.monthly, amount: 1200 }, // remaining pro
      ],
    })

    expect(rpcCalls("grant_plan_change_credits")).toEqual([
      expect.objectContaining({ p_from_credits: TIER_CREDITS.pro, p_to_credits: TIER_CREDITS.pro }),
    ])
  })

  it("an invoice with no known plan price on a charged line grants nothing", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })

    await handleInvoicePaid({ ...upgradeInvoice, lines: [{ priceId: "price_unknown", amount: 900 }] })

    expect(rpcCalls("grant_plan_change_credits")).toEqual([])
  })

  it("an upgrade invoice paid with 0 (a 100%-off coupon) grants nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })

    await handleInvoicePaid({ ...upgradeInvoice, amountPaid: 0 })

    expect(rpcCalls("grant_plan_change_credits")).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("paid with 0"))
    warn.mockRestore()
  })

  it("a renewal invoice keeps today's record and grants nothing here (the renewal SETs)", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })

    await handleInvoicePaid({ ...upgradeInvoice, invoiceId: "in_cycle_1", billingReason: "subscription_cycle", lines: [] })

    expect(mockRpc).not.toHaveBeenCalled()
    expect(payloadsFor("transactions", "upsert")).toEqual([
      expect.objectContaining({ stripe_transaction_id: "in_cycle_1", type: "subscription", credits_granted: TIER_CREDITS.pro }),
    ])
  })
})

describe("checkout.session.completed — a credit pack that settled for nothing grants nothing", () => {
  const pack = {
    transactionId: "pi_pack_1",
    stripeCustomerId: "cus_001" as string | null,
    subscriptionId: null as string | null,
    lineItems: [{ priceId: "price_1T8T5k6EOX16l3P8a1goDXGm" }],
    totalAmount: 2500,
    metadata: null as Record<string, string> | null,
  }

  it("refuses a pack whose settled amount is 0 (a 100%-off checkout)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockSelect("stripe_customers", { user_id: "user-001" })

    await handleTransactionCompleted({ ...pack, totalAmount: 0 })

    expect(mockRpc).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("a paid pack still grants the pack", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: true, error: null })

    await handleTransactionCompleted(pack)

    expect(rpcCalls("grant_topup_credits_idempotent")).toEqual([
      { p_user_id: "user-001", p_credits: 8500, p_stripe_transaction_id: "pi_pack_1", p_amount_usd: 25 },
    ])
  })
})
