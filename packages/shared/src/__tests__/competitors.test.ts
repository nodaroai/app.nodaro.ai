import { describe, expect, it } from "vitest"
import {
  COMPETITOR_SCAN_CREDIT_COSTS,
  COMPETITOR_SCAN_MAX_SEARCHES,
  SOCIAL_SEARCH_CREDITS_PER_PAGE,
  competitorScanCreditId,
  competitorScanCredits,
  competitorScanSearches,
} from "../index.js"

describe("competitor scan pricing", () => {
  it("counts one search per filled account and per about-platform", () => {
    expect(competitorScanSearches({ accounts: { tiktok: "acme", x: " ", instagram: "" }, aboutPlatforms: ["reddit", "x", "myspace"] })).toBe(3)
    expect(competitorScanSearches({})).toBe(0)
  })

  it("prices a scan as one Social Search page per search", () => {
    expect(Object.keys(COMPETITOR_SCAN_CREDIT_COSTS)).toHaveLength(COMPETITOR_SCAN_MAX_SEARCHES)
    expect(COMPETITOR_SCAN_CREDIT_COSTS["competitor-scan:3"]).toBe(3 * SOCIAL_SEARCH_CREDITS_PER_PAGE)
    expect(competitorScanCredits(4)).toBe(4 * SOCIAL_SEARCH_CREDITS_PER_PAGE)
    expect(competitorScanCredits(0)).toBe(0)
  })

  it("keeps the credit id inside the priced range", () => {
    expect(competitorScanCreditId(0)).toBe("competitor-scan:1")
    expect(competitorScanCreditId(99)).toBe(`competitor-scan:${COMPETITOR_SCAN_MAX_SEARCHES}`)
  })
})

describe("did it work", () => {
  it("offers \"I did this\" only on cards whose advice ends in a post of one's own", async () => {
    const { isMeasurableCard, adviceFamilyOf, ACTION_CARD_KINDS, ADVICE_FAMILIES } = await import("../index.js")
    const card = (kind: (typeof ACTION_CARD_KINDS)[number], own = false) => ({ kind, params: { own } })
    expect(isMeasurableCard(card("outlier"))).toBe(true)
    expect(isMeasurableCard(card("outlier", true))).toBe(true)
    expect(isMeasurableCard(card("sound"))).toBe(true)
    expect(isMeasurableCard(card("market_sound"))).toBe(true)
    expect(isMeasurableCard(card("launch"))).toBe(true)
    expect(isMeasurableCard(card("complaints"))).toBe(true)
    expect(isMeasurableCard(card("complaints", true))).toBe(false)
    for (const kind of ["spreading", "mentions_up", "pace", "top_in_sources"] as const) expect(isMeasurableCard(card(kind))).toBe(false)
    expect(adviceFamilyOf("market_sound")).toBe("sound")
    // Every measurable kind belongs to a family the record can name.
    for (const kind of ACTION_CARD_KINDS) {
      const family = adviceFamilyOf(kind)
      if (family) expect(ADVICE_FAMILIES).toContain(family)
    }
  })
})
