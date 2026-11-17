import { describe, it, expect, expectTypeOf, vi, type Mock } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError, UnauthorizedError, ForbiddenError, NodaroError, InsufficientCreditsError, RateLimitedError } from "../../index.js"
import type {
  Auth,
  BillingPlansResult,
  BillingSubscriptionResult,
  BillingSurface,
  BillingAccountSummary,
  BillingDocument,
  BillingPaymentMethod,
  BillingAutoRecharge,
  BillingCheckoutStatus,
  BillingCheckoutInput,
  BillingLoadInput,
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

function client(fetchMock: Mock<typeof fetch>, auth: Auth = new StaticTokenAuth("t")) {
  return createClient({ baseUrl: "https://api.example.com", auth, fetch: fetchMock })
}

describe("billing.plans()", () => {
  it("GETs /v1/billing/plans and returns the whole answer — plans, packs and the custom range", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk(PLANS))
    const result = await client(fetchMock).billing.plans()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/billing/plans")
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("GET")
    expect(result).toEqual(PLANS)
  })

  it("works signed out: no Authorization header is sent", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk(PLANS))
    await client(fetchMock, NO_TOKEN).billing.plans()

    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers
    expect(headers.Authorization).toBeUndefined()
  })

  it("keeps stripePublishableKey, null included", async () => {
    const withNull: BillingPlansResult = { ...PLANS, stripePublishableKey: null }
    const nullMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk(withNull))
    expect(await client(nullMock).billing.plans()).toEqual(withNull)

    const key = ["pk", "test", "0".repeat(12)].join("_")
    const withKey: BillingPlansResult = { ...PLANS, stripePublishableKey: key }
    const keyMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk(withKey))
    expect((await client(keyMock).billing.plans()).stripePublishableKey).toBe(key)
  })

  it("surfaces a 404 as NotFoundError — the route exists only on Nodaro Cloud", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(404, { error: { code: "not_found", message: "Not found" } }))
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
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk(body))
    const result = await client(fetchMock).billing.subscription()

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/billing/subscription")
    expect(result).toEqual(body)
  })

  it("an account that never subscribed reads data: null with its tier", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: null, effectiveTier: "payg" }))
    expect(await client(fetchMock).billing.subscription()).toEqual({ data: null, effectiveTier: "payg" })
  })

  it("throws UnauthorizedError when signed out", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(401, { error: "Authentication required" }))
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
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: surface }))
    expect(await client(fetchMock, NO_TOKEN).billing.surface()).toEqual(surface)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/billing/surface")
  })

  it("account() GETs /v1/billing/account and unwraps data", async () => {
    const account: BillingAccountSummary = { plan: "pro", balance: 120, dailyAllowance: null, unit: "credits" }
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: account }))
    expect(await client(fetchMock).billing.account()).toEqual(account)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/billing/account")
  })

  it("account() keeps a null answer null — the authority could not say, never a zero balance", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: null }))
    expect(await client(fetchMock).billing.account()).toBeNull()
  })
})

