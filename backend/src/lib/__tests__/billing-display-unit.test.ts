import { describe, it, expect, afterEach } from "vitest"
import { applyDisplayUnit, toUnits } from "../billing-display-unit.js"
import {
  noneBillingProvider,
  setBillingProvider,
  getBillingProvider,
  clearBillingProvider,
  billingSurface,
  type BillingProvider,
  type AccountSummary,
  type Charge,
} from "../billing-provider.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

/**
 * Phase B, design §3 — the display-unit layer. Identity rules are asserted
 * with `toBe`: a wrapper that reconstructs the object and silently reorders
 * keys or drops an optional would pass a deep-equality check.
 */

const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
function configure(billing: unknown): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing })
  __resetSurfaceProfileCacheForTests()
}
function unconfigure(): void {
  if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
  __resetSurfaceProfileCacheForTests()
}
afterEach(() => {
  clearBillingProvider()
  unconfigure()
})

const RICH: AccountSummary = {
  plan: "pro",
  balance: 12,
  dailyAllowance: 3,
  unit: "credits",
  periodStart: "2026-08-01T00:00:00.000Z",
  generations: 7,
  spent: { amount: 1.5, currency: "USD" },
  payg: { enabled: true, reserve: 10, rate: { creditsPerUnit: 100, currency: "ILS" }, monthlyCap: { amount: 50, currency: "ILS" } },
  daily: { limit: 10, used: 3, remaining: 7, resetsAt: "2026-08-31T00:00:00.000Z" },
  reserveValue: { amount: 2, currency: "ILS" },
  byCategory: [
    { category: "image", count: 4, amount: 8, spent: { amount: 1, currency: "ILS" } },
    { category: "video", count: 1, amount: null, spent: null },
  ],
}

const PRICED: Charge = { amount: 12, unit: "credits", secondaryAmount: 0.4213, secondaryUnit: "usd" }
const UNPRICED: Charge = { amount: null, unit: "credits", secondaryAmount: null, secondaryUnit: "usd" }

function stub(over: Partial<BillingProvider> = {}): BillingProvider {
  return {
    id: "stub-cloud",
    displayUnit: "credits",
    async quote() {
      return { amount: 5, unit: "credits" }
    },
    async report(ids) {
      return new Map(ids.map((id) => [id, id === "unpriced" ? UNPRICED : PRICED]))
    },
    async account() {
      return RICH
    },
    ...over,
  }
}

describe("toUnits — the one conversion", () => {
  it("null and undefined stay null (never 0)", () => {
    expect(toUnits(null, 2000, 0)).toBeNull()
    expect(toUnits(undefined, 2000, 0)).toBeNull()
  })
  it("a non-finite input never becomes a number", () => {
    expect(toUnits(Number.NaN, 2000, 0)).toBeNull()
    expect(toUnits(Number.POSITIVE_INFINITY, 2000, 0)).toBeNull()
    expect(toUnits(Number.MAX_VALUE, 10, 0)).toBeNull() // overflow
  })
  it("converts and rounds half-up to the configured decimals", () => {
    expect(toUnits(12, 2000, 0)).toBe(24000)
    expect(toUnits(0, 2000, 0)).toBe(0) // a real zero stays a real zero
    expect(toUnits(1, 2.5, 0)).toBe(3)
    expect(toUnits(3, 0.5, 1)).toBe(1.5)
    expect(toUnits(1, 0.5, 1)).toBe(0.5)
  })
})

describe("applyDisplayUnit — identity rules", () => {
  it("returns the inner provider BY IDENTITY when no unit is configured", () => {
    const inner = stub()
    expect(applyDisplayUnit(inner)).toBe(inner)
    setBillingProvider(inner)
    expect(getBillingProvider()).toBe(inner)
  })
  it("returns `none` BY IDENTITY even when a unit is configured (a worker's slot must stay inert)", () => {
    configure({ unitLabel: "קרדיטים", unitRate: 2000 })
    expect(applyDisplayUnit(noneBillingProvider)).toBe(noneBillingProvider)
    expect(getBillingProvider()).toBe(noneBillingProvider)
    expect(billingSurface().mountCostTab).toBe(false)
    expect(billingSurface().displayUnit).toBe("usd")
  })
  it("a half-configured or invalid unit was dropped by the schema → identity", () => {
    configure({ unitLabel: "קרדיטים" })
    const inner = stub()
    expect(applyDisplayUnit(inner)).toBe(inner)
  })
})

