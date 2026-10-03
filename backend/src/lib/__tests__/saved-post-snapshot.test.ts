import { describe, it, expect } from "vitest"
import { cleanSocialPostSnapshot } from "../saved-post-snapshot.js"

function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: "youtube:abc",
    platform: "youtube",
    url: "https://www.youtube.com/watch?v=abc",
    title: "How to fold a shirt",
    text: "Three ways",
    author: { handle: "maker", name: "Maker", avatarUrl: "https://cdn.example.com/a.jpg", followers: 900, verified: true },
    container: "Maker's channel",
    publishedAt: "2026-09-30T12:00:00Z",
    metrics: { views: 1200, likes: 40, comments: 3, score: -2 },
    media: { kind: "video", thumbnailUrl: "https://cdn.example.com/s.jpg", durationSec: 61, aspect: "16:9" },
    hashtags: ["laundry"],
    extra: { channelId: "UC1" },
    ...overrides,
  }
}

describe("cleanSocialPostSnapshot", () => {
  it("keeps a well-formed post as it is", () => {
    expect(cleanSocialPostSnapshot(raw())).toEqual(raw())
  })

  it("refuses a post missing what every reader needs", () => {
    expect(cleanSocialPostSnapshot(null)).toBeNull()
    expect(cleanSocialPostSnapshot([raw()])).toBeNull()
    expect(cleanSocialPostSnapshot(raw({ id: "" }))).toBeNull()
    expect(cleanSocialPostSnapshot(raw({ id: "x".repeat(301) }))).toBeNull()
    expect(cleanSocialPostSnapshot(raw({ platform: "myspace" }))).toBeNull()
    expect(cleanSocialPostSnapshot(raw({ url: "javascript:alert(1)" }))).toBeNull()
    expect(cleanSocialPostSnapshot(raw({ url: `https://example.com/${"x".repeat(2000)}` }))).toBeNull()
    expect(cleanSocialPostSnapshot(raw({ text: 7 }))).toBeNull()
    expect(cleanSocialPostSnapshot(raw({ author: { handle: "maker" } }))).toBeNull()
  })

  it("drops optional fields of the wrong kind instead of storing them", () => {
    const clean = cleanSocialPostSnapshot(
      raw({
        title: 5,
        container: { name: "x" },
        publishedAt: "last week",
        author: { handle: "maker", name: "Maker", avatarUrl: "data:image/png;base64,AAAA", followers: -1, verified: "yes", url: "ftp://x" },
        metrics: { views: "1.2K", likes: Number.NaN, comments: Number.POSITIVE_INFINITY, score: "high" },
        media: { kind: "hologram", thumbnailUrl: "javascript:alert(1)", videoUrl: "not a link", durationSec: -5, aspect: "4:3" },
        hashtags: "laundry",
        extra: ["not", "a", "record"],
      }),
    )
    expect(clean).toEqual({
      id: "youtube:abc",
      platform: "youtube",
      url: "https://www.youtube.com/watch?v=abc",
      text: "Three ways",
      author: { handle: "maker", name: "Maker" },
      metrics: {},
      media: { kind: "text" },
      hashtags: [],
      extra: {},
    })
  })

  it("caps long text and keeps only text hashtags", () => {
    const clean = cleanSocialPostSnapshot(raw({ text: "x".repeat(30_000), hashtags: ["a", 1, null, "b"] }))
    expect(clean?.text).toHaveLength(20_000)
    expect(clean?.hashtags).toEqual(["a", "b"])
  })
})
