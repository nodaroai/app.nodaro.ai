import { describe, it, expect } from "vitest"
import { appListingPrice, appListingMaxColumns, relistedAppMaxPrices, storedListingRange } from "../app-listing-price.js"

/**
 * The "up to" columns are priced exactly like the "from" ones (the same fee on
 * the preview part, the final part unmarked), from the listing's ceiling. A
 * fee change re-prices them the same way, and a row with no "up to" (NULL)
 * lists its "from" alone.
 */
const fee = { enabled: true, flatFee: 5, percent: 20 }
const floor = { preview: 100, final: 10, previewPerMinute: 2, finalPerMinute: 1, previewPerItem: 4, finalPerItem: 0 }
const ceiling = { preview: 300, final: 30, previewPerMinute: 6, finalPerMinute: 1, previewPerItem: 9, finalPerItem: 2 }

describe("appListingMaxColumns", () => {
  it("prices the ceiling as the listing prices the floor", () => {
    const top = appListingPrice(ceiling, fee)
    expect(appListingMaxColumns(ceiling, fee)).toEqual({
      base_max_estimated_credits: top.base,
      max_estimated_credits: top.estimated,
      base_max_per_minute_credits: top.basePerMinute,
      max_per_minute_credits: top.perMinute,
      base_max_per_item_credits: top.basePerItem,
      max_per_item_credits: top.perItem,
    })
  })
})

describe("relistedAppMaxPrices", () => {
  it("re-prices the stored ceiling under a new fee; a row without one stays without", () => {
    const stored = { ...appListingMaxColumns(ceiling, fee), monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 20 }
    const none = { enabled: false, flatFee: 0, percent: 0 }
    expect(relistedAppMaxPrices(stored, none)).toEqual(appListingMaxColumns(ceiling, none))
    expect(relistedAppMaxPrices({ max_estimated_credits: null }, none)).toEqual({})
  })
})

describe("storedListingRange", () => {
  it("the up-to figures, only where they exceed the from figures", () => {
    const from = appListingPrice(floor, fee)
    const row = {
      estimated_credits: from.estimated, per_minute_credits: from.perMinute, per_item_credits: from.perItem,
      ...appListingMaxColumns(ceiling, fee),
    }
    const top = appListingPrice(ceiling, fee)
    expect(storedListingRange(row)).toEqual({ maxEstimatedCredits: top.estimated, maxPerMinuteCredits: top.perMinute, maxPerItemCredits: top.perItem })
    expect(storedListingRange({ estimated_credits: 10, max_estimated_credits: 10 })).toEqual({})
    expect(storedListingRange({ estimated_credits: 10, max_estimated_credits: null })).toEqual({})
  })
})
