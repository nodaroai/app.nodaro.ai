/**
 * A failed renewal charge puts the period's subscription credits on hold;
 * they come back once, when the renewal is paid (migration 654,
 * subscription-renewal.ts).
 *
 *   - `customer.subscription.updated` that moves the period resets the
 *     credits at once, as it always has, but only on an event that says
 *     `active` or `trialing`; a move that arrives `past_due` resets nothing.
 *   - `past_due` / `unpaid` on a granted subscription holds the credits left
 *     for the period through `hold_subscription_renewal_credits`, and logs it.
 *   - `invoice.paid` with `billing_reason = subscription_cycle` settles through
 *     one funnel, `release_subscription_renewal_credits`, keyed by the invoice:
 *     it records every paid renewal, ADDs a held amount back, or SETs a period
 *     never reset (the catch-up). Once-per-invoice, once-per-period and the
 *     decision itself are proven against Postgres by
 *     supabase/tests/subscription-renewal-credits.behavior.sql.
 *   - A database that could not answer asks Stripe for the event again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type Stripe from "stripe"
import { STRIPE_PRODUCTS, TIER_CREDITS } from "../stripe-config.js"

const { mockFrom, mockRpc, selectResponses, resetMockState, mockLogTransaction, mockInvalidateBalanceCache, mockStripe } = vi.hoisted(() => {
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
  const mockLogTransaction = vi.fn().mockResolvedValue(true)
  const mockInvalidateBalanceCache = vi.fn()
  const mockStripe = { invoices: { listLineItems: vi.fn() } }

  function resetMockState() {
    selectResponses.clear()
    mockFrom.mockClear()
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ data: null, error: null })
    mockLogTransaction.mockClear()
    mockInvalidateBalanceCache.mockClear()
    mockStripe.invoices.listLineItems.mockReset()
  }

  return { mockFrom, mockRpc, selectResponses, resetMockState, mockLogTransaction, mockInvalidateBalanceCache, mockStripe }
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
vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => mockStripe }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: mockLogTransaction } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: mockInvalidateBalanceCache }))
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))
vi.mock("@/ee/billing/signup-grant.js", () => ({
  activateSignupGrantOnPurchase: vi.fn().mockResolvedValue({ activated: false, state: "granted" }),
}))
vi.mock("@/ee/lib/account-blocking.js", () => ({
  releaseQuietStopOnPurchase: vi.fn().mockResolvedValue({ released: false }),
}))

import { handleInvoicePaid, handleSubscriptionUpdated } from "../provision-credits.js"
import { invoiceRenewalLines, renewalPeriodFromLines, type RenewalInvoiceLine } from "../subscription-renewal.js"
import { StripeEventRetryError } from "../stripe-event-retry.js"

function mockSelect(table: string, data: unknown, error: unknown = null) {
  const queue = selectResponses.get(table) ?? []
  queue.push({ data, error })
  selectResponses.set(table, queue)
}

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
const holdCalls = () => rpcCalls("hold_subscription_renewal_credits")
const releaseCalls = () => rpcCalls("release_subscription_renewal_credits")
const poolWrites = () => payloadsFor("profiles", "update").filter((p) => "subscription_credits" in p)

const LAST_START = "2026-11-01T00:00:00+00:00"
const LAST_END = "2026-12-01T00:00:00+00:00"
const PERIOD_START = "2026-12-01T00:00:00.000Z"
const PERIOD_END = "2027-01-01T00:00:00.000Z"

/** The subscription's own line for the new period. */
function planLine(overrides: Partial<RenewalInvoiceLine> = {}): RenewalInvoiceLine {
  return {
    priceId: STRIPE_PRODUCTS.pro.monthly,
    subscriptionId: "sub_001",
    proration: false,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    ...overrides,
  }
}

function renewalInvoice(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: "in_cycle_1",
    subscriptionId: "sub_001",
    stripeCustomerId: "cus_001",
    amountPaid: 2500,
    metadata: null,
    billingReason: "subscription_cycle",
    lines: [],
    renewalLines: [planLine()],
    ...overrides,
  }
}

function update(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionId: "sub_001",
    stripeCustomerId: "cus_001",
    priceId: STRIPE_PRODUCTS.pro.monthly,
    status: "active",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    metadata: null,
    ...overrides,
  }
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-id",
    status: "active",
    stripe_price_id: STRIPE_PRODUCTS.pro.monthly,
    tier: "pro",
    current_period_start: LAST_START,
    current_period_end: LAST_END,
    plan_granted: true,
    ...overrides,
  }
}

beforeEach(() => {
  resetMockState()
})