describe("the signed-in-session methods", () => {
  const call = (fetchMock: Mock<typeof fetch>) => ({
    url: fetchMock.mock.calls[0][0] as string,
    method: (fetchMock.mock.calls[0][1] as { method: string }).method,
    body: JSON.parse(((fetchMock.mock.calls[0][1] as { body?: string }).body ?? "null") as string) as unknown,
  })

  it("purchases() GETs /v1/billing/transactions and unwraps data", async () => {
    const rows = [{ id: "t1", stripe_transaction_id: "pi_1", type: "topup", amount_usd: 35, credits_granted: 3000, tier: null, created_at: "2026-10-25T22:02:00.000Z", receipt_url: "https://pay.stripe.com/r/1" }]
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: rows }))
    expect(await client(fetchMock).billing.purchases()).toEqual(rows)
    expect(call(fetchMock)).toMatchObject({ url: "https://api.example.com/v1/billing/transactions", method: "GET" })
  })

  it("invoices() GETs /v1/billing/invoices and unwraps data", async () => {
    const docs: BillingDocument[] = [{ id: "in_1", kind: "invoice", number: "A-0001", at: "2026-10-01T00:00:00.000Z", amount: { amount: 12, currency: "USD" }, credits: null, status: "paid", description: "Pro", pdfUrl: "https://x/pdf", url: "https://x/i" }]
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: docs }))
    expect(await client(fetchMock).billing.invoices()).toEqual(docs)
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/billing/invoices")
  })

  it("paymentMethod() GETs /v1/billing/payment-method and keeps both nulls for an account that never bought", async () => {
    const none: BillingPaymentMethod = { card: null, billingDetails: null }
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: none }))
    expect(await client(fetchMock).billing.paymentMethod()).toEqual(none)
    expect(call(fetchMock).url).toBe("https://api.example.com/v1/billing/payment-method")
  })

  it("autoRecharge() GETs and setAutoRecharge() PUTs /v1/billing/auto-recharge", async () => {
    const setting: BillingAutoRecharge = { enabled: true, thresholdCredits: 500, amountUsd: 20, failureCount: 0, lastAttemptAt: null, hasSavedCard: true }
    const get = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: setting }))
    expect(await client(get).billing.autoRecharge()).toEqual(setting)
    expect(call(get)).toMatchObject({ url: "https://api.example.com/v1/billing/auto-recharge", method: "GET" })

    const put = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { enabled: false, thresholdCredits: null, amountUsd: null } }))
    expect(await client(put).billing.setAutoRecharge({ enabled: false })).toEqual({ enabled: false, thresholdCredits: null, amountUsd: null })
    expect(call(put)).toEqual({ url: "https://api.example.com/v1/billing/auto-recharge", method: "PUT", body: { enabled: false } })
  })

  it("checkout(), loadCredits() and portal() POST their inputs, returnPath included, and unwrap the Stripe page", async () => {
    const checkout = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { url: "https://checkout.stripe.com/c/1" } }))
    expect(await client(checkout).billing.checkout({ priceId: "price_1", returnPath: "/billing" })).toEqual({ url: "https://checkout.stripe.com/c/1" })
    expect(call(checkout)).toEqual({ url: "https://api.example.com/v1/billing/create-checkout-session", method: "POST", body: { priceId: "price_1", returnPath: "/billing" } })

    const load = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { url: "https://checkout.stripe.com/c/2", credits: 2940 } }))
    expect(await client(load).billing.loadCredits({ amountUsd: 20 })).toEqual({ url: "https://checkout.stripe.com/c/2", credits: 2940 })
    expect(call(load)).toEqual({ url: "https://api.example.com/v1/billing/create-load-session", method: "POST", body: { amountUsd: 20 } })

    const portal = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { url: "https://billing.stripe.com/p/1" } }))
    expect(await client(portal).billing.portal()).toEqual({ url: "https://billing.stripe.com/p/1" })
    expect(call(portal)).toEqual({ url: "https://api.example.com/v1/billing/manage-subscription", method: "POST", body: {} })
  })

  it("checkout() and loadCredits() send uiMode and unwrap the embedded session", async () => {
    const c = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { url: null, clientSecret: "sec_1", sessionId: "cs_test_1" } }))
    expect(await client(c).billing.checkout({ priceId: "price_1", uiMode: "embedded" })).toEqual({ url: null, clientSecret: "sec_1", sessionId: "cs_test_1" })
    expect(call(c)).toEqual({ url: "https://api.example.com/v1/billing/create-checkout-session", method: "POST", body: { priceId: "price_1", uiMode: "embedded" } })

    const l = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { url: null, clientSecret: "sec_2", sessionId: "cs_test_2", credits: 2940 } }))
    expect(await client(l).billing.loadCredits({ amountUsd: 20, uiMode: "embedded" })).toEqual({ url: null, clientSecret: "sec_2", sessionId: "cs_test_2", credits: 2940 })
    expect(call(l).body).toEqual({ amountUsd: 20, uiMode: "embedded" })
  })

  it("checkout() without uiMode sends exactly the body it did before", async () => {
    const c = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { url: "https://checkout.stripe.com/c/1" } }))
    await client(c).billing.checkout({ priceId: "price_1" })
    expect(call(c).body).toEqual({ priceId: "price_1" })
    expect(Object.keys(call(c).body as object)).not.toContain("uiMode")
  })

  it("checkoutStatus() GETs the session, encodes the id, and unwraps data", async () => {
    const f = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { status: "complete", paymentStatus: "paid", mode: "payment", granted: false } }))
    expect(await client(f).billing.checkoutStatus("cs_test_1")).toEqual({ status: "complete", paymentStatus: "paid", mode: "payment", granted: false })
    expect(call(f)).toMatchObject({ url: "https://api.example.com/v1/billing/checkout-session/cs_test_1", method: "GET" })

    const g = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: {} }))
    await client(g).billing.checkoutStatus("cs/../x")
    expect(call(g).url).toBe("https://api.example.com/v1/billing/checkout-session/cs%2F..%2Fx")
  })

  it("checkoutStatus() passes paymentUnderWay through, and an older platform leaves it out", async () => {
    const f = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { status: "open", paymentStatus: "unpaid", mode: "payment", granted: false, paymentUnderWay: true } }))
    const now = await client(f).billing.checkoutStatus("cs_test_1")
    expect(now.paymentUnderWay).toBe(true)

    const g = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { status: "open", paymentStatus: "unpaid", mode: "payment", granted: false } }))
    const older = await client(g).billing.checkoutStatus("cs_test_1")
    expect(older.paymentUnderWay).toBeUndefined()
    expect("paymentUnderWay" in older).toBe(false)
  })

  it("checkoutStatus(): a session that is not the caller's is a NotFoundError", async () => {
    const f = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(404, { error: { code: "checkout_session_not_found", message: "Checkout session not found." } }))
    const err = await client(f).billing.checkoutStatus("cs_test_other").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err).toMatchObject({ status: 404, code: "checkout_session_not_found" })
  })

  it("embedded with no publishable key is a 503 NodaroError with its code", async () => {
    const f = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(503, { error: { code: "embedded_checkout_unavailable", message: "Embedded checkout is not available." } }))
    const err = await client(f).billing.checkout({ priceId: "price_1", uiMode: "embedded" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect(err).toMatchObject({ status: 503, code: "embedded_checkout_unavailable" })
  })

  // vitest does not typecheck: the `@ts-expect-error` lines below are held by
  // CI's "SDK type tests" step (`tsc -p packages/client/tsconfig.type-tests.json`).
  it("types uiMode, the session's status and the publishable key", () => {
    const billing = client(vi.fn<typeof fetch>()).billing
    // Never called: only their types are checked.
    const popupCheckout = () =>
      billing.checkout({
        priceId: "price_1",
        // @ts-expect-error — a uiMode is "hosted" or "embedded"
        uiMode: "popup",
      })
    const popupLoad = () =>
      billing.loadCredits({
        amountUsd: 20,
        // @ts-expect-error — a uiMode is "hosted" or "embedded"
        uiMode: "popup",
      })
    const pending: BillingCheckoutStatus = {
      // @ts-expect-error — a session is open, complete or expired
      status: "pending",
      paymentStatus: "unpaid",
      mode: "payment",
      granted: false,
    }
    expectTypeOf(billing.checkoutStatus).returns.toEqualTypeOf<Promise<BillingCheckoutStatus>>()
    expectTypeOf<BillingCheckoutStatus["paymentUnderWay"]>().toEqualTypeOf<boolean | undefined>()
    const underWay: BillingCheckoutStatus = {
      status: "open",
      paymentStatus: "unpaid",
      mode: "payment",
      granted: false,
      // @ts-expect-error — paymentUnderWay is a boolean
      paymentUnderWay: "yes",
    }
    expectTypeOf<BillingPlansResult["stripePublishableKey"]>().toEqualTypeOf<string | null | undefined>()
    expect([popupCheckout, popupLoad, pending, underWay]).toHaveLength(4)
  })

  describe("replacesSessionId", () => {
    it("checkout() and loadCredits() send it as given", async () => {
      const c = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { url: "https://checkout.stripe.test/x" } }))
      await client(c).billing.checkout({ priceId: "price_1", replacesSessionId: "cs_test_1" })
      expect(call(c)).toEqual({ url: "https://api.example.com/v1/billing/create-checkout-session", method: "POST", body: { priceId: "price_1", replacesSessionId: "cs_test_1" } })

      const l = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { url: "https://checkout.stripe.test/y", credits: 2940 } }))
      await client(l).billing.loadCredits({ amountUsd: 20, replacesSessionId: "cs_test_2" })
      expect(call(l)).toEqual({ url: "https://api.example.com/v1/billing/create-load-session", method: "POST", body: { amountUsd: 20, replacesSessionId: "cs_test_2" } })
    })

    it("the two refusals are 409 NodaroErrors a caller tells apart by code", async () => {
      const codes = ["checkout_already_complete", "checkout_in_progress"] as const
      const seen: string[] = []
      for (const code of codes) {
        const c = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(409, { error: { code, message: "m" } }))
        const err = await client(c).billing.checkout({ priceId: "price_1", replacesSessionId: "cs_test_1" }).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(NodaroError)
        expect(err).not.toBeInstanceOf(InsufficientCreditsError)
        expect(err).toMatchObject({ status: 409, code })
        seen.push((err as NodaroError).code ?? "")

        const l = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(409, { error: { code, message: "m" } }))
        await expect(client(l).billing.loadCredits({ amountUsd: 20, replacesSessionId: "cs_test_2" })).rejects.toMatchObject({ status: 409, code })
      }
      expect(seen).toEqual([...codes])
    })

    it("a session that is not the caller's is a NotFoundError", async () => {
      const body = { error: { code: "checkout_session_not_found", message: "No checkout session with this id on your account." } }
      const c = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(404, body))
      const err = await client(c).billing.checkout({ priceId: "price_1", replacesSessionId: "cs_test_other" }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NotFoundError)
      expect(err).toMatchObject({ status: 404, code: "checkout_session_not_found" })

      const l = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(404, body))
      const lerr = await client(l).billing.loadCredits({ amountUsd: 20, replacesSessionId: "cs_test_other" }).catch((e: unknown) => e)
      expect(lerr).toBeInstanceOf(NotFoundError)
      expect(lerr).toMatchObject({ status: 404, code: "checkout_session_not_found" })
    })

    // Held by CI's "SDK type tests" step, as the uiMode types above.
    it("types replacesSessionId as an optional string", () => {
      const billing = client(vi.fn<typeof fetch>()).billing
      // Never called: only their types are checked.
      const numericCheckout = () =>
        billing.checkout({
          priceId: "price_1",
          // @ts-expect-error — a session id is a string
          replacesSessionId: 42,
        })
      const numericLoad = () =>
        billing.loadCredits({
          amountUsd: 20,
          // @ts-expect-error — a session id is a string
          replacesSessionId: 42,
        })
      expectTypeOf<BillingCheckoutInput["replacesSessionId"]>().toEqualTypeOf<string | undefined>()
      expectTypeOf<BillingLoadInput["replacesSessionId"]>().toEqualTypeOf<string | undefined>()
      expect([numericCheckout, numericLoad]).toHaveLength(2)
    })
  })

  it("changePlan() POSTs the new price and unwraps the tier now in force", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockOk({ data: { subscriptionId: "sub_1", tier: "pro" } }))
    expect(await client(fetchMock).billing.changePlan({ newPriceId: "price_pro" })).toEqual({ subscriptionId: "sub_1", tier: "pro" })
    expect(call(fetchMock)).toEqual({ url: "https://api.example.com/v1/billing/change-plan", method: "POST", body: { newPriceId: "price_pro" } })
  })

  it("changePlan(): an upgrade waiting on its payment is a 409 NodaroError carrying the invoice to pay, never a credits error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(
      mockErr(409, {
        error: {
          code: "plan_change_payment_required",
          message: "The payment for the new plan has not gone through, so your plan has not changed yet.",
          invoiceUrl: "https://invoice.stripe.com/i/abc",
        },
      }),
    )
    const err = await client(fetchMock).billing.changePlan({ newPriceId: "price_pro" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect(err).not.toBeInstanceOf(InsufficientCreditsError)
    expect(err).toMatchObject({ status: 409, code: "plan_change_payment_required", details: { invoiceUrl: "https://invoice.stripe.com/i/abc" } })
  })

  it("changePlan(): the daily limit is a RateLimitedError", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(429, { error: { code: "rate_limit_exceeded", message: "Too many requests. Retry in 3600s." } }))
    await expect(client(fetchMock).billing.changePlan({ newPriceId: "price_pro" })).rejects.toBeInstanceOf(RateLimitedError)
  })

  it("surfaces the route's refusal of an API key as ForbiddenError", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(mockErr(403, { error: { code: "forbidden", message: "Billing management is only available from a logged-in session." } }))
    await expect(client(fetchMock).billing.invoices()).rejects.toBeInstanceOf(ForbiddenError)
  })
})
