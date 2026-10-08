import { describe, it, expect } from "vitest"
import type { SavedPost, SocialPost } from "@nodaro/shared"
import { competitorPostsFromScans, hasUndatedPosts, inspirationPostOf, planScans, undatedPostIds, SCAN_LOOKBACK_MS } from "../social-post-reads.js"

const day = (iso: string) => Date.parse(iso)
const DAY_MS = 86_400_000

function post(id: string, over: Partial<SocialPost> & { role?: string } = {}): SocialPost & { role?: string } {
  return {
    id,
    platform: "instagram",
    url: `https://www.instagram.com/p/${id}/`,
    text: `post ${id}`,
    author: { handle: "acme", name: "Acme" },
    metrics: { views: 10 },
    media: { kind: "image", thumbnailUrl: `https://cdn.example/${id}.jpg` },
    hashtags: [],
    extra: {},
    ...over,
  } as SocialPost & { role?: string }
}

describe("planScans", () => {
  const range = { from: day("2026-10-01T00:00:00Z"), to: day("2026-10-08T00:00:00Z") }

  it("reads the scans inside the period and the first one after it; remembers the last one before it", () => {
    const scans = [
      { id: "older", at: "2026-09-20T12:00:00Z" },
      { id: "before", at: "2026-09-30T12:00:00Z" },
      { id: "inside-1", at: "2026-10-03T12:00:00Z" },
      { id: "inside-2", at: "2026-10-06T12:00:00Z" },
      { id: "after-1", at: "2026-10-10T12:00:00Z" },
      { id: "after-2", at: "2026-10-20T12:00:00Z" },
      { id: "too-late", at: new Date(range.to + SCAN_LOOKBACK_MS + 1000).toISOString() },
    ]
    const plan = planScans(scans, range)
    expect(plan.read.map((s) => s.id)).toEqual(["after-1", "inside-2", "inside-1"])
    expect(plan.before?.id).toBe("before")
  })

  it("spreads the cap over a long period instead of keeping only its newest weeks", () => {
    const year = { from: day("2025-10-07T00:00:00Z"), to: day("2026-10-07T00:00:00Z") }
    const daily = Array.from({ length: 365 }, (_, i) => ({ id: `d${i}`, at: new Date(year.from + i * DAY_MS + 3_600_000).toISOString() }))
    const plan = planScans(daily, year, 40)
    expect(plan.read.length).toBeLessThanOrEqual(40)
    expect(plan.read.length).toBeGreaterThan(30)
    const oldest = Math.min(...plan.read.map((s) => Date.parse(s.at)))
    // The oldest scan read is within one spacing of the period's start, not ~40 days before its end.
    expect(oldest - year.from).toBeLessThan(15 * DAY_MS)
  })

  it("a short period reads every scan in it", () => {
    const week = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, at: new Date(range.from + i * DAY_MS + 3_600_000).toISOString() }))
    expect(planScans(week, range).read).toHaveLength(7)
  })

  it("skips a scan with no readable date", () => {
    expect(planScans([{ id: "x", at: "not a date" }], range)).toEqual({ read: [], before: null })
  })
})

