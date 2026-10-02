import { describe, expect, it } from "vitest"
import {
  SOCIAL_PLATFORMS,
  SOCIAL_SEARCH_CREDIT_COSTS,
  SOCIAL_SEARCH_CREDITS_PER_PAGE,
  SOCIAL_SEARCH_PLATFORM_MODES,
  isSocialPost,
  isSocialSearchPickFrozen,
  pickSocialPosts,
  socialPostsDigest,
  socialPostsFrom,
  socialSearchCreditId,
  socialSearchCreditIdFromNode,
  socialSearchMode,
  socialSearchPickTop,
  socialSearchRequestFromNode,
  socialSearchMaxCount,
  socialSearchCountry,
  socialSearchRegion,
  type SocialPost,
} from "../social-search.js"

function post(id: string, over: Partial<SocialPost> = {}): SocialPost {
  return {
    id: `tiktok:${id}`,
    platform: "tiktok",
    url: `https://www.tiktok.com/@maker/video/${id}`,
    text: `post ${id}`,
    author: { handle: "maker", name: "Maker" },
    metrics: {},
    media: { kind: "video" },
    hashtags: [],
    extra: {},
    ...over,
  }
}

describe("the request a node sends", () => {
  it("fills the defaults and keeps only the options that apply to the platform", () => {
    expect(socialSearchRequestFromNode({ platform: "tiktok", query: " ai ads ", region: "us", country: "DE" })).toEqual({
      platform: "tiktok", mode: "keyword", query: "ai ads", count: 20, period: "month", sort: "relevance", region: "US",
    })
    expect(socialSearchRequestFromNode({ platform: "meta_ads", query: "q" })).toMatchObject({ country: "ALL", activeOnly: true })
    expect(socialSearchRequestFromNode({ platform: "meta_ads", query: "q", country: "usa" })).toMatchObject({ country: "ALL" })
    expect(socialSearchRequestFromNode({ platform: "tiktok", query: "q", region: "USA" })).not.toHaveProperty("region")
    expect(socialSearchRequestFromNode({ platform: "youtube", query: "q", videoKind: "shorts" })).toMatchObject({ videoKind: "shorts" })
    expect(socialSearchRequestFromNode({ platform: "reddit", query: "q", subreddit: "videography" })).toMatchObject({ subreddit: "videography" })
  })

  it("prefers the wired text over the node's own query", () => {
    expect(socialSearchRequestFromNode({ platform: "x", query: "typed" }, "  from the wire ").query).toBe("from the wire")
    expect(socialSearchRequestFromNode({ platform: "x", query: "typed" }, "   ").query).toBe("typed")
  })

  it("repairs a mode the platform does not have (switched from Reddit to TikTok)", () => {
    expect(socialSearchMode("tiktok", "community")).toBe("keyword")
    expect(socialSearchMode("reddit", "community")).toBe("community")
    expect(socialSearchRequestFromNode({ platform: "unknown", mode: "account", query: "q" })).toMatchObject({ platform: "tiktok", mode: "account" })
  })

  it("every platform searches by keyword", () => {
    for (const platform of SOCIAL_PLATFORMS) expect(SOCIAL_SEARCH_PLATFORM_MODES[platform][0]).toBe("keyword")
  })
})

describe("results per search", () => {
  it("caps a search that returns one page at 20, and bills it as one page", () => {
    expect(socialSearchMaxCount("tiktok", "keyword")).toBe(60)
    expect(socialSearchMaxCount("tiktok", "account")).toBe(20)
    expect(socialSearchMaxCount("youtube", "keyword")).toBe(20)
    expect(socialSearchMaxCount("reddit", "keyword")).toBe(20)
    expect(socialSearchMaxCount("reddit", "community")).toBe(60)
    expect(socialSearchRequestFromNode({ platform: "youtube", query: "q", count: 60 }).count).toBe(20)
    expect(socialSearchRequestFromNode({ platform: "x", mode: "account", query: "q", count: 60 }).count).toBe(60)
    expect(socialSearchCreditIdFromNode({ platform: "linkedin", mode: "account", count: 60 })).toBe("social-search:1")
    expect(socialSearchCreditIdFromNode({ platform: "meta_ads", mode: "account", count: 60 })).toBe("social-search:3")
  })

  it("reads a region and a country only in their real forms", () => {
    expect(socialSearchRegion(" gb ")).toBe("GB")
    expect(socialSearchRegion("GBR")).toBeUndefined()
    expect(socialSearchCountry("all")).toBe("ALL")
    expect(socialSearchCountry("de")).toBe("DE")
    expect(socialSearchCountry(undefined)).toBe("ALL")
  })
})

