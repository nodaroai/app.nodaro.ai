import { describe, it, expect } from "vitest"
import { buildWebScrapeParams } from "../execute-node"
import type { WebScrapeNodeData } from "@/types/nodes"

function makeData(patch: Partial<WebScrapeNodeData>): WebScrapeNodeData {
  return { label: "Web Scrape", ...patch } as WebScrapeNodeData
}

/**
 * Regression coverage for the RSS-missing-url bug:
 * running the RSS actor used to produce `{ actor: "rss", workflowId }` on the
 * wire because the ternary-ladder that built params only wrote `url` for
 * content-crawler and `resultsLimit` for instagram/tiktok. The backend Zod
 * schema 400'd every time. These tests assert per-actor shape so new actors
 * can't silently regress the same way.
 */
describe("buildWebScrapeParams", () => {
  describe("rss", () => {
    it("includes url from data.url when set", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "rss", url: "https://feeds.example.com/rss.xml", resultsLimit: 25 }),
        undefined,
      )
      expect(params).toEqual({
        actor: "rss",
        url: "https://feeds.example.com/rss.xml",
        resultsLimit: 25,
      })
    })

    it("falls back to upstream text when data.url is empty", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "rss", url: "" }),
        "https://feeds.other.com/rss.xml",
      )
      expect(params.url).toBe("https://feeds.other.com/rss.xml")
    })

    it("passes resultsLimit through unchanged (including undefined for default)", () => {
      const undef = buildWebScrapeParams(makeData({ actor: "rss", url: "https://e.com" }), undefined)
      expect(undef.resultsLimit).toBeUndefined()

      const explicit = buildWebScrapeParams(
        makeData({ actor: "rss", url: "https://e.com", resultsLimit: 50 }),
        undefined,
      )
      expect(explicit.resultsLimit).toBe(50)
    })

    it("does NOT set query/target/mode/maxResults/countryCode for rss", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "rss", url: "https://e.com", resultsLimit: 10 }),
        "ignored",
      )
      expect("query" in params).toBe(false)
      expect("target" in params).toBe(false)
      expect("mode" in params).toBe(false)
      expect("maxResults" in params).toBe(false)
      expect("countryCode" in params).toBe(false)
    })
  })

  describe("content-crawler", () => {
    it("includes url + default mode=page", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "content-crawler", url: "https://example.com" }),
        undefined,
      )
      expect(params).toEqual({
        actor: "content-crawler",
        url: "https://example.com",
        mode: "page",
      })
    })

    it("honours explicit mode=site", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "content-crawler", url: "https://example.com", mode: "site" }),
        undefined,
      )
      expect(params.mode).toBe("site")
    })

    it("falls back to upstream when url is empty", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "content-crawler", url: "" }),
        "https://upstream.com",
      )
      expect(params.url).toBe("https://upstream.com")
    })
  })

  describe("google-search", () => {
    it("maps query/maxResults/countryCode; omits url/target/mode", () => {
      const params = buildWebScrapeParams(
        makeData({
          actor: "google-search",
          query: "ai news",
          maxResults: 8,
          countryCode: "us",
        }),
        undefined,
      )
      expect(params).toEqual({
        actor: "google-search",
        query: "ai news",
        maxResults: 8,
        countryCode: "us",
      })
    })

    it("falls back to upstream when query is empty", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "google-search" }),
        "trending topics",
      )
      expect(params.query).toBe("trending topics")
    })
  })

  describe("instagram / tiktok", () => {
    it("maps target + resultsLimit for instagram", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "instagram", target: "https://instagram.com/nasa", resultsLimit: 15 }),
        undefined,
      )
      expect(params).toEqual({
        actor: "instagram",
        target: "https://instagram.com/nasa",
        resultsLimit: 15,
      })
    })

    it("maps target + resultsLimit for tiktok", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "tiktok", target: "https://tiktok.com/@user", resultsLimit: 5 }),
        undefined,
      )
      expect(params).toEqual({
        actor: "tiktok",
        target: "https://tiktok.com/@user",
        resultsLimit: 5,
      })
    })

    it("falls back to upstream when target is empty", () => {
      const params = buildWebScrapeParams(
        makeData({ actor: "instagram" }),
        "https://instagram.com/upstream",
      )
      expect(params.target).toBe("https://instagram.com/upstream")
    })
  })

  it("defaults to google-search when actor is missing", () => {
    const params = buildWebScrapeParams(makeData({ query: "fallback" }), undefined)
    expect(params.actor).toBe("google-search")
    expect(params.query).toBe("fallback")
  })
})
