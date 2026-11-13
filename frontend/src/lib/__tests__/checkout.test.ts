import { afterEach, describe, expect, it, vi } from "vitest"

const embed = vi.hoisted(() => ({ embedded: false }))
vi.mock("@/hooks/use-embed-session-handoff", () => ({ isEmbedded: () => embed.embedded }))
vi.mock("@/lib/api", () => ({ createCheckoutSession: vi.fn(), createLoadSession: vi.fn() }))

import { createCheckoutSession, createLoadSession } from "@/lib/api"
import { assertTrustedCheckoutUrl, openStripePage, startCheckout, startLoadCheckout } from "../checkout"

describe("assertTrustedCheckoutUrl (redirect sink guard)", () => {
  it("passes real Stripe HTTPS checkout URLs through unchanged", () => {
    const url = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3"
    expect(assertTrustedCheckoutUrl(url)).toBe(url)
    // Custom Stripe checkout domains are also HTTPS and must keep working.
    const custom = "https://billing.nodaro.ai/c/pay/cs_live_xyz"
    expect(assertTrustedCheckoutUrl(custom)).toBe(custom)
  })

  it("throws on script-executing / non-HTTPS schemes (XSS + open-redirect vectors)", () => {
    for (const bad of [
      "javascript:alert(document.cookie)",
      "javascript:void(fetch('//evil'))",
      "data:text/html,<script>alert(1)</script>",
      "http://checkout.stripe.com/insecure",
      "vbscript:msgbox(1)",
      "not-a-url",
      "",
    ]) {
      expect(() => assertTrustedCheckoutUrl(bad)).toThrow()
    }
  })
})

describe("openStripePage (an invoice to pay before a plan change applies)", () => {
  afterEach(() => {
    embed.embedded = false
    vi.unstubAllGlobals()
  })

  it("opens a new tab when embedded in another app's iframe", () => {
    const open = vi.fn()
    vi.stubGlobal("open", open)
    embed.embedded = true
    openStripePage("https://invoice.stripe.com/i/abc")
    expect(open).toHaveBeenCalledWith("https://invoice.stripe.com/i/abc", "_blank", "noopener,noreferrer")
  })

  it("refuses a non-HTTPS target before navigating", () => {
    const open = vi.fn()
    vi.stubGlobal("open", open)
    embed.embedded = true
    expect(() => openStripePage("javascript:alert(1)")).toThrow()
    expect(open).not.toHaveBeenCalled()
  })
})

// The site analytics (lib/analytics): a checkout carries the visit's GA ids to
// the server, which keeps them on the payment, and is reported as
// begin_checkout. Nothing of it happens unless the analytics loader ran.
describe("checkout and the site analytics", () => {
  type AnalyticsGlobals = { dataLayer?: unknown[]; __NODARO_GA__?: unknown }
  const globals = window as unknown as AnalyticsGlobals
  const sentEvents = () =>
    (globals.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>)).filter((c) => c[0] === "event").map((c) => [c[1], c[2]])

  afterEach(() => {
    embed.embedded = false
    vi.unstubAllGlobals()
    delete globals.dataLayer
    delete globals.__NODARO_GA__
    document.cookie = "_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT"
  })

  it("sends the visit's ids with the checkout and reports begin_checkout", async () => {
    vi.stubGlobal("open", vi.fn())
    embed.embedded = true
    globals.dataLayer = []
    globals.__NODARO_GA__ = { measurementId: "G-TEST1234" }
    document.cookie = "_ga=GA1.1.1234567890.1700000000"
    vi.mocked(createCheckoutSession).mockResolvedValue("https://checkout.stripe.com/c/pay/cs_1")

    await startCheckout({ priceId: "price_plan", mode: "subscription" })

    expect(createCheckoutSession).toHaveBeenLastCalledWith({ priceId: "price_plan", mode: "subscription", embedded: true, gaClientId: "1234567890.1700000000" })
    expect(sentEvents()).toEqual([["begin_checkout", { checkout_type: "plan", items: [{ item_id: "price_plan" }], send_to: "G-TEST1234" }]])
  })

  it("a credit load reports its amount", async () => {
    vi.stubGlobal("open", vi.fn())
    embed.embedded = true
    globals.dataLayer = []
    globals.__NODARO_GA__ = { measurementId: "G-TEST1234" }
    vi.mocked(createLoadSession).mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_2", credits: 6600 })

    await startLoadCheckout(20)

    expect(sentEvents()).toEqual([[
      "begin_checkout",
      { checkout_type: "credit_load", currency: "USD", value: 20, items: [{ item_id: "credit-load", price: 20, quantity: 1 }], send_to: "G-TEST1234" },
    ]])
  })

  it("adds nothing to the request when the analytics is not loaded", async () => {
    vi.stubGlobal("open", vi.fn())
    embed.embedded = true
    document.cookie = "_ga=GA1.1.1234567890.1700000000"
    vi.mocked(createCheckoutSession).mockResolvedValue("https://checkout.stripe.com/c/pay/cs_3")

    await startCheckout({ priceId: "price_pack", mode: "payment" })

    expect(createCheckoutSession).toHaveBeenLastCalledWith({ priceId: "price_pack", mode: "payment", embedded: true })
  })
})