describe("customer.subscription.updated — the period move", () => {
  it("an active move resets the credits at once and stamps the reset, as before", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", storedRow())

    await handleSubscriptionUpdated(update())

    expect(poolWrites()).toEqual([expect.objectContaining({ subscription_credits: TIER_CREDITS.pro, credits_reset_at: expect.any(String) })])
    expect(mockLogTransaction).toHaveBeenCalledWith(expect.objectContaining({ source: "subscription_renewal", amount: TIER_CREDITS.pro }))
    expect(holdCalls()).toEqual([])
  })

  it("a period already reset (its paid invoice caught it up first) is not reset again by the late move", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", storedRow())
    mockSelect("profiles", { credits_reset_at: "2026-12-01T01:05:00+00:00" })

    await handleSubscriptionUpdated(update())

    expect(poolWrites()).toEqual([])
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })

  it("a move that arrives past_due resets nothing, and holds what is left of the pool", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", storedRow())
    mockRpc.mockResolvedValueOnce({ data: 120, error: null })

    await handleSubscriptionUpdated(update({ status: "past_due" }))

    expect(poolWrites()).toEqual([])
    expect(holdCalls()).toEqual([{ p_user_id: "user-001", p_stripe_subscription_id: "sub_001", p_period_start: PERIOD_START }])
    expect(payloadsFor("subscriptions", "update")).toContainEqual(
      expect.objectContaining({ current_period_start: PERIOD_START, current_period_end: PERIOD_END }),
    )
  })
})

