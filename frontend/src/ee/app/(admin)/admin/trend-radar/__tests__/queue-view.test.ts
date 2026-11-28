/**
 * The queue's filters and sort, and the post helpers: the address round-trips
 * the filters (and ignores what it cannot read), a card read before platforms
 * were kept still filters by its top post's platform, unknown values sort
 * last, and a post's player and still links are built only from the
 * platform's own known shapes.
 */
import { describe, expect, it } from "vitest"
import type { TrendCandidateCard, TrendCandidatePost } from "@nodaro/sdk/trend-radar"
import { playerUrl, stillCandidates } from "../post-media"
import {
  DEFAULT_FILTERS,
  cardCreators,
  cardPlatforms,
  cardPlays,
  cardPost,
  filterCards,
  formatAge,
  formatCreators,
  readFilters,
  sortCards,
  trendAgeDays,
  writeFilters,
} from "../queue-view"

const post = (over: Partial<TrendCandidatePost> = {}): TrendCandidatePost => ({
  platform: "tiktok",
  url: "https://www.tiktok.com/@a/video/123456789",
  author: "a",
  postedAt: "2026-11-20T00:00:00Z",
  plays: 1000,
  likes: null,
  soundName: null,
  stillUrl: null,
  embedUrl: null,
  durationSec: 10,
  ...over,
})

const card = (over: Partial<TrendCandidateCard> = {}): TrendCandidateCard => ({
  id: "c1",
  name: "Paws at you",
  slug: "paws-at-you",
  status: "candidate",
  label: "new",
  soundName: null,
  durationSec: 15,
  creators: 20,
  creatorsCapped: false,
  plays: 4_600_000,
  dayChangePct: null,
  firstSeen: { kind: "template-site", name: "Site A", url: null, firstSeenAt: "2026-11-24T06:00:00Z" },
  topPost: null,
  platforms: {},
  firstPostedAt: null,
  lastReadAt: null,
  passedAt: null,
  trendId: null,
  createdAt: "2026-11-24T06:00:00Z",
  updatedAt: "2026-11-24T06:00:00Z",
  ...over,
})

const NOW = new Date("2026-11-26T12:00:00Z")

describe("the filters in the address", () => {
  it("round-trip, and the default writes nothing", () => {
    expect(writeFilters(DEFAULT_FILTERS).toString()).toBe("")
    const f = { ...DEFAULT_FILTERS, view: "table" as const, status: "watching" as const, platform: "instagram" as const, source: "Site A", minPlays: 1_000_000, minCreators: 10, maxAgeDays: 7, q: "paws", sort: "growth" as const }
    expect(readFilters(writeFilters(f))).toEqual(f)
  })

  it("fall back to the default for what they cannot read", () => {
    expect(readFilters(new URLSearchParams("view=wall&platform=x&views=-5&people=many&age=0&sort=random&status=gone"))).toEqual(DEFAULT_FILTERS)
  })
})

describe("a card's platforms, post and views", () => {
  it("come from the per-platform stats when the run kept them", () => {
    const ig = post({ platform: "instagram", url: "https://www.instagram.com/reel/abc/" })
    const c = card({
      topPost: post(),
      platforms: {
        tiktok: { posts: 40, creators: 30, plays: 4_000_000, capped: false, top: post() },
        instagram: { posts: 10, creators: 9, plays: 600_000, capped: false, top: ig },
      },
    })
    expect(cardPlatforms(c)).toEqual(["tiktok", "instagram"])
    expect(cardPost(c, "instagram")).toBe(ig)
    expect(cardPlays(c, "instagram")).toBe(600_000)
    expect(cardPlays(c, "all")).toBe(4_600_000)
  })

  it("fall back to the top post on a card read before platforms were kept", () => {
    const c = card({ topPost: post() })
    expect(cardPlatforms(c)).toEqual(["tiktok"])
    expect(cardPlays(c, "tiktok")).toBe(4_600_000)
    expect(cardPlays(c, "youtube")).toBe(0)
    expect(cardPost(c, "youtube")).toBeNull()
  })
})

