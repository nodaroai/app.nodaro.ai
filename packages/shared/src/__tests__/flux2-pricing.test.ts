import { describe, it, expect } from "vitest"
import { flux2CostUsd, flux2BaseCredits } from "../flux2-pricing.js"

describe("flux2CostUsd", () => {
  it("pro: $0.015 + $0.015/MP (in+out)", () => {
    expect(flux2CostUsd("flux-2-pro", 1, 0)).toBeCloseTo(0.03, 5)
    expect(flux2CostUsd("flux-2-pro", 2, 0)).toBeCloseTo(0.045, 5)
    expect(flux2CostUsd("flux-2-pro", 4, 0)).toBeCloseTo(0.075, 5)
    expect(flux2CostUsd("flux-2-pro", 2, 1)).toBeCloseTo(0.075, 5)
  })
  it("max: $0.07/out-MP + $0.03/MP per ref", () => {
    expect(flux2CostUsd("flux-2-max", 1, 0)).toBeCloseTo(0.07, 5)
    expect(flux2CostUsd("flux-2-max", 2, 0)).toBeCloseTo(0.14, 5)
    expect(flux2CostUsd("flux-2-max", 2, 1)).toBeCloseTo(0.20, 5)
    expect(flux2CostUsd("flux-2-max", 4, 0)).toBeCloseTo(0.28, 5)
  })
  it("flux2BaseCredits = ceil(usd / 0.02)", () => {
    expect(flux2BaseCredits("flux-2-max", 2, 0)).toBe(7)
    expect(flux2BaseCredits("flux-2-pro", 2, 0)).toBe(3)
    expect(flux2BaseCredits("flux-2-max", 1, 0)).toBe(4)
    expect(flux2BaseCredits("flux-2-klein", 1, 0)).toBe(1)
  })
})
