/**
 * The Stripe webhook route's settlement gates, end to end through the route:
 *
 *   - A credit-pack checkout grants only once money settled: a session that
 *     completed with `no_payment_required`, or with an `amount_total` of 0,
 *     grants nothing (personal and organization packs alike) and is logged.
 *   - A paid pack still reaches the grant.
 *   - `invoice.paid` hands the handler the invoice's billing reason and its
 *     priced lines, which is what sizes a plan-change grant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { handlers, mockStripe } = vi.hoisted(() => ({
  handlers: {
    handleSubscriptionCreated: vi.fn(),
    handleSubscriptionUpdated: vi.fn(),
    handleSubscriptionCanceled: vi.fn(),
    handleTransactionCompleted: vi.fn(),
    handleAutoRechargeSucceeded: vi.fn(),
    handleAutoRechargeFailed: vi.fn(),
    handleInvoicePaid: vi.fn(),
    resolveUserId: vi.fn(),
    handleOrgPackCompleted: vi.fn(),
    routeClawback: vi.fn(),
  },
  mockStripe: {
    webhooks: { constructEvent: vi.fn((body: string) => JSON.parse(body)) },
    checkout: { sessions: { listLineItems: vi.fn().mockResolvedValue({ data: [{ price: { id: "price_pack" } }] }) } },
    invoices: { listLineItems: vi.fn() },
    refunds: { list: vi.fn() },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", STRIPE_WEBHOOK_SECRET: "whsec_test" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => mockStripe }))
// The invoice-line reader is real (plan-change-credits.ts); its database and
// cache imports are inert here.
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/ee/billing/provision-credits.js", () => ({
  handleSubscriptionCreated: handlers.handleSubscriptionCreated,
  handleSubscriptionUpdated: handlers.handleSubscriptionUpdated,
  handleSubscriptionCanceled: handlers.handleSubscriptionCanceled,
  handleTransactionCompleted: handlers.handleTransactionCompleted,
  handleAutoRechargeSucceeded: handlers.handleAutoRechargeSucceeded,
  handleAutoRechargeFailed: handlers.handleAutoRechargeFailed,
  handleInvoicePaid: handlers.handleInvoicePaid,
  resolveUserId: handlers.resolveUserId,
}))
vi.mock("@/ee/billing/org-customer.js", () => ({
  handleOrgPackCompleted: handlers.handleOrgPackCompleted,
  routeClawback: handlers.routeClawback,
}))

import { stripeWebhookRoutes } from "../stripe-webhook.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  await app.register(stripeWebhookRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function post(event: unknown) {
  return app.inject({
    method: "POST",
    url: "/v1/billing/stripe-webhook",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=x" },
    payload: JSON.stringify(event),
  })
}

function packSession(overrides: Record<string, unknown>) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        mode: "payment",
        payment_intent: "pi_1",
        customer: "cus_1",
        amount_total: 2500,
        payment_status: "paid",
        metadata: { userId: "user-1", topupPriceId: "price_pack" },
        ...overrides,
      },
    },
  }
}

describe("credit-pack checkout settlement", () => {
  it("a paid pack reaches the grant with its settled amount", async () => {
    const res = await post(packSession({}))
    expect(res.statusCode).toBe(200)
    expect(handlers.handleTransactionCompleted).toHaveBeenCalledTimes(1)
    expect(handlers.handleTransactionCompleted.mock.calls[0][0]).toMatchObject({ transactionId: "pi_1", totalAmount: 2500 })
  })

  it("a pack that completed with no_payment_required grants nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await post(packSession({ payment_status: "no_payment_required", amount_total: 0, payment_intent: null }))
    expect(res.statusCode).toBe(200)
    expect(handlers.handleTransactionCompleted).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("a pack marked paid with an amount_total of 0 grants nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await post(packSession({ amount_total: 0 }))
    expect(handlers.handleTransactionCompleted).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("an organization pack follows the same rule", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await post(packSession({ payment_status: "no_payment_required", amount_total: 0, metadata: { payerKind: "org", orgId: "org-1", packId: "org-50" } }))
    expect(handlers.handleOrgPackCompleted).not.toHaveBeenCalled()
    await post(packSession({ metadata: { payerKind: "org", orgId: "org-1", packId: "org-50" } }))
    expect(handlers.handleOrgPackCompleted).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe("invoice.paid hands the handler what sizes a plan-change grant", () => {
  const invoice = {
    id: "in_1",
    customer: "cus_1",
    amount_paid: 1850,
    billing_reason: "subscription_update",
    parent: { subscription_details: { subscription: "sub_1", metadata: {} } },
    lines: {
      has_more: false,
      data: [
        { amount: -650, pricing: { price_details: { price: "price_basic" } } },
        { amount: 2500, pricing: { price_details: { price: { id: "price_pro" } } } },
        { amount: 0, pricing: null },
      ],
    },
  }

  it("passes the billing reason and every priced line", async () => {
    await post({ id: "evt_2", type: "invoice.paid", data: { object: invoice } })
    expect(handlers.handleInvoicePaid).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: "in_1",
        subscriptionId: "sub_1",
        amountPaid: 1850,
        billingReason: "subscription_update",
        lines: [
          { priceId: "price_basic", amount: -650 },
          { priceId: "price_pro", amount: 2500 },
        ],
      }),
    )
  })

  it("reads the remaining lines from Stripe when the event carries only the first page", async () => {
    mockStripe.invoices.listLineItems.mockResolvedValue({
      has_more: false,
      data: [
        { amount: -650, pricing: { price_details: { price: "price_basic" } } },
        { amount: 2500, pricing: { price_details: { price: "price_pro" } } },
        { amount: 900, pricing: { price_details: { price: "price_business" } } },
      ],
    })
    await post({ id: "evt_3", type: "invoice.paid", data: { object: { ...invoice, lines: { has_more: true, data: invoice.lines.data.slice(0, 1) } } } })
    expect(mockStripe.invoices.listLineItems).toHaveBeenCalledWith("in_1", expect.objectContaining({ limit: 100 }))
    expect(handlers.handleInvoicePaid.mock.calls[0][0].lines).toHaveLength(3)
  })
})