describe("a failed renewal charge holds the period's credits", () => {
  it.each(["past_due", "unpaid"])("%s on a granted subscription holds the pool and logs it", async (status) => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", storedRow({ current_period_start: PERIOD_START, current_period_end: PERIOD_END }))
    mockRpc.mockResolvedValueOnce({ data: 3200, error: null })

    await handleSubscriptionUpdated(update({ status }))

    expect(holdCalls()).toEqual([{ p_user_id: "user-001", p_stripe_subscription_id: "sub_001", p_period_start: PERIOD_START }])
    expect(mockLogTransaction).toHaveBeenCalledWith({
      userId: "user-001",
      amount: -3200,
      creditType: "subscription",
      source: "subscription_renewal",
      description: "Renewal payment failed: 3200 subscription credits on hold until it is paid",
      balanceAfter: 0,
    })
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
  })

  it("a second past_due event for the same period holds nothing more (the database refuses) and logs nothing", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", storedRow({ status: "past_due", current_period_start: PERIOD_START, current_period_end: PERIOD_END }))
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    await handleSubscriptionUpdated(update({ status: "past_due" }))

    expect(holdCalls()).toHaveLength(1)
    expect(mockLogTransaction).not.toHaveBeenCalled()
  })

  it("a subscription never granted holds nothing", async () => {
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", storedRow({ plan_granted: false, status: "incomplete" }))

    await handleSubscriptionUpdated(update({ status: "past_due" }))

    expect(holdCalls()).toEqual([])
  })

  it.each([
    { what: "a database error", error: { code: "57014", message: "statement timeout" } },
    { what: "the function not in the database yet", error: { code: "PGRST202", message: "Could not find the function public.hold_subscription_renewal_credits" } },
  ])("$what asks Stripe for the event again, before any other write", async ({ error }) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockSelect("stripe_customers", { user_id: "user-001" })
    mockSelect("subscriptions", storedRow({ current_period_start: PERIOD_START, current_period_end: PERIOD_END }))
    mockRpc.mockResolvedValueOnce({ data: null, error })

    await expect(handleSubscriptionUpdated(update({ status: "past_due" }))).rejects.toBeInstanceOf(StripeEventRetryError)

    expect(payloadsFor("subscriptions", "update")).toEqual([])
    expect(mockLogTransaction).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe("invoice.paid (subscription_cycle) — the paid renewal settles once", () => {
  it("calls the keyed funnel with the invoice's own plan and period", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: "recorded", credits: 0, balance: null }], error: null })

    await handleInvoicePaid(renewalInvoice())

    expect(releaseCalls()).toEqual([
      {
        p_user_id: "user-001",
        p_stripe_subscription_id: "sub_001",
        p_invoice_id: "in_cycle_1",
        p_period_start: PERIOD_START,
        p_period_end: PERIOD_END,
        p_credits: TIER_CREDITS.pro,
        p_amount_usd: 25,
        p_tier: "pro",
      },
    ])
    // The normal case (reset at the move, never held): recorded, nothing given, nothing logged.
    expect(mockLogTransaction).not.toHaveBeenCalled()
    expect(payloadsFor("transactions", "upsert")).toEqual([])
    expect(payloadsFor("transactions", "insert")).toEqual([])
  })

  it("a released hold logs the amount given back and drops the cache", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: "released", credits: 3200, balance: 3700 }], error: null })

    await handleInvoicePaid(renewalInvoice({ invoiceId: "in_cycle_retry" }))

    expect(mockLogTransaction).toHaveBeenCalledWith({
      userId: "user-001",
      amount: 3200,
      creditType: "subscription",
      source: "subscription_renewal",
      description: "Renewal paid: 3200 subscription credits released",
      balanceAfter: 3700,
    })
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-001")
  })

  it("a period never reset is caught up: logged as a renewal of the invoice's plan", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: "renewed", credits: TIER_CREDITS.pro, balance: TIER_CREDITS.pro }], error: null })

    await handleInvoicePaid(renewalInvoice())

    expect(mockLogTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: TIER_CREDITS.pro,
        description: `Subscription renewal: pro tier (credits reset to ${TIER_CREDITS.pro})`,
        balanceAfter: TIER_CREDITS.pro,
      }),
    )
  })

  it("a hold for another period that the payment drops is logged, never silent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: "dropped", credits: 800, balance: null }], error: null })

    await handleInvoicePaid(renewalInvoice())

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("held 800 credits for another period"))
    expect(mockLogTransaction).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("the same invoice delivered again changes nothing (the database answers replay)", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc
      .mockResolvedValueOnce({ data: [{ outcome: "released", credits: 3200, balance: 3700 }], error: null })
      .mockResolvedValueOnce({ data: [{ outcome: "replay", credits: 0, balance: null }], error: null })

    await handleInvoicePaid(renewalInvoice())
    await handleInvoicePaid(renewalInvoice())

    expect(releaseCalls()).toHaveLength(2)
    expect(mockLogTransaction).toHaveBeenCalledTimes(1)
    expect(mockInvalidateBalanceCache).toHaveBeenCalledTimes(1)
  })

  it("an invoice.paid that arrives before the period-moving update is priced and dated by its line, not the stale row", async () => {
    mockSelect("subscriptions", { tier: "basic", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: "recorded", credits: 0, balance: null }], error: null })

    await handleInvoicePaid(renewalInvoice())

    expect(releaseCalls()).toEqual([expect.objectContaining({ p_credits: TIER_CREDITS.pro, p_tier: "pro", p_period_start: PERIOD_START })])
  })

  it("a downgrade scheduled at the period end prices a catch-up at the NEW plan", async () => {
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: "recorded", credits: 0, balance: null }], error: null })

    await handleInvoicePaid(renewalInvoice({ renewalLines: [planLine({ priceId: STRIPE_PRODUCTS.basic.monthly })] }))

    expect(releaseCalls()).toEqual([expect.objectContaining({ p_credits: TIER_CREDITS.basic, p_tier: "basic" })])
  })

  it("an invoice with no line for its subscription is still recorded, with no period: nothing is given", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: [{ outcome: "recorded", credits: 0, balance: null }], error: null })

    await expect(handleInvoicePaid(renewalInvoice({ renewalLines: [] }))).resolves.toBeUndefined()

    expect(releaseCalls()).toEqual([expect.objectContaining({ p_period_start: null, p_credits: 0, p_tier: "pro" })])
    expect(mockLogTransaction).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it.each([
    { what: "a database error", error: { code: "57014", message: "statement timeout" } },
    { what: "the function not in the database yet", error: { code: "PGRST202", message: "Could not find the function public.release_subscription_renewal_credits" } },
  ])("$what asks Stripe for the event again", async ({ error }) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockSelect("subscriptions", { tier: "pro", user_id: "user-001" })
    mockRpc.mockResolvedValueOnce({ data: null, error })

    await expect(handleInvoicePaid(renewalInvoice())).rejects.toBeInstanceOf(StripeEventRetryError)

    expect(mockLogTransaction).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it("a subscription read that fails (not 'no such row') asks Stripe for the event again", async () => {
    mockSelect("subscriptions", null, { code: "57014", message: "statement timeout" })

    await expect(handleInvoicePaid(renewalInvoice())).rejects.toBeInstanceOf(StripeEventRetryError)

    expect(releaseCalls()).toEqual([])
  })

  it("an unknown subscription is skipped, as before", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    await expect(handleInvoicePaid(renewalInvoice())).resolves.toBeUndefined()
    expect(releaseCalls()).toEqual([])
    vi.restoreAllMocks()
  })
})

