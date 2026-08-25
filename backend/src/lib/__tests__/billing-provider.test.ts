import { describe, it, expect, afterEach } from "vitest"
import {
  BILLING_CONTRACT_VERSION, noneBillingProvider, getBillingProvider,
  setBillingProvider, clearBillingProvider, billingSurface, type BillingProvider,
} from "../billing-provider.js"

afterEach(() => clearBillingProvider())

describe("billing-provider core seam", () => {
  it("defaults to the inert none provider", () => {
    expect(getBillingProvider().id).toBe("none")
  })
  it("none returns null from report and account — never 0", async () => {
    expect(await noneBillingProvider.report(["a"])).toBeNull()
    expect(await noneBillingProvider.account("u")).toBeNull()
  })
  it("billingSurface projects the none default: no tab, versioned", () => {
    const s = billingSurface()
    expect(s).toEqual({
      contract: BILLING_CONTRACT_VERSION, providerId: "none", displayUnit: "usd",
      canReport: false, canQuote: false, canAccount: false, mountCostTab: false,
    })
  })
  it("registering a provider flips the surface to mount + its unit + capabilities", () => {
    const p: BillingProvider = {
      id: "test-cloud", displayUnit: "credits",
      async report() { return new Map() }, async account() { return null },
      quote: async () => null,
    }
    setBillingProvider(p)
    const s = billingSurface()
    expect(s.providerId).toBe("test-cloud")
    expect(s.displayUnit).toBe("credits")
    expect(s.mountCostTab).toBe(true)
    expect(s.canReport).toBe(true)
    expect(s.canAccount).toBe(true)
    expect(s.canQuote).toBe(true)
  })
})
