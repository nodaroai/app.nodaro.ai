import { describe, it, expect } from "vitest"
import { META_ADS_SCRAPE_CREDIT_COSTS, META_ADS_SCRAPE_TIERS, buildMetaAdsScrapeCreditId } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

/**
 * The frontend badge / estimator read `META_ADS_SCRAPE_CREDIT_COSTS`
 * (packages/shared); the guard + reservation read `STATIC_CREDIT_COSTS` /
 * `model_pricing`. The scraper table rotted 10× apart once — this pins the
 * Meta Ads table to the backend for every SKU the builder can produce.
 */
describe("meta-ads-scrape credit table sync", () => {
  it("META_ADS_SCRAPE_CREDIT_COSTS equals STATIC_CREDIT_COSTS for every SKU", () => {
    for (const [id, credits] of Object.entries(META_ADS_SCRAPE_CREDIT_COSTS)) {
      expect(STATIC_CREDIT_COSTS[id], `"${id}" differs between shared and backend`).toBe(credits)
    }
  })

  it("the pre-run workflow estimate quotes the same tier the reservation will take", () => {
    const pages = { mode: "pages", pageUrls: "https://www.facebook.com/a\nhttps://www.facebook.com/b\nhttps://www.facebook.com/c", count: 30 }
    expect(CreditsService.estimateWorkflowBaseCredits([{ type: "meta-ads-scrape", data: pages }])).toBe(100) // 30 × 3 → 100
    expect(CreditsService.estimateWorkflowBaseCredits([{ type: "meta-ads-scrape", data: { mode: "search", query: "x" } }])).toBe(20)
    expect(CreditsService.estimateWorkflowBaseCredits([{ type: "meta-ads-scrape", data: {} }])).toBe(20)
  })

  it("every tier the builder can produce is priced on the backend at 1 credit per requested ad", () => {
    for (const tier of META_ADS_SCRAPE_TIERS) {
      expect(STATIC_CREDIT_COSTS[`meta-ads-scrape:${tier}`]).toBe(tier)
    }
    // Tiers above the per-source ceiling are reached through several sources.
    expect(STATIC_CREDIT_COSTS[buildMetaAdsScrapeCreditId({ count: 100, sources: 1 })]).toBe(100)
    expect(STATIC_CREDIT_COSTS[buildMetaAdsScrapeCreditId({ count: 100, sources: 2 })]).toBe(200)
    expect(STATIC_CREDIT_COSTS[buildMetaAdsScrapeCreditId({ count: 100, sources: 5 })]).toBe(500)
  })
})