describe("which line prices a renewal", () => {
  it("the subscription's own non-proration line: prorations, other subscriptions' lines and period-less lines are ignored", () => {
    const period = renewalPeriodFromLines(
      [
        planLine({ priceId: STRIPE_PRODUCTS.business.monthly, proration: true, periodStart: "2026-11-20T00:00:00.000Z" }),
        planLine({ priceId: STRIPE_PRODUCTS.business.monthly, subscriptionId: "sub_other" }),
        planLine({ priceId: STRIPE_PRODUCTS.business.monthly, periodStart: null }),
        planLine({ priceId: STRIPE_PRODUCTS.standard.monthly }),
      ],
      "sub_001",
      "pro",
    )
    expect(period).toEqual({ tier: "standard", credits: TIER_CREDITS.standard, periodStart: PERIOD_START, periodEnd: PERIOD_END, fromStoredTier: false })
  })

  it("falls back to the stored row's tier only when no line maps to a known plan, with the line's own period", () => {
    const period = renewalPeriodFromLines([planLine({ priceId: "price_not_in_the_catalog", periodStart: "2026-12-03T00:00:00.000Z" })], "sub_001", "standard")
    expect(period).toEqual({ tier: "standard", credits: TIER_CREDITS.standard, periodStart: "2026-12-03T00:00:00.000Z", periodEnd: PERIOD_END, fromStoredTier: true })
  })

  it("never prices a catch-up as the free tier, and has no period without a line", () => {
    expect(renewalPeriodFromLines([planLine({ priceId: "price_not_in_the_catalog" })], "sub_001", "free")).toEqual(
      expect.objectContaining({ tier: null, credits: 0, periodStart: PERIOD_START }),
    )
    expect(renewalPeriodFromLines([], "sub_001", "pro")).toBeNull()
  })

  it("reads Stripe's line shape: the subscription item's line, its price and period; one-off items are left out", async () => {
    const invoice = {
      id: "in_cycle_1",
      lines: {
        has_more: false,
        data: [
          {
            amount: 2500,
            pricing: { price_details: { price: STRIPE_PRODUCTS.pro.monthly } },
            parent: { type: "subscription_item_details", subscription_item_details: { subscription: "sub_001", proration: false, subscription_item: "si_1" } },
            period: { start: Date.parse(PERIOD_START) / 1000, end: Date.parse(PERIOD_END) / 1000 },
          },
          {
            amount: -400,
            pricing: { price_details: { price: { id: STRIPE_PRODUCTS.basic.monthly } } },
            parent: { type: "subscription_item_details", subscription_item_details: { subscription: "sub_001", proration: true, subscription_item: "si_1" } },
            period: { start: Date.parse("2026-11-20T00:00:00.000Z") / 1000, end: Date.parse(PERIOD_START) / 1000 },
          },
          {
            amount: 900,
            pricing: { price_details: { price: "price_one_off" } },
            parent: { type: "invoice_item_details", invoice_item_details: { invoice_item: "ii_1", proration: false, subscription: "sub_001" } },
            period: { start: 0, end: 0 },
          },
        ],
      },
    } as unknown as Stripe.Invoice

    expect(await invoiceRenewalLines(invoice)).toEqual([
      { priceId: STRIPE_PRODUCTS.pro.monthly, subscriptionId: "sub_001", proration: false, periodStart: PERIOD_START, periodEnd: PERIOD_END },
      { priceId: STRIPE_PRODUCTS.basic.monthly, subscriptionId: "sub_001", proration: true, periodStart: "2026-11-20T00:00:00.000Z", periodEnd: PERIOD_START },
    ])
    expect(mockStripe.invoices.listLineItems).not.toHaveBeenCalled()
  })

  it("reads the remaining lines from Stripe when the invoice carries only the first page", async () => {
    mockStripe.invoices.listLineItems.mockResolvedValueOnce({
      has_more: false,
      data: [
        {
          id: "il_2",
          amount: 2500,
          pricing: { price_details: { price: STRIPE_PRODUCTS.pro.monthly } },
          parent: { type: "subscription_item_details", subscription_item_details: { subscription: "sub_001", proration: false, subscription_item: "si_1" } },
          period: { start: Date.parse(PERIOD_START) / 1000, end: Date.parse(PERIOD_END) / 1000 },
        },
      ],
    })
    const invoice = { id: "in_cycle_1", lines: { has_more: true, data: [] } } as unknown as Stripe.Invoice

    expect(await invoiceRenewalLines(invoice)).toHaveLength(1)
    expect(mockStripe.invoices.listLineItems).toHaveBeenCalledWith("in_cycle_1", expect.objectContaining({ limit: 100 }))
  })
})
