import { describe, it, expect } from "vitest"
import {
  FAL_PRICING,
  falCostUsd,
  type FalBillingUnit,
} from "../pricing.js"

describe("falCostUsd", () => {
  it("per_second: sync-lipsync-v3 at 60s ≈ $8.0", () => {
    // 0.13333 × 60 = 7.9998 — the spec's "≈ 8.0" (the rate is fixed at 0.13333,
    // so 2-digit precision is the honest tolerance here).
    expect(falCostUsd("sync-lipsync-v3", { seconds: 60 })).toBeCloseTo(8.0, 2)
  })

  it("per_second: sync-lipsync-v3 at 5s ≈ $0.66665", () => {
    expect(falCostUsd("sync-lipsync-v3", { seconds: 5 })).toBeCloseTo(0.66665, 5)
  })

  it("per_second: missing seconds defaults to 0 → $0", () => {
    expect(falCostUsd("sync-lipsync-v3", {})).toBe(0)
  })

  it("returns null for an unknown id", () => {
    expect(falCostUsd("not-a-real-model", { seconds: 10 })).toBeNull()
  })

  it("every FAL_PRICING entry has a valid unit and a positive numeric rate", () => {
    const validUnits: FalBillingUnit[] = ["per_second", "per_image", "flat"]
    const ids = Object.keys(FAL_PRICING)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const price = FAL_PRICING[id]
      expect(validUnits).toContain(price.unit)
      expect(typeof price.rate).toBe("number")
      expect(Number.isFinite(price.rate)).toBe(true)
      expect(price.rate).toBeGreaterThan(0)
    }
  })
})
