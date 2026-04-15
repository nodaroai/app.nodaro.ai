import { describe, it, expect } from "vitest"
import { ACTORS, buildActorInput, extractActorOutput } from "../actors.js"

describe("actor registry", () => {
  it("defines 4 actors with Apify ids", () => {
    expect(ACTORS["content-crawler"].apifyActorId).toBe("apify/website-content-crawler")
    expect(ACTORS["google-search"].apifyActorId).toBe("apify/google-search-scraper")
    expect(ACTORS["instagram"].apifyActorId).toBe("apify/instagram-scraper")
    expect(ACTORS["tiktok"].apifyActorId).toBe("clockworks/tiktok-scraper")
  })
})

describe("buildActorInput — content-crawler", () => {
  it("single-page mode caps to 1", () => {
    const input = buildActorInput({ actor: "content-crawler", url: "https://example.com", mode: "page" })
    expect(input).toMatchObject({
      startUrls: [{ url: "https://example.com" }],
      maxCrawlPages: 1,
      maxCrawlDepth: 0,
      saveMarkdown: true,
    })
  })

  it("site mode caps to 20", () => {
    const input = buildActorInput({ actor: "content-crawler", url: "https://example.com", mode: "site" })
    expect(input.maxCrawlPages).toBe(20)
    expect(input.maxCrawlDepth).toBe(3)
  })
})

describe("buildActorInput — google-search", () => {
  it("caps resultsPerPage at 10", () => {
    const input = buildActorInput({ actor: "google-search", query: "ai", maxResults: 50 })
    expect(input).toMatchObject({ queries: "ai", resultsPerPage: 10, maxPagesPerQuery: 1 })
  })

  it("defaults countryCode to us", () => {
    const input = buildActorInput({ actor: "google-search", query: "ai" })
    expect(input.countryCode).toBe("us")
  })
})

describe("buildActorInput — instagram", () => {
  it("caps resultsLimit at 20", () => {
    const input = buildActorInput({ actor: "instagram", target: "https://instagram.com/nasa", resultsLimit: 100 })
    expect(input).toMatchObject({
      directUrls: ["https://instagram.com/nasa"],
      resultsLimit: 20,
      resultsType: "posts",
    })
  })
})

describe("buildActorInput — tiktok", () => {
  it("defaults resultsPerPage to 10 when unset", () => {
    const input = buildActorInput({ actor: "tiktok", target: "https://tiktok.com/@nasa" })
    expect(input).toMatchObject({
      postURLs: ["https://tiktok.com/@nasa"],
      resultsPerPage: 10,
    })
  })

  it("caps resultsPerPage at 20", () => {
    const input = buildActorInput({ actor: "tiktok", target: "https://tiktok.com/@nasa", resultsLimit: 100 })
    expect(input.resultsPerPage).toBe(20)
  })
})

describe("extractActorOutput", () => {
  it("content-crawler joins items as markdown", () => {
    const out = extractActorOutput("content-crawler", [
      { url: "https://a.com", markdown: "# A" },
      { url: "https://b.com", markdown: "# B" },
    ])
    expect(out.text).toContain("# A")
    expect(out.text).toContain("# B")
    expect(out.imageUrl).toBeUndefined()
    expect(out.videoUrl).toBeUndefined()
  })

  it("google-search returns JSON of organicResults", () => {
    const out = extractActorOutput("google-search", [
      { organicResults: [{ title: "T", url: "u", description: "d" }] },
    ])
    const parsed = JSON.parse(out.text)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ title: "T", url: "u", description: "d" })
  })

  it("instagram picks first media url", () => {
    const out = extractActorOutput("instagram", [
      { displayUrl: "https://cdn.instagram/1.jpg", videoUrl: "https://cdn.instagram/1.mp4" },
      { displayUrl: "https://cdn.instagram/2.jpg" },
    ])
    expect(out.imageUrl).toBe("https://cdn.instagram/1.jpg")
    expect(out.videoUrl).toBe("https://cdn.instagram/1.mp4")
    expect(JSON.parse(out.text)).toHaveLength(2)
  })

  it("tiktok picks first videoUrl", () => {
    const out = extractActorOutput("tiktok", [
      { videoUrl: "https://cdn.tiktok/1.mp4" },
    ])
    expect(out.videoUrl).toBe("https://cdn.tiktok/1.mp4")
  })

  it("empty dataset returns empty-string text", () => {
    const out = extractActorOutput("google-search", [])
    expect(out.text).toBe("[]")
  })
})
