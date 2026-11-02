import { describe, expect, it } from "vitest"
import type { SocialPost } from "@nodaro/shared/social"
import { clusterPosts, toCandidatePost } from "../cluster.js"
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

const r = (creators: number, plays: number, i: number): TrendCandidateReading => ({ date: `2026-10-${String(10 + i).padStart(2, "0")}`, creators, plays, posts: 20 })

describe("labels", () => {
  it("dayChangePct is the growth from the previous reading, one decimal", () => {
    expect(dayChangePct([r(1, 100, 0)])).toBeNull()
    expect(dayChangePct([r(1, 100, 0), r(2, 118, 1)])).toBe(18)
    expect(dayChangePct([r(1, 0, 0), r(2, 118, 1)])).toBeNull()
    expect(dayChangePct([r(1, 1000, 0), r(2, 1006, 1)])).toBe(0.6)
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