describe("filtering and sorting", () => {
  const a = card({ id: "a", name: "Alpha", plays: 9_000_000, dayChangePct: 2, firstPostedAt: "2026-11-01T00:00:00Z", topPost: post() })
  const b = card({ id: "b", name: "Beta", creators: 4, plays: 200_000, dayChangePct: 40, firstPostedAt: "2026-11-24T00:00:00Z", topPost: post({ platform: "youtube" }), firstSeen: { kind: "template-site", name: "Site B", url: null, firstSeenAt: "2026-11-25T06:00:00Z" } })
  const c = card({ id: "c", name: "Gamma", creators: 8, plays: 50_000, dayChangePct: null, topPost: null })

  it("keeps the cards each filter allows", () => {
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) => filterCards([a, b, c], { ...DEFAULT_FILTERS, ...f }, NOW).map((x) => x.id)
    expect(ids({})).toEqual(["a", "b", "c"])
    expect(ids({ platform: "youtube" })).toEqual(["b"])
    expect(ids({ minPlays: 1_000_000 })).toEqual(["a"])
    expect(ids({ maxAgeDays: 7 })).toEqual(["b"])
    expect(ids({ source: "Site B" })).toEqual(["b"])
    expect(ids({ q: "GAM" })).toEqual(["c"])
    expect(ids({ minCreators: 10 })).toEqual(["a"])
  })

  it("counts the chosen platform's people alone, and sorts by people by default", () => {
    const split = card({ id: "s", creators: 30, platforms: { tiktok: { posts: 20, creators: 25, plays: 1, capped: true, top: post() }, instagram: { posts: 5, creators: 5, plays: 1, capped: false, top: post({ platform: "instagram" }) } } })
    expect(cardCreators(split, "all")).toEqual({ creators: 30, creatorsCapped: false })
    expect(cardCreators(split, "tiktok")).toEqual({ creators: 25, creatorsCapped: true })
    expect(cardCreators(split, "youtube")).toEqual({ creators: 0, creatorsCapped: false })
    // Read before platforms were kept: every post was on the top post's platform.
    expect(cardCreators(b, "youtube").creators).toBe(b.creators)
    expect(DEFAULT_FILTERS.sort).toBe("creators")
    const many = card({ id: "many", creators: 40, plays: 1_000 })
    const big = card({ id: "big", creators: 2, plays: 200_000_000 })
    expect(sortCards([big, many], DEFAULT_FILTERS.sort, "all").map((x) => x.id)).toEqual(["many", "big"])
    // Equal people: the one with more views first.
    const quiet = card({ id: "quiet", creators: 40, plays: 500 })
    const loud = card({ id: "loud", creators: 40, plays: 9_000_000 })
    expect(sortCards([quiet, many, loud], "creators", "all").map((x) => x.id)).toEqual(["loud", "many", "quiet"])
  })

  it("sorts larger first and puts unknown values last", () => {
    expect(sortCards([c, b, a], "plays", "all").map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(sortCards([c, a, b], "growth", "all").map((x) => x.id)).toEqual(["b", "a", "c"])
    expect(sortCards([a, c, b], "newest", "all").map((x) => x.id)).toEqual(["b", "a", "c"])
  })
})

describe("what a card says", () => {
  it("marks capped creators and reads the trend's age", () => {
    expect(formatCreators({ creators: 60, creatorsCapped: true })).toBe("60+")
    expect(formatCreators({ creators: 12, creatorsCapped: false })).toBe("12")
    expect(trendAgeDays(card({ firstPostedAt: "2026-11-19T12:00:00Z" }), NOW)).toBe(7)
    expect(trendAgeDays(card(), NOW)).toBeNull()
    expect([formatAge(null), formatAge(3), formatAge(21), formatAge(90)]).toEqual(["—", "3d", "3w", "3mo"])
  })
})

describe("a post's player and still", () => {
  it("plays TikTok and YouTube on their own and leaves other players as they are", () => {
    expect(playerUrl(post({ embedUrl: "https://www.tiktok.com/embed/v2/123456789" }))).toBe("https://www.tiktok.com/player/v1/123456789?autoplay=1&loop=1&rel=0&description=1&music_info=1")
    expect(playerUrl(post({ platform: "youtube", embedUrl: "https://www.youtube.com/embed/abcDEF12345" }))).toBe(
      "https://www.youtube.com/embed/abcDEF12345?autoplay=1&loop=1&playlist=abcDEF12345&rel=0&playsinline=1",
    )
    expect(playerUrl(post({ platform: "instagram", embedUrl: "https://www.instagram.com/reel/abc/embed" }))).toBe("https://www.instagram.com/reel/abc/embed")
    expect(playerUrl(post())).toBeNull()
  })

  it("tries the platform's still first, then YouTube's lasting one, and never a non-https link", () => {
    expect(stillCandidates(post({ platform: "youtube", stillUrl: "https://cdn.test/s.jpg", embedUrl: "https://www.youtube.com/embed/abcDEF12345" }))).toEqual([
      "https://cdn.test/s.jpg",
      "https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg",
    ])
    expect(stillCandidates(post({ stillUrl: "javascript:alert(1)" }))).toEqual([])
    expect(stillCandidates(null)).toEqual([])
  })
})