describe("applyDisplayUnit — configured (label קרדיטים, rate 2000)", () => {
  function wrapped(over: Partial<BillingProvider> = {}): BillingProvider {
    configure({ unitLabel: "קרדיטים", unitRate: 2000 })
    setBillingProvider(stub(over))
    return getBillingProvider()
  }

  it("relabels the surface and keeps the provider id + capabilities", () => {
    const p = wrapped()
    expect(p.id).toBe("stub-cloud")
    expect(p.displayUnit).toBe("קרדיטים")
    const s = billingSurface()
    expect(s.providerId).toBe("stub-cloud")
    expect(s.displayUnit).toBe("קרדיטים")
    expect(s.mountCostTab).toBe(true)
    expect(s.canQuote).toBe(true)
  })

  it("report(): converts amounts, relabels, and DELETES the secondary (USD) keys", async () => {
    const m = await wrapped().report(["j1", "unpriced"])
    expect(m).not.toBeNull()
    const priced = m!.get("j1")!
    expect(priced).toEqual({ amount: 24000, unit: "קרדיטים" })
    expect(Object.hasOwn(priced, "secondaryAmount")).toBe(false)
    expect(Object.hasOwn(priced, "secondaryUnit")).toBe(false)
    const unpriced = m!.get("unpriced")!
    expect(unpriced.amount).toBeNull() // "could not say" survives — never 0
    expect(Object.hasOwn(unpriced, "secondaryAmount")).toBe(false)
  })

  it("report(): a null batch (authority unavailable) stays null", async () => {
    const p = wrapped({ async report() { return null } })
    expect(await p.report(["j1"])).toBeNull()
  })

  it("quote(): converted + relabeled; absent when the inner has none", async () => {
    expect(await wrapped().quote!({ nodeType: "x", modelKey: null })).toEqual({ amount: 10000, unit: "קרדיטים" })
    const noQuote = stub()
    delete (noQuote as { quote?: unknown }).quote
    configure({ unitLabel: "קרדיטים", unitRate: 2000 })
    setBillingProvider(noQuote)
    expect(getBillingProvider().quote).toBeUndefined()
    expect(billingSurface().canQuote).toBe(false)
  })

  it("account(): every nested object is rebuilt — converted, relabeled, money nulled", async () => {
    const a = (await wrapped().account("u"))!
    expect(a.plan).toBe("pro")
    expect(a.balance).toBe(24000)
    expect(a.dailyAllowance).toBe(6000)
    expect(a.unit).toBe("קרדיטים")
    expect(a.periodStart).toBe(RICH.periodStart)
    expect(a.generations).toBe(7)
    expect(a.spent).toBeNull()
    expect(a.payg).toBeNull()
    expect(a.reserveValue).toBeNull()
    expect(a.daily).toEqual({ limit: 20000, used: 6000, remaining: 14000, resetsAt: RICH.daily!.resetsAt })
    expect(a.byCategory).toEqual([
      { category: "image", count: 4, amount: 16000, spent: null },
      { category: "video", count: 1, amount: null, spent: null },
    ])
    // Not the same nested objects — nothing survives by reference.
    expect(a.daily).not.toBe(RICH.daily)
    expect(a.byCategory).not.toBe(RICH.byCategory)
  })

  it("account(): null stays null for every convertible field; optional keys keep their presence", async () => {
    const minimal: AccountSummary = { plan: "unknown", balance: null, dailyAllowance: null, unit: "credits" }
    const a = (await wrapped({ async account() { return minimal } }).account("u"))!
    expect(a).toEqual({ plan: "unknown", balance: null, dailyAllowance: null, unit: "קרדיטים" })
    expect(Object.hasOwn(a, "payg")).toBe(false)
    expect(Object.hasOwn(a, "daily")).toBe(false)
    const withNulls: AccountSummary = { ...minimal, daily: null, byCategory: null, spent: null }
    const b = (await wrapped({ async account() { return withNulls } }).account("u"))!
    expect(b.daily).toBeNull()
    expect(b.byCategory).toBeNull()
    expect(b.spent).toBeNull()
  })

  it("account(): daily.remaining is recomputed after conversion; a non-finite counter nulls the whole block", async () => {
    const odd: AccountSummary = { ...RICH, daily: { limit: 10, used: 12, remaining: 0, resetsAt: "x" } }
    const a = (await wrapped({ async account() { return odd } }).account("u"))!
    expect(a.daily).toEqual({ limit: 20000, used: 24000, remaining: 0, resetsAt: "x" })
    const broken: AccountSummary = { ...RICH, daily: { limit: Number.NaN, used: 1, remaining: 0, resetsAt: "x" } }
    const b = (await wrapped({ async account() { return broken } }).account("u"))!
    expect(b.daily).toBeNull()
  })

  it("account(): a null account (authority unavailable) stays null", async () => {
    expect(await wrapped({ async account() { return null } }).account("u")).toBeNull()
  })

  it("`limit: 0` is a real value (blocked) and survives conversion as 0", async () => {
    const blocked: AccountSummary = { ...RICH, daily: { limit: 0, used: 0, remaining: 0, resetsAt: "x" } }
    const a = (await wrapped({ async account() { return blocked } }).account("u"))!
    expect(a.daily).toEqual({ limit: 0, used: 0, remaining: 0, resetsAt: "x" })
  })
})

describe("decimals + the costTab lever", () => {
  it("honours unitDecimals (rate 0.5, 1 decimal): 3 credits → 1.5", async () => {
    configure({ unitLabel: "u", unitRate: 0.5, unitDecimals: 1 })
    setBillingProvider(stub())
    const m = await getBillingProvider().report(["j1"])
    expect(m!.get("j1")!.amount).toBe(6) // 12 × 0.5
    const a = (await getBillingProvider().account("u"))!
    expect(a.dailyAllowance).toBe(1.5)
  })
  it("costTab: \"hidden\" keeps the Cost tab off with a provider registered (D3)", () => {
    configure({ costTab: "hidden" })
    setBillingProvider(stub())
    expect(getBillingProvider().id).toBe("stub-cloud")
    expect(billingSurface().canReport).toBe(true)
    expect(billingSurface().mountCostTab).toBe(false)
  })
  it("re-registering after the surface changes recomputes the composition", () => {
    const inner = stub()
    setBillingProvider(inner)
    expect(getBillingProvider()).toBe(inner)
    configure({ unitLabel: "u", unitRate: 3 })
    setBillingProvider(inner)
    expect(getBillingProvider()).not.toBe(inner)
    expect(getBillingProvider().displayUnit).toBe("u")
  })
})
