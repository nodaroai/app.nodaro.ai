import { describe, it, expect } from "vitest"
import { ingestRecordFromJson, type CollectionRecord, type SocialPost } from "@nodaro/shared"
import { translate, type TFunction } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { recordAuthor, recordPostedAt, recordStill } from "@/lib/collection-record-view"
import { collectionRecordFeedPost } from "../collection-record-feed-post"

const t: TFunction = (key, vars) => translate("en", key, vars)

function record(over: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id: "r1",
    collectionId: "c1",
    title: "",
    text: "",
    url: null,
    media: [],
    fields: {},
    dedupeKey: null,
    source: { via: "node" },
    createdAt: "2026-10-07T11:05:16Z",
    ...over,
  }
}

describe("recordPostedAt", () => {
  it("reads the post's own date from the field its source used", () => {
    expect(recordPostedAt(record({ fields: { publishedAt: "2026-10-06T09:00:00Z" } }))).toBe("2026-10-06T09:00:00Z")
    expect(recordPostedAt(record({ fields: { date: "2026-10-05T09:00:00Z" } }))).toBe("2026-10-05T09:00:00Z")
    expect(recordPostedAt(record({ fields: { timestamp: "2026-10-04T09:00:00.000Z" } }))).toBe("2026-10-04T09:00:00.000Z")
    expect(recordPostedAt(record({ fields: { date: "2026-10-03" } }))).toBe("2026-10-03")
  })

  it("only an ISO date counts: a looser parse would invent a date", () => {
    expect(recordPostedAt(record({ fields: { publishedAt: "6.10.2026" } }))).toBeNull()
    expect(recordPostedAt(record({ fields: { date: "1" } }))).toBeNull()
    expect(recordPostedAt(record({ fields: { date: "Oct 6" } }))).toBeNull()
    expect(recordPostedAt(record({ fields: { date: "Post 1" } }))).toBeNull()
    expect(recordPostedAt(record({ fields: { date: 1728000000 } }))).toBeNull()
  })

  it("skips a field that is not a date for the next one, and has none when no field is", () => {
    expect(recordPostedAt(record({ fields: { publishedAt: "yesterday", date: "2026-10-05T09:00:00Z" } }))).toBe("2026-10-05T09:00:00Z")
    expect(recordPostedAt(record())).toBeNull()
  })
})

describe("recordAuthor", () => {
  it("prefers a handle, written once with @", () => {
    expect(recordAuthor(record({ fields: { handle: "@acme.studio", author: "Acme" } }))).toEqual({ label: "@acme.studio", isHandle: true })
    expect(recordAuthor(record({ fields: { channel: "tech_cyber_ai_israel" } }))).toEqual({ label: "@tech_cyber_ai_israel", isHandle: true })
  })

  it("a display name in a handle field is a name, never an @", () => {
    expect(recordAuthor(record({ fields: { channel: "Tech News Daily" } }))).toEqual({ label: "Tech News Daily", isHandle: false })
    expect(recordAuthor(record({ fields: { channel: "Tech News Daily", author: "Tech News" } }))).toEqual({ label: "Tech News", isHandle: false })
  })

  it("falls back to a name, then to nothing", () => {
    expect(recordAuthor(record({ fields: { author: "Acme" } }))).toEqual({ label: "Acme", isHandle: false })
    expect(recordAuthor(record({ fields: { handle: "  " } }))).toEqual({ label: "", isHandle: false })
  })
})

describe("recordStill", () => {
  it("is the first image, else the first video's poster", () => {
    expect(recordStill(record({ media: [{ type: "video", url: "https://v/1.mp4", posterUrl: "https://v/1.jpg" }, { type: "image", url: "https://i/2.jpg" }] }))).toBe("https://i/2.jpg")
    expect(recordStill(record({ media: [{ type: "video", url: "https://v/1.mp4", posterUrl: "https://v/1.jpg" }] }))).toBe("https://v/1.jpg")
    expect(recordStill(record({ media: [{ type: "video", url: "https://v/1.mp4" }] }))).toBeUndefined()
  })
})

