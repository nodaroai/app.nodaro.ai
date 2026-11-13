import { describe, it, expect, vi } from "vitest"
import type Stripe from "stripe"
import {
  claimOrProceed,
  majorUnits,
  measurementConfig,
  purchasePayload,
  reportStripePurchase,
  reportStripePurchaseNow,
  type ReportDeps,
} from "../report-purchase.js"
import type { PurchaseFacts } from "../purchase-event.js"

const USER = "8a1f3c2e-0b4d-4e6f-9a7b-1c2d3e4f5a6b"
const CFG = { measurementId: "G-TEST1234", apiSecret: "secret-value" }

function facts(overrides: Partial<PurchaseFacts> = {}): PurchaseFacts {
  return {
    transactionId: "pi_1",
    amountMinor: 2500,
    currency: "USD",
    item: { id: "price_pack", name: "Credit pack", category: "credit_pack" },
    userId: USER,
    gaClientId: "1234567890.1700000000",
    gaSessionId: "1700000500",
    ...overrides,
  }
}

function packEvent(): Stripe.Event {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    livemode: true,
    data: {
      object: {
        id: "cs_1",
        mode: "payment",
        payment_status: "paid",
        payment_intent: "pi_1",
        amount_total: 2500,
        currency: "usd",
        metadata: { userId: USER, topupPriceId: "price_pack", ga_client_id: "1234567890.1700000000" },
      },
    },
  } as unknown as Stripe.Event
}

function deps(overrides: Partial<ReportDeps> = {}): ReportDeps {
  return {
    config: () => CFG,
    claimOnce: vi.fn(async () => true),
    send: vi.fn(async () => true),
    ...overrides,
  }
}

describe("measurementConfig", () => {
  it("needs a well-formed measurement id and a secret", () => {
    expect(measurementConfig({ measurementId: " G-TEST1234 ", apiSecret: " s " })).toEqual({ measurementId: "G-TEST1234", apiSecret: "s" })
    expect(measurementConfig({ measurementId: "G-TEST1234", apiSecret: "" })).toBeNull()
    expect(measurementConfig({ measurementId: "", apiSecret: "s" })).toBeNull()
    expect(measurementConfig({ measurementId: "UA-1234-1", apiSecret: "s" })).toBeNull()
    expect(measurementConfig({})).toBeNull()
  })
})

describe("majorUnits", () => {
  it("follows the currency's own decimals", () => {
    expect(majorUnits(2500, "USD")).toBe(25)
    expect(majorUnits(1999, "EUR")).toBeCloseTo(19.99)
    expect(majorUnits(500, "JPY")).toBe(500)
    expect(majorUnits(12345, "KWD")).toBeCloseTo(12.345)
  })
})

describe("purchasePayload", () => {
  it("is GA4's purchase for the visit that started the checkout", () => {
    expect(purchasePayload(facts())).toEqual({
      client_id: "1234567890.1700000000",
      user_id: USER,
      events: [{
        name: "purchase",
        params: {
          transaction_id: "pi_1",
          value: 25,
          currency: "USD",
          items: [{ item_id: "price_pack", item_name: "Credit pack", item_category: "credit_pack", price: 25, quantity: 1 }],
          session_id: "1700000500",
          engagement_time_msec: 1,
        },
      }],
    })
  })

  it("with no visit, stands in a client id derived from the account — the same one every time", () => {
    const a = purchasePayload(facts({ gaClientId: null, gaSessionId: null }))
    const b = purchasePayload(facts({ gaClientId: null, gaSessionId: null, transactionId: "pi_2" }))
    expect(a?.client_id).toMatch(/^\d{1,10}\.\d{1,10}$/)
    expect(a?.client_id).toBe(b?.client_id)
    expect(a?.client_id).not.toContain(USER)
    expect(a?.events[0]?.params).not.toHaveProperty("session_id")
  })

  it("carries a subscription's billing reason as the item variant", () => {
    const payload = purchasePayload(facts({ item: { id: "subscription", name: "Subscription", category: "subscription", variant: "subscription_cycle" } }))
    expect((payload?.events[0]?.params.items as Array<Record<string, unknown>>)[0]).toMatchObject({ item_variant: "subscription_cycle" })
  })

  it("is nothing when neither a visit nor an account is known", () => {
    expect(purchasePayload(facts({ gaClientId: null, userId: null }))).toBeNull()
  })
})

describe("reportStripePurchaseNow", () => {
  it("sends a settled payment once, claiming its transaction first", async () => {
    const d = deps()
    expect(await reportStripePurchaseNow(packEvent(), undefined, d)).toBe("sent")
    expect(d.claimOnce).toHaveBeenCalledWith("pi_1")
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ client_id: "1234567890.1700000000", user_id: USER }), CFG)
  })

  it("a transaction already reported is not sent again", async () => {
    const d = deps({ claimOnce: vi.fn(async () => false) })
    expect(await reportStripePurchaseNow(packEvent(), undefined, d)).toBe("duplicate")
    expect(d.send).not.toHaveBeenCalled()
  })

  it("is inert without its settings: nothing is claimed or sent", async () => {
    const d = deps({ config: () => null })
    expect(await reportStripePurchaseNow(packEvent(), undefined, d)).toBe("skipped")
    expect(d.claimOnce).not.toHaveBeenCalled()
    expect(d.send).not.toHaveBeenCalled()
  })

  it("an event that is no purchase claims nothing", async () => {
    const d = deps()
    const other = { id: "evt_2", type: "customer.subscription.created", livemode: true, data: { object: { id: "sub_1" } } } as unknown as Stripe.Event
    expect(await reportStripePurchaseNow(other, undefined, d)).toBe("skipped")
    expect(d.claimOnce).not.toHaveBeenCalled()
  })

  it("a refused or failed send is logged without the secret, and never thrown", async () => {
    const warn = vi.fn()
    const log = { warn } as never
    expect(await reportStripePurchaseNow(packEvent(), log, deps({ send: vi.fn(async () => false) }))).toBe("failed")
    expect(await reportStripePurchaseNow(packEvent(), log, deps({ send: vi.fn(async () => { throw new Error("socket hang up") }) }))).toBe("failed")
    expect(warn).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(CFG.apiSecret)
  })
})

describe("claimOrProceed", () => {
  it("answers with the claim when it comes in time", async () => {
    expect(await claimOrProceed(Promise.resolve(true))).toBe(true)
    expect(await claimOrProceed(Promise.resolve(false))).toBe(false)
  })

  it("goes ahead when the claim fails, or never answers (Redis away: its connection holds commands)", async () => {
    expect(await claimOrProceed(Promise.reject(new Error("redis down")))).toBe(true)
    vi.useFakeTimers()
    try {
      const pending = claimOrProceed(new Promise<boolean>(() => {}), 2_000)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(await pending).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("reportStripePurchase", () => {
  it("returns at once and swallows every failure, a throwing dependency included", async () => {
    const send = vi.fn(async () => true)
    const throwing = deps({ claimOnce: vi.fn(async () => { throw new Error("redis down") }), send })
    expect(() => reportStripePurchase(packEvent(), undefined, throwing)).not.toThrow()
    expect(() => reportStripePurchase(packEvent(), undefined, deps({ config: () => { throw new Error("bad config") } }))).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(send).not.toHaveBeenCalled()
  })
})
