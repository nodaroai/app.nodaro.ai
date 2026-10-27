import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError, UnauthorizedError, ForbiddenError } from "../../index.js"
import type {
  Auth,
  BillingPlansResult,
  BillingSubscriptionResult,
  BillingSurface,
  BillingAccountSummary,
  BillingDocument,
  BillingPaymentMethod,
  BillingAutoRecharge,
} from "../../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

const PLANS: BillingPlansResult = {
  data: [
    {
      id: "free",
      name: "Free",
      prices: null,
      signupCredits: 100,
      parallelism: 2,
      storageBytes: 1024,
    },
    {
      id: "basic",
      name: "Basic",
      prices: {
        monthly: { priceId: "price_basic_m", amount: 12, currency: "USD", credits: { amount: 400, per: "month" } },
        yearly: { priceId: "price_basic_y", amount: 120, currency: "USD", perMonth: 10, credits: { amount: 400, per: "month" } },
      },
      signupCredits: null,
      parallelism: 4,
      storageBytes: 2048,
    },
  ],
  topUps: [
    { id: "topup-10", credits: 300, price: { amount: 10, currency: "USD" }, priceId: "price_pack_10" },
    { id: "topup-25", credits: 800, price: null, priceId: null },
  ],
  topUpRange: { min: 5, max: 1000, currency: "USD" },
}

/** An Auth with no credential at all — a signed-out pricing page. */
const NO_TOKEN: Auth = { getToken: async () => null }

function client(fetchMock: ReturnType<typeof vi.fn>, auth: Auth = new StaticTokenAuth("t")) {
  return createClient({ baseUrl: "https://api.example.com", auth, fetch: fetchMock })
}

describe("billing.plans()", () => {
  it("GETs /v1/billing/plans and returns the whole answer — plans, packs and the custom range", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(PLANS))
    const result = await client(fetchMock).billing.plans()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/billing/plans")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(result).toEqual(PLANS)
  })

  it("works signed out: no Authorization header is sent", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(PLANS))
    await client(fetchMock, NO_TOKEN).billing.plans()

    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers
    expect(headers.Authorization).toBeUndefined()
  })

  it("surfaces a 404 as NotFoundError — the route exists only on Nodaro Cloud", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(404, { error: { code: "not_found", message: "Not found" } }))
    await expect(client(fetchMock).billing.plans()).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("billing.subscription()", () => {
  it("GETs /v1/billing/subscription and keeps effectiveTier beside the record", async () => {
    const body: BillingSubscriptionResult = {
      data: {
        id: "sub-row",
        stripe_subscription_id: "sub_1",
        tier: "pro",
        status: "active",
        stripe_price_id: "price_1",
        current_period_start: "2026-10-01T00:00:00.000Z",
        current_period_end: "2026-11-01T00:00:00.000Z",
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: null,
      },
      effectiveTier: "pro",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(body))
    const result = await client(fetchMock).billing.subscription()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/billing/subscription")
    expect(result).toEqual(body)
  })

  it("an account that never subscribed reads data: null with its tier", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: null, effectiveTier: "payg" }))
    expect(await client(fetchMock).billing.subscription()).toEqual({ data: null, effectiveTier: "payg" })
  })

  it("throws UnauthorizedError when signed out", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(401, { error: "Authentication required" }))
    await expect(client(fetchMock, NO_TOKEN).billing.subscription()).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe("billing.surface() and billing.account()", () => {
  it("surface() GETs /v1/billing/surface and unwraps data", async () => {
    const surface: BillingSurface = {
      contract: 2,
      providerId: "none",
      displayUnit: "usd",
      canReport: false,
      canQuote: false,
      canAccount: false,
      mountCostTab: false,
      deploymentPayer: false,
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: surface }))
    expect(await client(fetchMock, NO_TOKEN).billing.surface()).toEqual(surface)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/billing/surface")
  })

  it("account() GETs /v1/billing/account and unwraps data", async () => {
    const account: BillingAccountSummary = { plan: "pro", balance: 120, dailyAllowance: null, unit: "credits" }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: account }))
    expect(await client(fetchMock).billing.account()).toEqual(account)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/billing/account")
  })

  it("account() keeps a null answer null — the authority could not say, never a zero balance", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: null }))
    expect(await client(fetchMock).billing.account()).toBeNull()
  })
})

