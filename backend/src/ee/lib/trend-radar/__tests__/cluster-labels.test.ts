import { describe, expect, it } from "vitest"
import type { SocialPost } from "@nodaro/shared/social"
import { clusterPosts, panelGrowthPct, toCandidatePost } from "../cluster.js"
import { dayChangePct, labelOf, passesNow, statusOf } from "../labels.js"
import { DEFAULT_THRESHOLDS, type TrendCandidateReading } from "../types.js"

function post(over: Partial<SocialPost> & { handle: string; views?: number; likes?: number; sound?: string; platform?: SocialPost["platform"]; url?: string }): SocialPost {
  const { handle, views, likes, sound, platform, url, ...rest } = over
  return {
    id: `${platform ?? "tiktok"}:${handle}:${url ?? ""}`,
    platform: platform ?? "tiktok",
    url: url ?? `https://www.tiktok.com/@${handle}/video/7300000000000000001`,
    text: "phone on the train ai",
    author: { handle, name: handle },
    metrics: { ...(views !== undefined ? { views } : {}), ...(likes !== undefined ? { likes } : {}) },
    media: { kind: "video", durationSec: 10, thumbnailUrl: "https://cdn.test/still.jpg" },
    hashtags: [],
    extra: sound ? { sound } : {},
    ...rest,
  }
}

describe("clusterPosts", () => {
  it("counts a creator once, sums plays, picks the shared sound and the median length", () => {
    const c = clusterPosts([
      post({ handle: "a", views: 100, sound: "subway remix" }),
      post({ handle: "A", views: 50, sound: "subway remix", url: "https://www.tiktok.com/@a/video/7300000000000000002" }),
      post({ handle: "b", views: 200, sound: "subway remix", media: { kind: "video", durationSec: 14 } }),
      post({ handle: "c", views: 10, sound: "other", media: { kind: "video", durationSec: 9 } }),
    ])
    expect(c.creators).toBe(3)
    expect(c.plays).toBe(360)
    expect(c.posts).toBe(4)
    expect(c.soundName).toBe("subway remix")
    expect(c.durationSec).toBe(10)
    expect(c.top.map((p) => p.author)).toEqual(["b", "a", "A", "c"])
  })

  it("reads likes where views are hidden, and skips a platform that is not video", () => {
    const c = clusterPosts([
      post({ handle: "ig", platform: "instagram", url: "https://www.instagram.com/reel/Cabc123/", likes: 7000 }),
      post({ handle: "x", platform: "x", url: "https://x.com/x/status/1", views: 99 }),
    ])
    expect(c.creators).toBe(1)
    expect(c.plays).toBe(7000)
    expect(c.posts).toBe(1)
  })

  it("keeps only the top N posts by plays", () => {
    const many = Array.from({ length: 8 }, (_, i) => post({ handle: `u${i}`, views: i, url: `https://www.tiktok.com/@u${i}/video/730000000000000000${i}` }))
    expect(clusterPosts(many, 3).top.map((p) => p.author)).toEqual(["u7", "u6", "u5"])
  })

  it("splits the posts by platform, counts the same handle on two platforms twice, and keeps each platform's top post", () => {
    const tiktok = Array.from({ length: 9 }, (_, i) => post({ handle: `t${i}`, views: 1000 + i, url: `https://www.tiktok.com/@t${i}/video/730000000000000001${i}` }))
    const c = clusterPosts([
      ...tiktok,
      post({ handle: "t0", platform: "instagram", url: "https://www.instagram.com/reel/Cig1/", likes: 40 }),
      post({ handle: "ig2", platform: "instagram", url: "https://www.instagram.com/reel/Cig2/", likes: 30 }),
      post({ handle: "yt", platform: "youtube", url: "https://www.youtube.com/shorts/yt_1", views: 5 }),
    ])
    expect(c.creators).toBe(12)
    expect(c.platforms.tiktok).toEqual({ posts: 9, creators: 9, plays: 9036, top: expect.objectContaining({ author: "t8" }) })
    expect(c.platforms.instagram).toEqual({ posts: 2, creators: 2, plays: 70, top: expect.objectContaining({ author: "t0", platform: "instagram" }) })
    expect(c.platforms.youtube?.top?.embedUrl).toBe("https://www.youtube.com/embed/yt_1")
    // Up to eight, every platform's best among them, most-played first.
    expect(c.top).toHaveLength(8)
    expect(c.top.map((p) => p.platform)).toEqual(["tiktok", "tiktok", "tiktok", "tiktok", "tiktok", "tiktok", "instagram", "youtube"])
    expect(c.top[0]!.author).toBe("t8")
  })

  it("remembers every post's plays by its id, and the earliest post date", () => {
    const c = clusterPosts([
      post({ handle: "a", views: 100, publishedAt: "2026-10-20T10:00:00Z" }),
      post({ handle: "b", views: 50, publishedAt: "2026-10-18T08:00:00Z", url: "https://www.tiktok.com/@b/video/7300000000000000009" }),
      post({ handle: "c", platform: "instagram", url: "https://www.instagram.com/reel/Cx/", likes: 7, publishedAt: "not a date" }),
    ])
    expect(c.panel).toEqual({
      "tiktok:a:": 100,
      "tiktok:b:https://www.tiktok.com/@b/video/7300000000000000009": 50,
      "instagram:c:https://www.instagram.com/reel/Cx/": 7,
    })
    expect(c.firstPostedAt).toBe("2026-10-18T08:00:00.000Z")
    expect(clusterPosts([post({ handle: "a", views: 1 })]).firstPostedAt).toBeNull()
  })
})

