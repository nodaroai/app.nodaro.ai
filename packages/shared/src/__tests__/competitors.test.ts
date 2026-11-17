import { describe, expect, it } from "vitest"
import {
  COMPETITOR_ABOUT_PLATFORMS,
  COMPETITOR_SCAN_CREDIT_COSTS,
  COMPETITOR_SCAN_MAX_SEARCHES,
  COMPETITOR_SCAN_PAGE_CREDIT_ID,
  COMPETITOR_SEARCH_TERMS_MAX,
  SCAN_PAGE_CREDIT_COSTS,
  SOCIAL_SEARCH_CREDITS_PER_PAGE,
  TOPIC_PLATFORMS,
  TOPIC_SCAN_PAGE_CREDIT_ID,
  competitorScanCreditId,
  competitorScanCredits,
  competitorScanPages,
  competitorScanSearches,
  normalizeSearchTerms,
  topicScanCredits,
  topicScanPages,
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

  it("prices any number of pages in full, past the old twelve-search ceiling", () => {
    expect(competitorScanCredits(13)).toBe(13 * SOCIAL_SEARCH_CREDITS_PER_PAGE)
    expect(SCAN_PAGE_CREDIT_COSTS[COMPETITOR_SCAN_PAGE_CREDIT_ID]).toBe(SOCIAL_SEARCH_CREDITS_PER_PAGE)
    expect(SCAN_PAGE_CREDIT_COSTS[TOPIC_SCAN_PAGE_CREDIT_ID]).toBe(SOCIAL_SEARCH_CREDITS_PER_PAGE)
  })
})

describe("search terms", () => {
  it("are trimmed, collapsed and deduplicated without regard to case, keeping # and @", () => {
    expect(normalizeSearchTerms(["  Jane   Example ", "", "jane example", "#ExampleBakes", "@example_creator", "   "])).toEqual(["Jane Example", "#ExampleBakes", "@example_creator"])
  })

  it("drop a one-word tag's or handle's trailing punctuation, as the server does", () => {
    // A tag with no word left ("#", "#!") stays as sent, for the server to refuse (no letter or digit).
    expect(normalizeSearchTerms(["#tag!", "@example.creator.", "#", "#!", "Jane Example!"])).toEqual(["#tag", "@example.creator", "#", "#!", "Jane Example!"])
  })

  it("keep combining marks: a Hindi or Thai tag is not cut at its vowel sign", () => {
    expect(normalizeSearchTerms(["#हिंदी", "#สวัสดี!"])).toEqual(["#हिंदी", "#สวัสดี"])
  })

  it("search each about-platform once per term, and the name once when there are none", () => {
    const base = { accounts: { tiktok: "acme" }, aboutPlatforms: ["x", "reddit"] }
    expect(competitorScanSearches(base)).toBe(1 + 2)
    expect(competitorScanSearches({ ...base, searchTerms: ["Acme Paint", "#acmepaint", "@acme"] })).toBe(1 + 2 * 3)
    expect(competitorScanPages({ ...base, searchTerms: ["a", "b"] })).toBe(1 + 2 * 2)
  })

  it("count only the terms the plan allows, and the name when it allows none", () => {
    const c = { aboutPlatforms: ["x", "reddit"], searchTerms: ["a", "b", "c", "d"] }
    expect(competitorScanSearches({ ...c, termCap: 3 })).toBe(2 * 3)
    expect(competitorScanSearches({ ...c, termCap: 0 })).toBe(2)
    expect(competitorScanSearches({ ...c, termCap: null })).toBe(2 * 4)
    expect(competitorScanSearches({ aboutPlatforms: ["x"], searchTerms: Array.from({ length: 40 }, (_, i) => `t${i}`) })).toBe(COMPETITOR_SEARCH_TERMS_MAX)
  })
})

describe("topic scan pricing", () => {
  it("counts the pages each platform's search reads at the topic's post count", () => {
    // TikTok and X page a keyword search to 60; YouTube and Reddit read one page whatever is asked.
    expect(topicScanPages({ platforms: ["tiktok", "x"], postCount: 20 })).toBe(2)
    expect(topicScanPages({ platforms: ["tiktok", "x"], postCount: 60 })).toBe(6)
    expect(topicScanPages({ platforms: ["youtube", "reddit"], postCount: 60 })).toBe(2)
    expect(topicScanPages({ platforms: ["tiktok", "myspace"], postCount: 40 })).toBe(2)
    expect(topicScanCredits(6)).toBe(6 * SOCIAL_SEARCH_CREDITS_PER_PAGE)
    expect(topicScanCredits(0)).toBe(0)
    expect(topicScanCredits(Number.NaN)).toBe(0)
    expect(competitorScanCredits(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it("can be searched on every about-platform a brand can", () => {
    expect([...TOPIC_PLATFORMS].sort()).toEqual([...COMPETITOR_ABOUT_PLATFORMS].sort())
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