describe("collectionRecordFeedPost", () => {
  it("a titled post: title as heading, its text, the post's date and who posted it, Open in its site", () => {
    const post = collectionRecordFeedPost(
      record({
        title: "Our new voices are live",
        text: "Give your characters a voice.",
        url: "https://www.instagram.com/p/DPabc/",
        fields: { publishedAt: "2026-10-06T09:00:00Z", handle: "acme.studio", views: 1204 },
      }),
      t,
    )
    expect(post.heading).toBe("Our new voices are live")
    expect(post.headingDir).toBe("auto")
    expect(post.text).toBe("Give your characters a voice.")
    expect(post.meta).toHaveLength(2)
    expect(post.meta[0]).not.toMatch(/^Saved/)
    expect(post.meta[1]).toBe("@acme.studio")
    expect(post.stat).toBe(`${formatNumber(1204)} views`)
    expect(post.openUrl).toBe("https://www.instagram.com/p/DPabc/")
    expect(post.site).toBe("Instagram")
  })

  it("one view reads in the singular", () => {
    expect(collectionRecordFeedPost(record({ fields: { views: 1 } }), t).stat).toBe("1 view")
    expect(collectionRecordFeedPost(record({ fields: { views: "1" } }), t).stat).toBe("1 view")
  })

  it("an untitled post leads with its handle, left to right, and keeps its whole text", () => {
    const post = collectionRecordFeedPost(record({ text: "Nano Banana 2.1 is out", fields: { channel: "tech_cyber_ai_israel" } }), t)
    expect(post.heading).toBe("@tech_cyber_ai_israel")
    expect(post.headingDir).toBe("ltr")
    expect(post.text).toBe("Nano Banana 2.1 is out")
    expect(post.initial).toBe("T")
  })

  it("text that only repeats the title is not shown twice", () => {
    expect(collectionRecordFeedPost(record({ title: "Same", text: " Same " }), t).text).toBe("")
  })

  it("with no date of its own, the line says when it was saved; with neither, no date at all", () => {
    expect(collectionRecordFeedPost(record({ title: "A" }), t).meta[0]).toMatch(/^Saved /)
    expect(collectionRecordFeedPost(record({ title: "A", createdAt: "" }), t).meta[0]).toBe("")
  })

  it("a link that is not http(s) is never opened, and names no site", () => {
    const post = collectionRecordFeedPost(record({ title: "A", url: "javascript:alert(1)" }), t)
    expect(post.openUrl).toBeNull()
    expect(post.site).toBe("")
  })

  it("a video plays its file when it is http(s), else only on the post's page", () => {
    expect(collectionRecordFeedPost(record({ media: [{ type: "video", url: "https://v/1.mp4" }] }), t).video).toEqual({ url: "https://v/1.mp4" })
    expect(collectionRecordFeedPost(record({ media: [{ type: "image", url: "https://i/1.jpg" }] }), t).video).toBeNull()
  })

  it("a Social Search post saved through the real ingest: its picture, the author's name, the post's date, Open in its platform", () => {
    const social: SocialPost = {
      id: "ig_1",
      platform: "instagram",
      url: "https://www.instagram.com/reel/DPx/",
      title: undefined,
      text: "Introducing the Ads Studio",
      author: { handle: "acme.studio", name: "Acme Studio" },
      publishedAt: "2026-10-05T10:00:00Z",
      metrics: { views: 5400 },
      media: { kind: "video", thumbnailUrl: "https://cdn.example/t.jpg", videoUrl: "https://cdn.example/v.mp4" },
      hashtags: [],
      extra: {},
    } as unknown as SocialPost
    const ingested = ingestRecordFromJson(social)
    const post = collectionRecordFeedPost(record({ ...ingested, title: ingested.title, text: ingested.text }), t)
    expect(post.previewUrl).toBe("https://cdn.example/t.jpg")
    expect(post.video).toEqual({ url: "https://cdn.example/v.mp4" })
    expect(post.heading).toBe("Acme Studio")
    expect(post.text).toBe("Introducing the Ads Studio")
    expect(post.meta[0]).not.toMatch(/^Saved/)
    expect(post.site).toBe("Instagram")
  })
})