describe("panelGrowthPct", () => {
  it("is the growth of the posts both readings saw, per day, one decimal", () => {
    // A new post (c) and a post that dropped out (b) are left out of both sides.
    expect(panelGrowthPct({ a: 1000, b: 9_000_000 }, { a: 1100, c: 5_000_000 }, 1)).toBe(10)
    // Two days apart: compounded per day, 21% over two days is 10% a day.
    expect(panelGrowthPct({ a: 1000 }, { a: 1210 }, 2)).toBe(10)
    expect(panelGrowthPct({ a: 1000, b: 1000 }, { a: 1000, b: 1006 }, 1)).toBe(0.3)
    expect(panelGrowthPct({ a: 1000 }, { a: 1000 }, 1)).toBe(0)
  })

  it("is null with no previous panel, no post seen twice, or nothing to grow from", () => {
    expect(panelGrowthPct(null, { a: 1 }, 1)).toBeNull()
    expect(panelGrowthPct(undefined, { a: 1 }, 1)).toBeNull()
    expect(panelGrowthPct({ b: 10 }, { a: 1 }, 1)).toBeNull()
    expect(panelGrowthPct({ a: 0 }, { a: 50 }, 1)).toBeNull()
  })

  it("counts a same-day gap as one day", () => {
    expect(panelGrowthPct({ a: 100 }, { a: 110 }, 0)).toBe(10)
  })
})

describe("toCandidatePost", () => {
  it("carries the link, counts, still and the platform's player, never the media file", () => {
    const p = toCandidatePost(post({ handle: "a", views: 5, likes: 2, sound: "s", publishedAt: "2026-10-30T00:00:00Z" }))
    expect(p).toEqual({
      platform: "tiktok",
      url: "https://www.tiktok.com/@a/video/7300000000000000001",
      author: "a",
      postedAt: "2026-10-30T00:00:00Z",
      plays: 5,
      likes: 2,
      soundName: "s",
      stillUrl: "https://cdn.test/still.jpg",
      embedUrl: "https://www.tiktok.com/embed/v2/7300000000000000001",
      durationSec: 10,
    })
    expect(toCandidatePost(post({ handle: "y", platform: "youtube", url: "https://www.youtube.com/shorts/abc_123" }))?.embedUrl).toBe("https://www.youtube.com/embed/abc_123")
    expect(toCandidatePost(post({ handle: "i", platform: "instagram", url: "https://www.instagram.com/reel/Cabc123/" }))?.embedUrl).toBe("https://www.instagram.com/reel/Cabc123/embed")
  })
})

