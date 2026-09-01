import { describe, it, expect, afterEach } from "vitest"
import {
  BILLING_CONTRACT_VERSION, noneBillingProvider, getBillingProvider,
  setBillingProvider, clearBillingProvider, billingSurface,
  type BillingProvider, type AccountSummary,
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
      deploymentPayer: false,
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

  it("advertises contract version 2", () => {
    expect(BILLING_CONTRACT_VERSION).toBe(2)
    expect(billingSurface().contract).toBe(2)
  })

  it("accepts a provider returning the rich v2 account shape", async () => {
    const richAccount: AccountSummary = {
      plan: "payg",
      balance: 1200,
      dailyAllowance: null,
      unit: "credits",
      periodStart: "2026-08-01T00:00:00.000Z",
      generations: 42,
      spent: { amount: 12.5, currency: "ILS" },
      payg: {
        enabled: true,
        reserve: 300,
        rate: { creditsPerUnit: 100, currency: "ILS" },
        monthlyCap: { amount: 200, currency: "ILS" },
      },
      daily: { limit: 500, used: 120, remaining: 380, resetsAt: "2026-08-26T21:00:00.000Z" },
      reserveValue: { amount: 3, currency: "ILS" },
      byCategory: [
        { category: "image", count: 30, amount: 300, spent: { amount: 3, currency: "ILS" } },
        { category: "video", count: 12, amount: 900, spent: null },
      ],
    }
    const rich: BillingProvider = {
      id: "rich-test",
      displayUnit: "credits",
      async report() { return new Map() },
      async account() { return richAccount },
    }
    setBillingProvider(rich)
    const a = await getBillingProvider().account("u")
    expect(a?.payg?.enabled).toBe(true)
    expect(a?.daily?.limit).toBe(500)
    expect(a?.byCategory?.[1].spent).toBeNull()
  })

  it("still accepts a subset-only account (nodaro-cloud shape stays valid)", async () => {
    const subset: BillingProvider = {
      id: "subset-test",
      displayUnit: "credits",
      async report() { return new Map() },
      async account() {
        return { plan: "pro", balance: 42, dailyAllowance: 100, unit: "credits" }
      },
    }
    setBillingProvider(subset)
    const a = await getBillingProvider().account("u")
    expect(a).toEqual({ plan: "pro", balance: 42, dailyAllowance: 100, unit: "credits" })
    expect(a?.payg).toBeUndefined()
  })
})

describe("billingSurface — deploymentPayer flag (SAI item 9)", () => {
  it("mirrors deploymentPayerActive(), and is ALL the browser learns (no identity)", async () => {
    const { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } = await import("../deployment-payer.js")
    try {
      expect(billingSurface().deploymentPayer).toBe(false)
      __setDeploymentPayerForTests("payer-acct")
      const s = billingSurface()
      expect(s.deploymentPayer).toBe(true)
      // The payer's identity must not appear anywhere in the projection.
      expect(JSON.stringify(s)).not.toContain("payer-acct")
    } finally {
      __resetDeploymentPayerForTests()
    }
  })
})