describe("pricing", () => {
  it("prices by pages of results; every reservable id has a price", () => {
    expect(socialSearchCreditId(20)).toBe("social-search:1")
    expect(socialSearchCreditIdFromNode({ platform: "tiktok", count: 60 })).toBe("social-search:3")
    expect(socialSearchCreditIdFromNode({ count: 33 })).toBe("social-search:1")
    expect(SOCIAL_SEARCH_CREDIT_COSTS).toEqual({
      "social-search": SOCIAL_SEARCH_CREDITS_PER_PAGE,
      "social-search:1": SOCIAL_SEARCH_CREDITS_PER_PAGE,
      "social-search:2": SOCIAL_SEARCH_CREDITS_PER_PAGE * 2,
      "social-search:3": SOCIAL_SEARCH_CREDITS_PER_PAGE * 3,
    })
  })
})

describe("which posts a run passes on", () => {
  const results = ["1", "2", "3", "4", "5", "6"].map((id) => post(id))

  it("passes on the picks, in picking order", () => {
    expect(pickSocialPosts(results, ["tiktok:4", "tiktok:2"], 5).map((p) => p.id)).toEqual(["tiktok:4", "tiktok:2"])
  })

  it("falls back to the first few when no pick is among the results (a fresh search)", () => {
    expect(pickSocialPosts(results, ["tiktok:99"], 2).map((p) => p.id)).toEqual(["tiktok:1", "tiktok:2"])
    expect(pickSocialPosts(results, undefined, undefined)).toHaveLength(5)
    expect(socialSearchPickTop(0)).toBe(1)
    expect(socialSearchPickTop(500)).toBe(60)
  })

  it("keeps picks frozen only when the author asked to and there are picks", () => {
    expect(isSocialSearchPickFrozen("social-search", { keepPicks: true, generatedJson: [post("1")] })).toBe(true)
    expect(isSocialSearchPickFrozen("social-search", { keepPicks: true, generatedJson: [] })).toBe(false)
    expect(isSocialSearchPickFrozen("social-search", { keepPicks: false, generatedJson: [post("1")] })).toBe(false)
    expect(isSocialSearchPickFrozen("web-scrape", { keepPicks: true, generatedJson: [post("1")] })).toBe(false)
  })
})

describe("reading posts back", () => {
  it("keeps only well-formed posts", () => {
    expect(isSocialPost(post("1"))).toBe(true)
    expect(isSocialPost({ ...post("1"), platform: "myspace" })).toBe(false)
    expect(isSocialPost({ ...post("1"), metrics: undefined })).toBe(false)
    expect(isSocialPost({ ...post("1"), text: 7 })).toBe(false)
    expect(isSocialPost({ ...post("1"), hashtags: "x" })).toBe(false)
    expect(socialPostsFrom([post("1"), null, "x", { id: "y" }])).toHaveLength(1)
    expect(socialPostsFrom("not a list")).toEqual([])
  })

  it("writes a readable digest", () => {
    const text = socialPostsDigest([
      post("1", { publishedAt: "2026-09-30T10:00:00Z", metrics: { views: 1200 }, text: "Hello   world" }),
      post("2", { author: { handle: "", name: "" }, container: "r/aivideo", metrics: { score: 40 }, title: "A thread" }),
    ])
    expect(text).toBe(
      "1. @maker · 2026-09-30 · 1200 views\n   Hello world\n   https://www.tiktok.com/@maker/video/1\n\n" +
      "2. r/aivideo · 40 points\n   A thread\n   https://www.tiktok.com/@maker/video/2",
    )
  })
})
