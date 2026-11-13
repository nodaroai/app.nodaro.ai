/**
 * The webhook hands every event to the purchase report AFTER its own handling,
 * and the report can never reach the acknowledgement: a handler that throws
 * still reports the payment (the person paid either way), and a report that
 * throws still acknowledges. What counts as a purchase is the report's own
 * business (billing/analytics/__tests__).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { handlers, mockStripe, reportStripePurchase } = vi.hoisted(() => ({
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
  reportStripePurchase: vi.fn(),
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
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/ee/billing/provision-credits.js", () => ({ ...handlers }))
vi.mock("@/ee/billing/org-customer.js", () => ({
  handleOrgPackCompleted: handlers.handleOrgPackCompleted,
  routeClawback: handlers.routeClawback,
}))
vi.mock("@/ee/billing/analytics/report-purchase.js", () => ({ reportStripePurchase }))

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

const paidPack = {
  id: "evt_1",
  type: "checkout.session.completed",
  livemode: true,
  data: {
    object: {
      id: "cs_1",
      mode: "payment",
      payment_intent: "pi_1",
      customer: "cus_1",
      amount_total: 2500,
      currency: "usd",
      payment_status: "paid",
      metadata: { userId: "user-1", topupPriceId: "price_pack" },
    },
  },
}

describe("stripe webhook → purchase report", () => {
  it("reports the event once, after the grant ran", async () => {
    const order: string[] = []
    handlers.handleTransactionCompleted.mockImplementation(async () => { order.push("grant") })
    reportStripePurchase.mockImplementation(() => { order.push("report") })
    const res = await post(paidPack)
    expect(res.statusCode).toBe(200)
    expect(reportStripePurchase).toHaveBeenCalledTimes(1)
    expect(reportStripePurchase.mock.calls[0]?.[0]).toMatchObject({ id: "evt_1", type: "checkout.session.completed" })
    expect(order).toEqual(["grant", "report"])
  })

  it("a handler that throws still reports the payment, and still acknowledges", async () => {
    handlers.handleTransactionCompleted.mockRejectedValue(new Error("db down"))
    const res = await post(paidPack)
    expect(res.statusCode).toBe(200)
    expect(reportStripePurchase).toHaveBeenCalledTimes(1)
  })

  it("a report that throws never reaches the acknowledgement", async () => {
    reportStripePurchase.mockImplementation(() => { throw new Error("analytics broke") })
    const res = await post(paidPack)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })

  it("an event with a bad signature is refused before anything is reported", async () => {
    mockStripe.webhooks.constructEvent.mockImplementationOnce(() => { throw new Error("bad signature") })
    const res = await post(paidPack)
    expect(res.statusCode).toBe(401)
    expect(reportStripePurchase).not.toHaveBeenCalled()
  })
})