describe("the signed-in-session methods", () => {
  const call = (fetchMock: ReturnType<typeof vi.fn>) => ({
    url: fetchMock.mock.calls[0][0] as string,
    method: (fetchMock.mock.calls[0][1] as { method: string }).method,
    body: JSON.parse(((fetchMock.mock.calls[0][1] as { body?: string }).body ?? "null") as string) as unknown,
  })

  it("purchases() GETs /v1/billing/transactions and unwraps data", async () => {
    const rows = [{ id: "t1", stripe_transaction_id: "pi_1", type: "topup", amount_usd: 35, credits_granted: 3000, tier: null, created_at: "2026-10-25T22:02:00.000Z", receipt_url: "https://pay.stripe.com/r/1" }]
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: rows }))
    expect(await client(fetchMock).billing.purchases()).toEqual(rows)
    expect(call(fetchMock)).toMatchObject({ url: "https://api.example.com/v1/billing/transactions", method: "GET" })
  })

  it("invoices() GETs /v1/billing/invoices and unwraps data", async () => {
    const docs: BillingDocument[] = [{ id: "in_1", kind: "invoice", number: "A-0001", at: "2026-10-01T00:00:00.000Z", amount: { amount: 12, currency: "USD" }, credits: null, status: "paid", description: "Pro", pdfUrl: "https://x/pdf", url: "https://x/i" }]
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: docs }))
    expect(await client(fetchMock).billing.invoices()).toEqual(docs)
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/billing/invoices")
  })

  it("paymentMethod() GETs /v1/billing/payment-method and keeps both nulls for an account that never bought", async () => {
    const none: BillingPaymentMethod = { card: null, billingDetails: null }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: none }))
    expect(await client(fetchMock).billing.paymentMethod()).toEqual(none)
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/billing/payment-method")
  })

  it("autoRecharge() GETs and setAutoRecharge() PUTs /v1/billing/auto-recharge", async () => {
    const setting: BillingAutoRecharge = { enabled: true, thresholdCredits: 500, amountUsd: 20, failureCount: 0, lastAttemptAt: null, hasSavedCard: true }
    const get = vi.fn().mockReturnValueOnce(mockOk({ data: setting }))
    expect(await client(get).billing.autoRecharge()).toEqual(setting)
    expect(call(get)).toMatchObject({ url: "https://api.example.com/v1/billing/auto-recharge", method: "GET" })

    const put = vi.fn().mockReturnValueOnce(mockOk({ data: { enabled: false, thresholdCredits: null, amountUsd: null } }))
    expect(await client(put).billing.setAutoRecharge({ enabled: false })).toEqual({ enabled: false, thresholdCredits: null, amountUsd: null })
    expect(call(put)).toEqual({ url: "https://api.example.com/v1/billing/auto-recharge", method: "PUT", body: { enabled: false } })
  })

  it("checkout(), loadCredits() and portal() POST their inputs, returnPath included, and unwrap the Stripe page", async () => {
    const checkout = vi.fn().mockReturnValueOnce(mockOk({ data: { url: "https://checkout.stripe.com/c/1" } }))
    expect(await client(checkout).billing.checkout({ priceId: "price_1", returnPath: "/billing" })).toEqual({ url: "https://checkout.stripe.com/c/1" })
    expect(call(checkout)).toEqual({ url: "https://api.example.com/v1/billing/create-checkout-session", method: "POST", body: { priceId: "price_1", returnPath: "/billing" } })

    const load = vi.fn().mockReturnValueOnce(mockOk({ data: { url: "https://checkout.stripe.com/c/2", credits: 2940 } }))
    expect(await client(load).billing.loadCredits({ amountUsd: 20 })).toEqual({ url: "https://checkout.stripe.com/c/2", credits: 2940 })
    expect(call(load)).toEqual({ url: "https://api.example.com/v1/billing/create-load-session", method: "POST", body: { amountUsd: 20 } })

    const portal = vi.fn().mockReturnValueOnce(mockOk({ data: { url: "https://billing.stripe.com/p/1" } }))
    expect(await client(portal).billing.portal()).toEqual({ url: "https://billing.stripe.com/p/1" })
    expect(call(portal)).toEqual({ url: "https://api.example.com/v1/billing/manage-subscription", method: "POST", body: {} })
  })

  it("changePlan() POSTs the new price and unwraps the tier now in force", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { subscriptionId: "sub_1", tier: "pro" } }))
    expect(await client(fetchMock).billing.changePlan({ newPriceId: "price_pro" })).toEqual({ subscriptionId: "sub_1", tier: "pro" })
    expect(call(fetchMock)).toEqual({ url: "https://api.example.com/v1/billing/change-plan", method: "POST", body: { newPriceId: "price_pro" } })
  })

  it("surfaces the route's refusal of an API key as ForbiddenError", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockErr(403, { error: { code: "forbidden", message: "Billing management is only available from a logged-in session." } }))
    await expect(client(fetchMock).billing.invoices()).rejects.toBeInstanceOf(ForbiddenError)
  })
})
