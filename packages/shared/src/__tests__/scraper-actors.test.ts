import { describe, it, expect } from "vitest"
import {
  SCRAPER_ACTOR_IDS,
  SCRAPER_ACTOR_LABELS,
  SCRAPER_CREDIT_COSTS,
  buildScraperCreditId,
  isScraperActor,
  resolveScraperCreditId,
} from "../scraper-actors.js"

describe("scraper-actors", () => {
  it("exposes 5 curated actor ids", () => {
    expect(SCRAPER_ACTOR_IDS).toEqual(["content-crawler", "google-search", "instagram", "tiktok", "rss"])
  })

  it("returns flat credit id for google-search", () => {
    expect(buildScraperCreditId({ actor: "google-search" })).toBe("web-scrape:google-search")
  })

  it("splits content-crawler by mode", () => {
    expect(buildScraperCreditId({ actor: "content-crawler", mode: "page" })).toBe("web-scrape:content-crawler")
    expect(buildScraperCreditId({ actor: "content-crawler", mode: "site" })).toBe("web-scrape:content-crawler:site")
  })

  it("defaults content-crawler to page mode when mode missing", () => {
    expect(buildScraperCreditId({ actor: "content-crawler" })).toBe("web-scrape:content-crawler")
  })

  it("isScraperActor validates values", () => {
    expect(isScraperActor("instagram")).toBe(true)
    expect(isScraperActor("bogus")).toBe(false)
  })

  describe("resolveScraperCreditId", () => {
    it("reads actor + mode from raw body", () => {
      expect(resolveScraperCreditId({ actor: "content-crawler", mode: "site" })).toBe("web-scrape:content-crawler:site")
      expect(resolveScraperCreditId({ actor: "instagram" })).toBe("web-scrape:instagram")
    })

    it("falls back to cheapest SKU for missing or invalid actor", () => {
      expect(resolveScraperCreditId({})).toBe("web-scrape:google-search")
      expect(resolveScraperCreditId({ actor: "bogus" })).toBe("web-scrape:google-search")
      expect(resolveScraperCreditId(undefined)).toBe("web-scrape:google-search")
      expect(resolveScraperCreditId(null)).toBe("web-scrape:google-search")
    })

    it("treats non-site mode values as page for content-crawler", () => {
      expect(resolveScraperCreditId({ actor: "content-crawler", mode: "weird" })).toBe("web-scrape:content-crawler")
      expect(resolveScraperCreditId({ actor: "content-crawler" })).toBe("web-scrape:content-crawler")
    })
  })

  it("labels cover every actor id", () => {
    for (const id of SCRAPER_ACTOR_IDS) {
      expect(SCRAPER_ACTOR_LABELS[id]).toBeTruthy()
    }
  })

  it("credit costs include bare fallback + every composite SKU", () => {
    expect(SCRAPER_CREDIT_COSTS["web-scrape"]).toBe(2)
    expect(SCRAPER_CREDIT_COSTS["web-scrape:google-search"]).toBe(3)
    expect(SCRAPER_CREDIT_COSTS["web-scrape:content-crawler"]).toBe(1)
    expect(SCRAPER_CREDIT_COSTS["web-scrape:content-crawler:site"]).toBe(5)
    expect(SCRAPER_CREDIT_COSTS["web-scrape:instagram"]).toBe(1)
    expect(SCRAPER_CREDIT_COSTS["web-scrape:tiktok"]).toBe(1)
  })
})
