import { afterEach, describe, expect, it, vi } from "vitest"

const embed = vi.hoisted(() => ({ embedded: false }))
vi.mock("@/hooks/use-embed-session-handoff", () => ({ isEmbedded: () => embed.embedded }))
vi.mock("@/lib/api", () => ({ createCheckoutSession: vi.fn(), createLoadSession: vi.fn() }))

import { assertTrustedCheckoutUrl, openStripePage } from "../checkout"

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
