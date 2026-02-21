import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures these exist before the hoisted vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockUnmarshal,
  mockHandleSubscriptionCreated,
  mockHandleSubscriptionUpdated,
  mockHandleSubscriptionCanceled,
  mockHandleTransactionCompleted,
  mockUpdateSubscriptionStatus,
  mockResolveUserId,
} = vi.hoisted(() => ({
  mockUnmarshal: vi.fn(),
  mockHandleSubscriptionCreated: vi.fn(),
  mockHandleSubscriptionUpdated: vi.fn(),
  mockHandleSubscriptionCanceled: vi.fn(),
  mockHandleTransactionCompleted: vi.fn(),
  mockUpdateSubscriptionStatus: vi.fn(),
  mockResolveUserId: vi.fn(),
}))

vi.mock("@/billing/paddle-client.js", () => ({
  paddle: {
    webhooks: {
      unmarshal: mockUnmarshal,
    },
  },
}))

vi.mock("@/billing/provision-credits.js", () => ({
  handleSubscriptionCreated: mockHandleSubscriptionCreated,
  handleSubscriptionUpdated: mockHandleSubscriptionUpdated,
  handleSubscriptionCanceled: mockHandleSubscriptionCanceled,
  handleTransactionCompleted: mockHandleTransactionCompleted,
  updateSubscriptionStatus: mockUpdateSubscriptionStatus,
  resolveUserId: mockResolveUserId,
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    PADDLE_WEBHOOK_SECRET: "whsec_test_secret",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: null,
      }),
    },
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { paddleWebhookRoutes } from "../paddle-webhook.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePaddleEvent(
  eventType: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  return {
    eventId: "evt_test_123",
    eventType,
    data,
  }
}

function makeSubscriptionData(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "sub_abc123",
    status: "active",
    customerId: "ctm_paddle_123",
    currentBillingPeriod: {
      startsAt: "2026-01-01T00:00:00Z",
      endsAt: "2026-02-01T00:00:00Z",
    },
    items: [{ price: { id: "pri_standard_annual" } }],
    customData: { userId: "user-456" },
    ...overrides,
  }
}

function makeTransactionData(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "txn_abc123",
    customerId: "ctm_paddle_123",
    subscriptionId: "sub_abc123",
    items: [{ price: { id: "pri_standard_annual" } }],
    details: { totals: { total: "4900" } },
    customData: null,
    ...overrides,
  }
}

/**
 * Inject a webhook request with a JSON body and optional Paddle-Signature header.
 */
async function injectWebhook(
  app: FastifyInstance,
  body: Record<string, unknown>,
  signature?: string
): Promise<ReturnType<FastifyInstance["inject"]>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (signature !== undefined) {
    headers["paddle-signature"] = signature
  }

  return app.inject({
    method: "POST",
    url: "/v1/billing/paddle-webhook",
    headers,
    payload: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Test app setup — no auth hook needed (webhook is public)
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  app = Fastify({ logger: false })

  await app.register(async (instance) => {
    await paddleWebhookRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/billing/paddle-webhook", () => {
  it("returns 400 when Paddle-Signature header is missing", async () => {
    const res = await injectWebhook(app, { eventType: "test" })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: "Missing signature" })
  })

  it("returns 401 when signature verification fails", async () => {
    mockUnmarshal.mockRejectedValueOnce(new Error("Invalid signature"))

    const res = await injectWebhook(
      app,
      { eventType: "test" },
      "ts=123;h1=invalid"
    )

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: "Invalid signature" })
  })

  it("subscription.created event calls handleSubscriptionCreated", async () => {
    const subData = makeSubscriptionData()
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.created", subData)
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(mockHandleSubscriptionCreated).toHaveBeenCalledOnce()
  })

  it("subscription.updated event calls handleSubscriptionUpdated", async () => {
    const subData = makeSubscriptionData()
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.updated", subData)
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(mockHandleSubscriptionUpdated).toHaveBeenCalledOnce()
  })

  it("subscription.canceled event calls handleSubscriptionCanceled", async () => {
    const subData = makeSubscriptionData()
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.canceled", subData)
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(mockHandleSubscriptionCanceled).toHaveBeenCalledOnce()
  })

  it("subscription.past_due event calls updateSubscriptionStatus", async () => {
    const subData = makeSubscriptionData()
    mockResolveUserId.mockResolvedValueOnce("user-456")
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.past_due", subData)
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
      "sub_abc123",
      "past_due"
    )
  })

  it("subscription.paused event calls updateSubscriptionStatus", async () => {
    const subData = makeSubscriptionData()
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.paused", subData)
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
      "sub_abc123",
      "paused"
    )
  })

  it("subscription.resumed event calls updateSubscriptionStatus", async () => {
    const subData = makeSubscriptionData()
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.resumed", subData)
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
      "sub_abc123",
      "active"
    )
  })

  it("transaction.completed event calls handleTransactionCompleted", async () => {
    const txData = makeTransactionData()
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("transaction.completed", txData)
    )

    const res = await injectWebhook(app, txData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(mockHandleTransactionCompleted).toHaveBeenCalledOnce()
  })

  it("transaction.payment_failed is logged without calling a handler", async () => {
    const txData = makeTransactionData()
    mockResolveUserId.mockResolvedValueOnce("user-456")
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("transaction.payment_failed", txData)
    )

    const res = await injectWebhook(app, txData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled()
    expect(mockHandleSubscriptionUpdated).not.toHaveBeenCalled()
    expect(mockHandleSubscriptionCanceled).not.toHaveBeenCalled()
    expect(mockHandleTransactionCompleted).not.toHaveBeenCalled()
    expect(mockUpdateSubscriptionStatus).not.toHaveBeenCalled()
  })

  it("unknown event type is logged and returns { received: true }", async () => {
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("some.unknown.event", { id: "unknown-1" })
    )

    const res = await injectWebhook(
      app,
      { id: "unknown-1" },
      "ts=123;h1=valid"
    )

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    expect(mockHandleSubscriptionCreated).not.toHaveBeenCalled()
    expect(mockHandleTransactionCompleted).not.toHaveBeenCalled()
  })

  it("handler error is caught and still returns { received: true }", async () => {
    const subData = makeSubscriptionData()
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.created", subData)
    )
    mockHandleSubscriptionCreated.mockRejectedValueOnce(
      new Error("DB write failed")
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })

  it("returns { received: true } on success", async () => {
    const subData = makeSubscriptionData()
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.created", subData)
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
  })

  it("passes correct data to handleSubscriptionCreated", async () => {
    const subData = makeSubscriptionData({
      id: "sub_detailed",
      status: "active",
      customerId: "ctm_detail_123",
      currentBillingPeriod: {
        startsAt: "2026-03-01T00:00:00Z",
        endsAt: "2026-04-01T00:00:00Z",
      },
      items: [{ price: { id: "pri_pro_annual" } }],
      customData: { userId: "user-789", referral: "campaign_1" },
    })
    mockUnmarshal.mockResolvedValueOnce(
      makePaddleEvent("subscription.created", subData)
    )

    const res = await injectWebhook(app, subData, "ts=123;h1=valid")

    expect(res.statusCode).toBe(200)
    expect(mockHandleSubscriptionCreated).toHaveBeenCalledWith({
      subscriptionId: "sub_detailed",
      paddleCustomerId: "ctm_detail_123",
      priceId: "pri_pro_annual",
      status: "active",
      currentPeriodStart: "2026-03-01T00:00:00Z",
      currentPeriodEnd: "2026-04-01T00:00:00Z",
      customData: { userId: "user-789", referral: "campaign_1" },
    })
  })
})
