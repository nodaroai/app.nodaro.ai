import { describe, expect, it } from "vitest"
import { assertTrustedCheckoutUrl } from "../checkout"

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