describe("competitorPostsFromScans", () => {
  const range = { from: day("2026-10-01T00:00:00Z"), to: day("2026-10-08T00:00:00Z") }
  const base = { range, role: "all" as const, order: "newest" as const, limit: 50 }

  it("lists each post once, with the newest scan's numbers", () => {
    const scans = [
      { at: "2026-10-03T00:00:00Z", posts: [post("a", { publishedAt: "2026-10-02T09:00:00Z", metrics: { views: 10 } })] },
      { at: "2026-10-06T00:00:00Z", posts: [post("a", { publishedAt: "2026-10-02T09:00:00Z", metrics: { views: 99 } })] },
    ]
    const out = competitorPostsFromScans(scans, base)
    expect(out).toHaveLength(1)
    expect(out[0]?.metrics.views).toBe(99)
  })

  it("keeps only posts published inside the range", () => {
    const scans = [
      {
        at: "2026-10-09T00:00:00Z",
        posts: [
          post("in", { publishedAt: "2026-10-04T09:00:00Z" }),
          post("before", { publishedAt: "2026-09-20T09:00:00Z" }),
          post("after", { publishedAt: "2026-10-08T00:00:00Z" }),
        ],
      },
    ]
    expect(competitorPostsFromScans(scans, base).map((p) => p.id)).toEqual(["in"])
  })

  it("a post with no date counts on the day the first scan saw it", () => {
    const scans = [
      { at: "2026-10-09T00:00:00Z", posts: [post("undated")] },
      { at: "2026-10-05T00:00:00Z", posts: [post("undated")] },
    ]
    expect(competitorPostsFromScans(scans, base).map((p) => p.id)).toEqual(["undated"])
    const firstSeenAfter = [{ at: "2026-10-09T00:00:00Z", posts: [post("undated")] }]
    expect(competitorPostsFromScans(firstSeenAfter, base)).toEqual([])
  })

  it("an undated post the scan before the period already held is not the period's", () => {
    const before = { at: "2026-09-20T00:00:00Z", posts: [post("old-undated"), post("dated", { publishedAt: "2026-09-19T00:00:00Z" })] }
    const inside = [{ at: "2026-10-03T00:00:00Z", posts: [post("old-undated"), post("new-undated")] }]
    expect(hasUndatedPosts(inside)).toBe(true)
    expect([...undatedPostIds(before)]).toEqual(["old-undated"])
    expect(competitorPostsFromScans(inside, base, undatedPostIds(before)).map((p) => p.id)).toEqual(["new-undated"])
  })

  it("filters by role and platform; a post whose role the scan did not name counts only under all", () => {
    const scans = [
      {
        at: "2026-10-06T00:00:00Z",
        posts: [
          post("own-ig", { role: "own", publishedAt: "2026-10-02T00:00:00Z" }),
          post("about-ig", { role: "about", publishedAt: "2026-10-03T00:00:00Z" }),
          post("own-x", { role: "own", platform: "x", url: "https://x.com/acme/status/1", publishedAt: "2026-10-04T00:00:00Z" }),
          post("no-role", { publishedAt: "2026-10-05T00:00:00Z" }),
          post("odd-role", { role: "sponsor", publishedAt: "2026-10-05T01:00:00Z" }),
        ],
      },
    ]
    expect(competitorPostsFromScans(scans, { ...base, role: "own" }).map((p) => p.id)).toEqual(["own-x", "own-ig"])
    expect(competitorPostsFromScans(scans, { ...base, role: "about" }).map((p) => p.id)).toEqual(["about-ig"])
    expect(competitorPostsFromScans(scans, { ...base, platform: "x" }).map((p) => p.id)).toEqual(["own-x"])
    const all = competitorPostsFromScans(scans, base)
    expect(all.map((p) => p.id)).toEqual(["odd-role", "no-role", "own-x", "about-ig", "own-ig"])
    expect(all.find((p) => p.id === "odd-role")?.role).toBeUndefined()
  })

  it("orders newest or oldest first and stops at the limit", () => {
    const scans = [
      {
        at: "2026-10-07T00:00:00Z",
        posts: [post("d2", { publishedAt: "2026-10-02T00:00:00Z" }), post("d4", { publishedAt: "2026-10-04T00:00:00Z" }), post("d3", { publishedAt: "2026-10-03T00:00:00Z" })],
      },
    ]
    expect(competitorPostsFromScans(scans, base).map((p) => p.id)).toEqual(["d4", "d3", "d2"])
    expect(competitorPostsFromScans(scans, { ...base, order: "oldest", limit: 2 }).map((p) => p.id)).toEqual(["d2", "d3"])
  })

  it("ignores anything in a scan that is not a post", () => {
    const scans = [{ at: "2026-10-06T00:00:00Z", posts: [null, { id: "x" }, "junk", post("ok", { publishedAt: "2026-10-02T00:00:00Z" })] }]
    expect(competitorPostsFromScans(scans, base).map((p) => p.id)).toEqual(["ok"])
  })
})

describe("inspirationPostOf", () => {
  const saved: SavedPost = {
    id: "s1",
    postId: "p1",
    platform: "instagram",
    url: "https://www.instagram.com/p/p1/",
    post: post("p1"),
    thumbnailUrl: "https://media.nodaro.ai/images/still.jpg",
    note: "great hook",
    tags: ["hooks"],
    source: "picker",
    createdAt: "2026-10-05T10:00:00Z",
    updatedAt: "2026-10-05T10:00:00Z",
  }

  it("the copied still replaces the platform's expiring thumbnail; saved date, note and tags ride along", () => {
    const out = inspirationPostOf(saved)
    expect(out.media.thumbnailUrl).toBe("https://media.nodaro.ai/images/still.jpg")
    expect(out.savedAt).toBe("2026-10-05T10:00:00Z")
    expect(out.note).toBe("great hook")
    expect(out.tags).toEqual(["hooks"])
    expect(out.url).toBe("https://www.instagram.com/p/p1/")
  })

  it("without a copy it keeps the post's own thumbnail; an empty note and no tags add nothing", () => {
    const out = inspirationPostOf({ ...saved, thumbnailUrl: null, note: "  ", tags: [] })
    expect(out.media.thumbnailUrl).toBe("https://cdn.example/p1.jpg")
    expect("note" in out).toBe(false)
    expect("tags" in out).toBe(false)
  })
})
