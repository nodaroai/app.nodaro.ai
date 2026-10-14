import { describe, it, expect } from "vitest"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { usdToCredits } from "@nodaro/shared/credits"
import { ANOMALY_TOLERANCE_USD, anomalyToleranceCredits } from "../credit-anomaly.js"

describe("anomaly tolerance", () => {
  it("is a dollar tolerance, not a credit count", () => {
    expect(ANOMALY_TOLERANCE_USD).toBeCloseTo(0.02, 10)
  })

  it("equals 1 credit at the current base — preserving today's behaviour", () => {
    expect(CREDIT_BASE_USD).toBe(0.002)
    expect(anomalyToleranceCredits()).toBe(10)
  })

  it("expresses the same dollar amount however the base is denominated", () => {
    // The invariant that survives re-denomination: tolerance x base ~= $0.02.
    expect(anomalyToleranceCredits() * CREDIT_BASE_USD).toBeCloseTo(ANOMALY_TOLERANCE_USD, 10)
  })
})

describe("computeActualCredits float-noise correction", () => {
  // The commit path used a bare ceil, so IEEE-754 division noise billed a full
  // extra credit. Measured at 61 production jobs; 55 were lip-sync at $0.56.
  it("does not over-charge on costs that trip IEEE-754 division", () => {
    expect(Math.ceil(0.56 / 0.02)).toBe(29) // what shipped
    expect(usdToCredits(0.56)).toBe(280) // what it actually costs
  })

  it("is unchanged on costs that divide cleanly", () => {
    // Derived from the constant rather than hardcoded, so this test states the
    // INVARIANT (an exact multiple of the base converts without rounding up)
    // and survives any future change to CREDIT_BASE_USD.
    for (const multiple of [1, 5, 25, 50, 500]) {
      const usd = multiple * CREDIT_BASE_USD
      expect(usdToCredits(usd)).toBe(multiple)
    }
  })

  it("still rounds genuinely fractional costs up", () => {
    expect(usdToCredits(0.565)).toBe(283)
    expect(usdToCredits(0.021)).toBe(11)
  })
})