const r = (creators: number, plays: number, i: number, growthPct: number | null = null): TrendCandidateReading => ({ date: `2026-10-${String(10 + i).padStart(2, "0")}`, creators, plays, posts: 20, growthPct })

describe("labels", () => {
  it("dayChangePct is the growth from the previous reading, one decimal", () => {
    expect(dayChangePct([r(1, 100, 0)])).toBeNull()
    expect(dayChangePct([r(1, 100, 0), r(2, 118, 1)])).toBe(18)
    expect(dayChangePct([r(1, 0, 0), r(2, 118, 1)])).toBeNull()
    expect(dayChangePct([r(1, 1000, 0), r(2, 1006, 1)])).toBe(0.6)
  })

  it("dayChangePct prefers the reading's growth over the same posts to the summed change", () => {
    // Summed plays halved (the search answered other posts) while the same posts grew 4%.
    expect(dayChangePct([r(20, 2_000_000, 0), r(20, 1_000_000, 1, 4)])).toBe(4)
    expect(dayChangePct([r(20, 2_000_000, 0), r(20, 1_000_000, 1, 0)])).toBe(0)
    // A reading without it falls back to the summed change.
    expect(dayChangePct([r(20, 100, 0, 7), r(20, 150, 1, null)])).toBe(50)
  })

  it("labels read the growth over the same posts, for the latest reading and the one before", () => {
    const t = DEFAULT_THRESHOLDS
    // The summed plays fall 50% (a noisy search) but the same posts grow 20% a day: rising, not slowing.
    expect(labelOf([r(3, 2000, 0), r(4, 1000, 1, 20)], t)).toBe("rising")
    // Two readings running under the slowing change, by growth: slowing.
    expect(labelOf([r(9, 100, 0), r(9, 500, 1, 0.5), r(9, 900, 2, 0.2)], t)).toBe("slowing")
    expect(statusOf("candidate", [r(9, 100, 0), r(9, 500, 1, 0.5), r(9, 900, 2, 0.2)], t)).toBe("slowing")
  })

  it("labels: new, rising, hot, slowing, watching", () => {
    const t = DEFAULT_THRESHOLDS
    expect(labelOf([r(2, 100, 0)], t)).toBe("new")
    expect(labelOf([r(3, 100, 0), r(4, 120, 1)], t)).toBe("rising")
    expect(labelOf([r(9, 100, 0), r(12, 103, 1)], t)).toBe("hot")
    expect(labelOf([r(9, 100, 0), r(9, 100.5, 1), r(9, 101, 2)], t)).toBe("slowing")
    expect(labelOf([r(9, 100, 0), r(9, 120, 1), r(9, 120.5, 2)], t)).toBe("watching")
    expect(labelOf([r(3, 100, 0), r(3, 105, 1)], t)).toBe("watching")
  })

  it("statusOf follows the threshold but never moves an admin decision", () => {
    const t = DEFAULT_THRESHOLDS
    expect(statusOf("watching", [r(4, 100, 0)], t)).toBe("watching")
    expect(statusOf("watching", [r(5, 100, 0)], t)).toBe("candidate")
    expect(statusOf("candidate", [r(6, 100, 0), r(6, 100, 1), r(6, 100, 2)], t)).toBe("slowing")
    expect(statusOf("approved", [r(1, 1, 0)], t)).toBe("approved")
    expect(statusOf("rejected", [r(50, 1, 0)], t)).toBe("rejected")
    expect(statusOf("watching", [], t)).toBe("watching")
  })

  it("passesNow is true exactly on the first reading at the threshold", () => {
    const t = DEFAULT_THRESHOLDS
    expect(passesNow([r(4, 1, 0), r(5, 1, 1)], t)).toBe(true)
    expect(passesNow([r(5, 1, 0), r(6, 1, 1)], t)).toBe(false)
    expect(passesNow([r(4, 1, 0)], t)).toBe(false)
  })
})
