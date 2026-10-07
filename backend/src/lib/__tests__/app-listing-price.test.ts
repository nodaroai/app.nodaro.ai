import { describe, it, expect } from "vitest"
import { appListingPrice, appListingFinalCredits } from "../app-listing-price.js"

/**
 * A published app's listed price (decided 2026-10-06): the preview run WITH
 * the creator's fee, plus the final and the nodes after it WITHOUT it — the
 * way a runner is charged (the fee settles on the app run alone; Render final
 * runs outside it). `base_estimated_credits` stores the part the fee applies
 * to, `estimated_credits` the listed price; the final part is what the
 * difference holds, so the monetization recalculation stays exact.
 */
const split = { preview: 40, final: 120 }

describe("appListingPrice — the preview with the fee, the final without", () => {
  it("unmonetized: the two parts, summed", () => {
    expect(appListingPrice(split, { enabled: false, flatFee: 10, percent: 50 })).toEqual({ base: 40, estimated: 160 })
  })

  it("a flat fee and a percentage apply to the preview alone", () => {
    expect(appListingPrice(split, { enabled: true, flatFee: 10, percent: 0 })).toEqual({ base: 40, estimated: 170 })
    expect(appListingPrice(split, { enabled: true, flatFee: 0, percent: 50 })).toEqual({ base: 40, estimated: 180 })
    expect(appListingPrice(split, { enabled: true, flatFee: 5, percent: 25 })).toEqual({ base: 40, estimated: 175 })
  })

  it("no Preview render: no final part, exactly the old price", () => {
    expect(appListingPrice({ preview: 130, final: 0 }, { enabled: true, flatFee: 10, percent: 0 })).toEqual({ base: 130, estimated: 140 })
  })

  it("a free preview is never marked up (as before)", () => {
    expect(appListingPrice({ preview: 0, final: 120 }, { enabled: true, flatFee: 10, percent: 0 })).toEqual({ base: 0, estimated: 120 })
  })
})

describe("appListingFinalCredits — the final part, read back from the stored row", () => {
  it("is the listed price less the preview with its fee", () => {
    const monetization = { enabled: true, flatFee: 5, percent: 25 }
    const { base, estimated } = appListingPrice(split, monetization)
    expect(appListingFinalCredits({ base, estimated }, monetization)).toBe(120)
    expect(appListingFinalCredits({ base: 40, estimated: 160 }, { enabled: false, flatFee: 0, percent: 0 })).toBe(120)
  })

  it("a listing stored before the split holds none: it updates on its next publish", () => {
    expect(appListingFinalCredits({ base: 130, estimated: 140 }, { enabled: true, flatFee: 10, percent: 0 })).toBe(0)
    expect(appListingFinalCredits({ base: 130, estimated: 130 }, { enabled: false, flatFee: 0, percent: 0 })).toBe(0)
  })

  it("never negative", () => {
    expect(appListingFinalCredits({ base: 130, estimated: 100 }, { enabled: false, flatFee: 0, percent: 0 })).toBe(0)
  })

  it("a fee change recomputes the price from the two parts", () => {
    const before = { enabled: false, flatFee: 0, percent: 0 }
    const stored = appListingPrice(split, before)
    const final = appListingFinalCredits(stored, before)
    expect(appListingPrice({ preview: stored.base, final }, { enabled: true, flatFee: 10, percent: 0 }).estimated).toBe(170)
  })
})
