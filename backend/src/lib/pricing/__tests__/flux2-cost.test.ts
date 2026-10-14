import { describe, it, expect } from "vitest"
import { usdToCredits } from "@nodaro/shared/credits"
import { flux2CostUsd, flux2BaseCredits } from "../flux2-cost.js"

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
  it("flux2BaseCredits = usdToCredits(cost)", () => {
    expect(flux2BaseCredits("flux-2-max", 2, 0)).toBe(70)
    expect(flux2BaseCredits("flux-2-pro", 2, 0)).toBe(23)
    expect(flux2BaseCredits("flux-2-max", 1, 0)).toBe(35)
    expect(flux2BaseCredits("flux-2-klein", 1, 0)).toBe(3)
  })
})

describe("flux2BaseCredits — single-sourced on usdToCredits", () => {
  const MODELS = ["flux-2-pro", "flux-2-max", "flux-2-klein"] as const
  const MEGAPIXELS = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 8]
  const REFS = [0, 1, 2, 3, 4]

  it("equals usdToCredits(flux2CostUsd(...)) for every grid cell", () => {
    let compared = 0
    for (const model of MODELS) {
      for (const mp of MEGAPIXELS) {
        for (const refs of REFS) {
          expect(flux2BaseCredits(model, mp, refs)).toBe(usdToCredits(flux2CostUsd(model, mp, refs)))
          compared++
        }
      }
    }
    expect(compared).toBe(MODELS.length * MEGAPIXELS.length * REFS.length)
  })

  it("still absorbs the float-noise case the inline guard was written for", () => {
    // flux-2-max @ 2MP, 0 refs = $0.14 exactly. The 0.02 below is deliberately
    // a LITERAL, not CREDIT_BASE_USD: it reproduces the historical bug this
    // guard was written for — 0.14 / 0.02 = 7.000000000000001, so a bare ceil
    // charged 8 instead of 7. Keeping the literal keeps the illustration
    // meaningful now that the base has moved.
    expect(flux2CostUsd("flux-2-max", 2, 0)).toBeCloseTo(0.14, 10)
    expect(Math.ceil(flux2CostUsd("flux-2-max", 2, 0) / 0.02)).toBe(8) // the historical bug
    expect(flux2BaseCredits("flux-2-max", 2, 0)).toBe(usdToCredits(0.14)) // guarded
  })
})
