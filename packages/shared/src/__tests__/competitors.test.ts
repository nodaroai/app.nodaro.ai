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
