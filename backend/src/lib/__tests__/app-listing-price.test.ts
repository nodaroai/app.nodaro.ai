import { describe, it, expect } from "vitest"
import { appListingPrice, appListingFinalCredits, appListingFinalPerMinute, relistedAppPrices, storedListingFinalPerMinute, storedListingFinalPerItem, storedListingRunPrice } from "../app-listing-price.js"

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
    expect(appListingPrice(split, { enabled: false, flatFee: 10, percent: 50 })).toEqual({ base: 40, estimated: 160, basePerMinute: 0, perMinute: 0, basePerItem: 0, perItem: 0 })
  })

  it("a flat fee and a percentage apply to the preview alone", () => {
    expect(appListingPrice(split, { enabled: true, flatFee: 10, percent: 0 })).toEqual({ base: 40, estimated: 170, basePerMinute: 0, perMinute: 0, basePerItem: 0, perItem: 0 })
    expect(appListingPrice(split, { enabled: true, flatFee: 0, percent: 50 })).toEqual({ base: 40, estimated: 180, basePerMinute: 0, perMinute: 0, basePerItem: 0, perItem: 0 })
    expect(appListingPrice(split, { enabled: true, flatFee: 5, percent: 25 })).toEqual({ base: 40, estimated: 175, basePerMinute: 0, perMinute: 0, basePerItem: 0, perItem: 0 })
  })

  it("no Preview render: no final part, exactly the old price", () => {
    expect(appListingPrice({ preview: 130, final: 0 }, { enabled: true, flatFee: 10, percent: 0 })).toEqual({ base: 130, estimated: 140, basePerMinute: 0, perMinute: 0, basePerItem: 0, perItem: 0 })
  })

  it("a free preview is never marked up (as before)", () => {
    expect(appListingPrice({ preview: 0, final: 120 }, { enabled: true, flatFee: 10, percent: 0 })).toEqual({ base: 0, estimated: 120, basePerMinute: 0, perMinute: 0, basePerItem: 0, perItem: 0 })
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

// Per minute of the episode (decided 2026-10-07). The run is charged the fee
// on its total: flat + ceil(total × percent). The listing applies the flat fee
// once, on the fixed half, and the percentage to each half rounded up, so at
// any length the listed price is never below the charge.
describe("a per-minute listing: the fee's flat once, its percentage per minute", () => {
  const perMinute = { preview: 82, final: 0, previewPerMinute: 14, finalPerMinute: 0 }

  it("unmonetized: the parts as they are", () => {
    expect(appListingPrice(perMinute, { enabled: false, flatFee: 10, percent: 50 })).toEqual({ base: 82, estimated: 82, basePerMinute: 14, perMinute: 14, basePerItem: 0, perItem: 0 })
  })

  it("monetized: the flat fee on the fixed half, the percentage on both, each rounded up", () => {
    // 82 + 10 + ceil(82 × 0.25 = 20.5) = 113; 14 + ceil(14 × 0.25 = 3.5) = 18
    expect(appListingPrice(perMinute, { enabled: true, flatFee: 10, percent: 25 })).toEqual({ base: 82, estimated: 113, basePerMinute: 14, perMinute: 18, basePerItem: 0, perItem: 0 })
  })

  it.each([1, 7, 45, 61, 180])("at %i minutes it is never below what the run is charged", (minutes) => {
    const m = { enabled: true, flatFee: 10, percent: 25 }
    const listed = appListingPrice(perMinute, m)
    const runTotal = perMinute.preview + perMinute.previewPerMinute * minutes
    const charged = runTotal + m.flatFee + Math.ceil((runTotal * m.percent) / 100)
    expect(listed.estimated + listed.perMinute * minutes).toBeGreaterThanOrEqual(charged)
    expect(listed.estimated + listed.perMinute * minutes - charged).toBeLessThanOrEqual(1 + minutes)
  })

  it("a preview whose only cost is per minute still earns the flat fee, as its run does", () => {
    expect(appListingPrice({ preview: 0, final: 0, previewPerMinute: 14 }, { enabled: true, flatFee: 10, percent: 0 })).toEqual({ base: 0, estimated: 10, basePerMinute: 14, perMinute: 14, basePerItem: 0, perItem: 0 })
  })

  it("the final part's per minute carries no fee (A6.3: Render final runs outside the app run)", () => {
    const split = { preview: 22, final: 0, previewPerMinute: 5, finalPerMinute: 10 }
    expect(appListingPrice(split, { enabled: true, flatFee: 0, percent: 50 })).toEqual({ base: 22, estimated: 33, basePerMinute: 5, perMinute: 8 + 10, basePerItem: 0, perItem: 0 })
  })

  it("the final part's per minute reads back from the stored pair", () => {
    const m = { enabled: true, flatFee: 5, percent: 50 }
    const split = { preview: 22, final: 40, previewPerMinute: 5, finalPerMinute: 10 }
    const p = appListingPrice(split, m)
    const stored = { base: p.base, estimated: p.estimated, basePerMinute: p.basePerMinute, perMinute: p.perMinute }
    expect(appListingFinalCredits(stored, m)).toBe(40)
    expect(appListingFinalPerMinute(stored, m)).toBe(10)
  })

  it("a fee change re-prices both pairs from the stored row", () => {
    const before = { enabled: false, flatFee: 0, percent: 0 }
    const split = { preview: 22, final: 40, previewPerMinute: 5, finalPerMinute: 10 }
    const p = appListingPrice(split, before)
    const row = { base_estimated_credits: p.base, estimated_credits: p.estimated, base_per_minute_credits: p.basePerMinute, per_minute_credits: p.perMinute }
    expect(storedListingFinalPerMinute(row)).toBe(10)
    const after = { enabled: true, flatFee: 5, percent: 50 }
    expect(relistedAppPrices(row, after)).toEqual({ estimated_credits: 22 + 5 + 11 + 40, base_per_minute_credits: 5, per_minute_credits: 8 + 10, base_per_item_credits: 0, per_item_credits: 0 })
  })

  it("a row stored before the per-minute columns reads as none", () => {
    const row = { base_estimated_credits: 130, estimated_credits: 140, monetization_enabled: true, monetization_flat_fee: 10, monetization_percent: 0 }
    expect(storedListingFinalPerMinute(row)).toBe(0)
    expect(relistedAppPrices(row, { enabled: true, flatFee: 10, percent: 0 })).toEqual({ estimated_credits: 140, base_per_minute_credits: 0, per_minute_credits: 0, base_per_item_credits: 0, per_item_credits: 0 })
  })
})

describe("storedListingRunPrice — what the app run alone is listed at (review round F4)", () => {
  it("the preview with its fee, fixed and per minute: the Render final part left out", () => {
    const m = { enabled: true, flatFee: 5, percent: 50 }
    const p = appListingPrice({ preview: 22, final: 40, previewPerMinute: 5, finalPerMinute: 10 }, m)
    const row = {
      base_estimated_credits: p.base, estimated_credits: p.estimated, base_per_minute_credits: p.basePerMinute, per_minute_credits: p.perMinute,
      monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 50,
    }
    expect(p.estimated).toBe(22 + 5 + 11 + 40)
    expect(storedListingRunPrice(row)).toEqual({ fixed: 22 + 5 + 11, perMinute: 8, perItem: 0 })
  })
  it("no final part: the listed price itself", () => {
    const row = { base_estimated_credits: 82, estimated_credits: 82, base_per_minute_credits: 14, per_minute_credits: 14 }
    expect(storedListingRunPrice(row)).toEqual({ fixed: 82, perMinute: 14, perItem: 0 })
  })
  it("a row stored before the split holds no final part: the listed price", () => {
    expect(storedListingRunPrice({ estimated_credits: 140 })).toEqual({ fixed: 140, perMinute: 0, perItem: 0 })
  })
})

// A List the app's user fills (decided 2026-10-07): a figure per further item,
// stored as a pair like the fixed and per-minute ones. The fee's percentage
// applies to the preview's per-item part, rounded up; the flat fee is once.
describe("a per-item listing", () => {
  const split = { preview: 22, final: 40, previewPerMinute: 5, finalPerMinute: 10, previewPerItem: 30, finalPerItem: 4 }

  it("unmonetized: the parts as they are", () => {
    expect(appListingPrice(split, { enabled: false, flatFee: 0, percent: 0 })).toMatchObject({ basePerItem: 30, perItem: 34 })
  })

  it("monetized: the percentage on the preview's per-item part, rounded up; the final's carries no fee", () => {
    // 30 + ceil(30 × 0.25 = 7.5) = 38, + 4
    expect(appListingPrice(split, { enabled: true, flatFee: 10, percent: 25 })).toMatchObject({ basePerItem: 30, perItem: 38 + 4 })
  })

  it.each([1, 3, 10])("never below the charge with %i more items", (extra) => {
    const m = { enabled: true, flatFee: 10, percent: 25 }
    const listed = appListingPrice({ preview: 50, final: 0, previewPerItem: 30 }, m)
    const runTotal = 50 + 30 * extra
    const charged = runTotal + m.flatFee + Math.ceil((runTotal * m.percent) / 100)
    expect(listed.estimated + listed.perItem * extra).toBeGreaterThanOrEqual(charged)
  })

  it("reads back, re-prices under a fee change, and the run's part leaves the final's out", () => {
    const m = { enabled: true, flatFee: 5, percent: 50 }
    const p = appListingPrice(split, m)
    const row = {
      base_estimated_credits: p.base, estimated_credits: p.estimated,
      base_per_minute_credits: p.basePerMinute, per_minute_credits: p.perMinute,
      base_per_item_credits: p.basePerItem, per_item_credits: p.perItem,
      monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 50,
    }
    expect(storedListingFinalPerItem(row)).toBe(4)
    expect(storedListingRunPrice(row).perItem).toBe(45)
    expect(relistedAppPrices(row, { enabled: false, flatFee: 0, percent: 0 })).toMatchObject({ base_per_item_credits: 30, per_item_credits: 34 })
  })

  it("a row stored before the per-item columns reads as none", () => {
    expect(storedListingFinalPerItem({ estimated_credits: 140 })).toBe(0)
    expect(storedListingRunPrice({ estimated_credits: 140 }).perItem).toBe(0)
  })
})
