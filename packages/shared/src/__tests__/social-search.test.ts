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
  socialSearchPostLink,
  socialSearchPostVideo,
  signedLinkExpiresAt,
  socialPostsLongestVideoSec,
  SOCIAL_POST_VIDEO_LINK_MARGIN_MS,
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

describe("socialSearchPostLink", () => {
  const post = (url: unknown) => ({ id: "reddit:1", platform: "reddit", url, text: "", author: { handle: "a", name: "A" } })

  it("reads one post (an Each wire) and the first of a list (any other wire)", () => {
    expect(socialSearchPostLink(JSON.stringify(post("https://www.reddit.com/r/x/comments/1/")))).toBe("https://www.reddit.com/r/x/comments/1/")
    expect(socialSearchPostLink(JSON.stringify([post("https://www.tiktok.com/@a/video/1"), post("https://www.tiktok.com/@a/video/2")]))).toBe("https://www.tiktok.com/@a/video/1")
  })

  it("reads no link from a digest, an empty list, or a post without an http(s) link", () => {
    expect(socialSearchPostLink("1. @a: something https://x.com/a/status/1")).toBeUndefined()
    expect(socialSearchPostLink("[]")).toBeUndefined()
    expect(socialSearchPostLink(JSON.stringify(post("javascript:alert(1)")))).toBeUndefined()
    expect(socialSearchPostLink(JSON.stringify(post(7)))).toBeUndefined()
  })
})

describe("the video a post hands Video Analysis", () => {
  const NOW = Date.parse("2026-10-04T00:00:00Z")
  const hexSeconds = (ms: number) => Math.floor(ms / 1000).toString(16).toUpperCase()
  const igFile = (endMs: number) => `https://scontent-sjc6-1.cdninstagram.com/o1/v/t2/f2/m86/clip.mp4?_nc_cat=1&oh=00_sig&oe=${hexSeconds(endMs)}`
  const reel = (videoUrl?: string, durationSec?: number) =>
    post("1", { id: "instagram:1", platform: "instagram", url: "https://www.instagram.com/reel/Dav1/", media: { kind: "video", videoUrl, durationSec } })

  it("reads the post's own video file while its signed link is valid", () => {
    const file = igFile(NOW + 2 * 24 * 3_600_000)
    expect(socialSearchPostVideo(JSON.stringify(reel(file, 27)), NOW)).toEqual({ kind: "file", url: file })
    // The first post of a list (a wire that is not in Each mode).
    expect(socialSearchPostVideo(JSON.stringify([reel(file), post("2")]), NOW)).toEqual({ kind: "file", url: file })
  })

  it("reports an expired file (or one about to expire) instead of reading the post's page", () => {
    expect(socialSearchPostVideo(JSON.stringify(reel(igFile(NOW - 60_000))), NOW)).toEqual({ kind: "expired" })
    expect(socialSearchPostVideo(JSON.stringify(reel(igFile(NOW + SOCIAL_POST_VIDEO_LINK_MARGIN_MS - 60_000))), NOW)).toEqual({ kind: "expired" })
  })

  it("falls back to the post's page when no file came with it", () => {
    expect(socialSearchPostVideo(JSON.stringify(post("7")), NOW)).toEqual({ kind: "page", url: "https://www.tiktok.com/@maker/video/7" })
  })

  it("reads nothing from a digest, an empty list, or something that is not a post", () => {
    expect(socialSearchPostVideo("1. @a: something https://x.com/a/status/1", NOW)).toBeUndefined()
    expect(socialSearchPostVideo("[]", NOW)).toBeUndefined()
    expect(socialSearchPostVideo(JSON.stringify({ url: "https://www.tiktok.com/@a/video/1" }), NOW)).toBeUndefined()
    expect(socialSearchPostVideo(JSON.stringify(post("1", { url: "javascript:alert(1)" })), NOW)).toBeUndefined()
  })

  it("reads each platform's link end, and none from a link that does not expire", () => {
    expect(signedLinkExpiresAt("https://scontent.cdninstagram.com/v.mp4?oe=6AC3520E")).toBe(0x6ac3520e * 1000)
    expect(signedLinkExpiresAt("https://v16-webapp.tiktok.com/v.mp4?x-expires=1791100000&x-signature=s")).toBe(1_791_100_000_000)
    expect(signedLinkExpiresAt("https://d1.cloudfront.net/v.mp4?Expires=1791100000&Signature=s")).toBe(1_791_100_000_000)
    expect(signedLinkExpiresAt("https://dms.licdn.com/playlist/vid/v.mp4?e=1791100000&v=beta&t=s")).toBe(1_791_100_000_000)
    // `e` means an end only on LinkedIn's media host.
    expect(signedLinkExpiresAt("https://cdn.example.com/v.mp4?e=1791100000")).toBeUndefined()
    expect(signedLinkExpiresAt("https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/a.mp4?tag=12")).toBeUndefined()
    expect(signedLinkExpiresAt("not a link")).toBeUndefined()
  })
})

describe("the length Video Analysis quotes for the posts", () => {
  const clip = (id: string, durationSec?: number) => post(id, { media: { kind: "video", durationSec } })

  it("is the longest video's", () => {
    expect(socialPostsLongestVideoSec([clip("1", 27), clip("2", 90), clip("3", 24)])).toBe(90)
  })

  it("leaves out posts without a video, and is unknown when a video's length is", () => {
    expect(socialPostsLongestVideoSec([clip("1", 27), post("2", { media: { kind: "image" } })])).toBe(27)
    expect(socialPostsLongestVideoSec([clip("1", 27), clip("2")])).toBeUndefined()
    expect(socialPostsLongestVideoSec([post("2", { media: { kind: "text" } })])).toBeUndefined()
    expect(socialPostsLongestVideoSec([])).toBeUndefined()
  })
})
