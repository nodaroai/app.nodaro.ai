import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError, UnauthorizedError } from "../../index.js"
import type { Auth, BillingPlansResult, BillingSubscriptionResult, BillingSurface, BillingAccountSummary } from "../../index.js"

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
        monthly: { amount: 12, currency: "USD", credits: { amount: 400, per: "month" } },
        yearly: { amount: 120, currency: "USD", perMonth: 10, credits: { amount: 400, per: "month" } },
      },
      signupCredits: null,
      parallelism: 4,
      storageBytes: 2048,
    },
  ],
  topUps: [
    { id: "topup-10", credits: 300, price: { amount: 10, currency: "USD" } },
    { id: "topup-25", credits: 800, price: null },
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
