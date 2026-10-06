import { describe, expect, it } from "vitest"
import {
  TELEGRAM_FEED_LIMIT_MAX,
  planFeedEmission,
  telegramFeedDigest,
  telegramPostsFrom,
} from "../telegram-channel.js"

const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i }))

/** The feed's position after a run — the one rule the route and the editor read. */
describe("planFeedEmission", () => {
  it("first run: the newest N, and the position jumps to the newest post", () => {
    const plan = planFeedEmission(ids(100, 119), undefined, 5)
    expect(plan.emitted.map((p) => p.id)).toEqual([115, 116, 117, 118, 119])
    expect(plan.latestId).toBe(119)
  })

  it("a stored position: the OLDEST N above it, and the position is the highest post emitted — a backlog drains N per run", () => {
    // 15 fresh posts above 104, limit 5: the first five, and the position moves to the fifth.
    const plan = planFeedEmission(ids(100, 119), 104, 5)
    expect(plan.emitted.map((p) => p.id)).toEqual([105, 106, 107, 108, 109])
    expect(plan.latestId).toBe(109)
    const next = planFeedEmission(ids(100, 119), plan.latestId, 5)
    expect(next.emitted.map((p) => p.id)).toEqual([110, 111, 112, 113, 114])
    const last = planFeedEmission(ids(100, 119), 114, 5)
    expect(last.emitted.map((p) => p.id)).toEqual([115, 116, 117, 118, 119])
    expect(last.latestId).toBe(119)
  })

  it("nothing new: nothing emitted and the position stays", () => {
    const plan = planFeedEmission(ids(100, 119), 119, 5)
    expect(plan.emitted).toEqual([])
    expect(plan.latestId).toBe(119)
    const empty = planFeedEmission([], 50, 5)
    expect(empty.emitted).toEqual([])
    expect(empty.latestId).toBe(50)
  })

  it("an empty channel on the first run has no position", () => {
    expect(planFeedEmission([], undefined, 5)).toEqual({ emitted: [], latestId: undefined })
  })

  it("posts in any order, a repeated post (pinned), and a limit outside the range", () => {
    const shuffled = [{ id: 3 }, { id: 1 }, { id: 2 }, { id: 3 }]
    expect(planFeedEmission(shuffled, undefined, 2).emitted.map((p) => p.id)).toEqual([2, 3])
    expect(planFeedEmission(ids(1, 40), 0, 99).emitted).toHaveLength(TELEGRAM_FEED_LIMIT_MAX)
    expect(planFeedEmission(ids(1, 40), undefined, 0).emitted).toHaveLength(1)
    expect(planFeedEmission(ids(1, 40), undefined, Number.NaN).emitted).toHaveLength(5)
  })
})

describe("telegramFeedDigest", () => {
  it("joins the posts' text oldest first and leaves out a post with no text", () => {
    expect(telegramFeedDigest([{ text: "one" }, { text: "   " }, { text: "two" }])).toBe("one\n\n---\n\ntwo")
    expect(telegramFeedDigest([])).toBe("")
  })
})

describe("telegramPostsFrom", () => {
  it("reads a saved list back, normalizing what an older save lacks, and leaves out anything that is not a post", () => {
    const posts = telegramPostsFrom([
      { id: 10, channel: "acme", postUrl: "https://t.me/acme/10", text: "hello", media: [{ type: "photo", url: "https://cdn/p" }], views: "1.2K", date: "2026-10-06T00:00:00Z" },
      { id: 11, text: "no media saved", channel: "acme" },
      { id: "12", text: "string id" },
      "not a post",
      null,
      { id: 13, url: "https://t.me/acme/13", text: "legacy url field", forwardedFrom: { name: "Other", url: "https://t.me/other" } },
    ])
    expect(posts.map((p) => p.id)).toEqual([10, 11, 13])
    expect(posts[0]!.media).toEqual([{ type: "photo", url: "https://cdn/p" }])
    expect(posts[1]).toMatchObject({ postUrl: "https://t.me/acme/11", media: [] })
    expect(posts[2]).toMatchObject({ postUrl: "https://t.me/acme/13", forwardedFrom: { name: "Other", url: "https://t.me/other" } })
    expect(telegramPostsFrom("nope")).toEqual([])
    expect(telegramPostsFrom(undefined)).toEqual([])
  })
})
