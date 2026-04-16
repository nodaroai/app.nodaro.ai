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
  it("content-crawler single page wraps in { pages: [...] }", () => {
    expect(extractActorOutput("content-crawler", [
      { url: "https://x.com/p1", markdown: "# Page 1", text: "fallback" },
    ])).toEqual({
      json: { pages: [{ url: "https://x.com/p1", markdown: "# Page 1" }] },
    })
  })

  it("content-crawler site mode preserves multiple pages", () => {
    expect(extractActorOutput("content-crawler", [
      { url: "u1", markdown: "m1" },
      { url: "u2", markdown: "m2" },
    ])).toEqual({
      json: { pages: [{ url: "u1", markdown: "m1" }, { url: "u2", markdown: "m2" }] },
    })
  })

  it("content-crawler falls back to text field when markdown absent", () => {
    expect(extractActorOutput("content-crawler", [
      { url: "u", text: "plaintext" },
    ])).toEqual({
      json: { pages: [{ url: "u", markdown: "plaintext" }] },
    })
  })

  it("google-search flattens organicResults into json array", () => {
    expect(extractActorOutput("google-search", [
      { organicResults: [{ title: "t1", url: "u1", description: "d1" }] },
    ])).toEqual({
      json: [{ title: "t1", url: "u1", description: "d1" }],
    })
  })

  it("google-search empty dataset returns empty array", () => {
    expect(extractActorOutput("google-search", [])).toEqual({ json: [] })
  })

  it("instagram projects posts into json array", () => {
    expect(extractActorOutput("instagram", [
      {
        url: "u", shortCode: "sc", caption: "c", displayUrl: "d", videoUrl: "v",
        timestamp: "t", likesCount: 10, commentsCount: 2, ownerUsername: "o", type: "Video",
      },
    ])).toEqual({
      json: [{
        url: "u", type: "Video", shortCode: "sc", caption: "c",
        displayUrl: "d", videoUrl: "v", timestamp: "t",
        likesCount: 10, commentsCount: 2, ownerUsername: "o",
      }],
    })
  })

  it("tiktok projects posts into json array", () => {
    expect(extractActorOutput("tiktok", [
      {
        id: "id1", webVideoUrl: "wv", videoUrl: "v", text: "t",
        createTime: 123, diggCount: 1, shareCount: 2, playCount: 3, commentCount: 4,
      },
    ])).toEqual({
      json: [{
        id: "id1", webVideoUrl: "wv", videoUrl: "v", text: "t",
        createTime: 123, diggCount: 1, shareCount: 2, playCount: 3,
        commentCount: 4, authorMeta: undefined, musicMeta: undefined,
      }],
    })
  })
})
