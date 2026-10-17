// @test-watches frontend/src/lib/pricing-data.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import {
  creditsForLoadUsd,
  MIN_LOAD_USD,
  MAX_LOAD_USD,
  LOAD_RATE_ANCHORS,
} from "../load-rate.js"
import { TOP_UPS } from "../stripe-config.js"

// The pay-as-you-go load rate: one function prices every "load $Y" purchase.
// Derived from the live pack ladder — the four packs ARE the anchors, so the
// two purchase paths can never disagree on price.

describe("load rate anchors", () => {
  it("match the live pack grants exactly", () => {
    const anchorCredits = LOAD_RATE_ANCHORS.map((a) => a.credits)
    const packGrants = Object.values(TOP_UPS).sort((a, b) => a - b)
    expect(anchorCredits).toEqual(packGrants)
    expect(creditsForLoadUsd(10)).toBe(3300)
    expect(creditsForLoadUsd(25)).toBe(8500)
    expect(creditsForLoadUsd(50)).toBe(17500)
    expect(creditsForLoadUsd(100)).toBe(36000)
  })
})

describe("shape invariants", () => {
  it("bounds are enforced", () => {
    expect(MIN_LOAD_USD).toBe(5)
    expect(MAX_LOAD_USD).toBe(1000)
    expect(() => creditsForLoadUsd(4)).toThrow()
    expect(() => creditsForLoadUsd(1001)).toThrow()
    expect(() => creditsForLoadUsd(10.5)).toThrow() // whole dollars only
    expect(() => creditsForLoadUsd(0)).toThrow()
    expect(() => creditsForLoadUsd(-10)).toThrow()
  })

  it("credits are strictly increasing in amount", () => {
    let prev = 0
    for (let usd = MIN_LOAD_USD; usd <= MAX_LOAD_USD; usd++) {
      const c = creditsForLoadUsd(usd)
      expect(c).toBeGreaterThan(prev)
      prev = c
    }
  })

  it("the per-dollar rate never decreases as the load grows (volume rewarded)", () => {
    let prevRate = 0
    for (let usd = MIN_LOAD_USD; usd <= MAX_LOAD_USD; usd++) {
      const rate = creditsForLoadUsd(usd) / usd
      expect(rate).toBeGreaterThanOrEqual(prevRate - 1e-9)
      prevRate = rate
    }
  })

  it("the rate ceiling is pinned at 360 credits per dollar", () => {
    // Pinned ceiling above the $100 anchor — rationale documented internally.
    for (const usd of [100, 250, 500, 1000]) {
      expect(creditsForLoadUsd(usd) / usd).toBeLessThanOrEqual(360 + 1e-9)
    }
    expect(creditsForLoadUsd(1000)).toBe(360000)
  })

  it("every subscription tier stays cheaper per credit than the best load rate", () => {
    // Public plan prices (pricing-data.ts) vs monthly grants (TIER_CREDITS).
    // Subscribing must always beat loading on unit price — the ladder is the
    // acquisition funnel, not the volume discount.
    const bestLoadUsdPerCredit = 1 / 360
    const plans: Array<[number, number]> = [
      [12, 4500], // basic
      [29, 11000], // standard
      [59, 23000], // pro
      [129, 52000], // business
    ]
    for (const [price, credits] of plans) {
      expect(price / credits).toBeLessThan(bestLoadUsdPerCredit)
    }
  })
})

describe("frontend mirror stays in sync", () => {
  it("pricing-data.ts carries the same anchors and ceiling", () => {
    const fe = readFileSync(
      path.resolve(__dirname, "../../../../../frontend/src/lib/pricing-data.ts"),
      "utf8"
    )
    for (const a of LOAD_RATE_ANCHORS) {
      expect(fe).toContain(`{ usd: ${a.usd}, credits: ${a.credits} }`)
    }
    expect(fe).toContain("MAX_LOAD_RATE_PER_USD = 360")
  })
})
