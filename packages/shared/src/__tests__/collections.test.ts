import { describe, it, expect } from "vitest"
import {
  clampChars,
  COLLECTION_RECORD_FIELDS_BYTES_MAX,
  COLLECTION_RECORD_FIELDS_MAX,
  COLLECTION_RECORD_MEDIA_MAX,
  COLLECTION_TIER_CAPS,
  collectionCapsForTier,
  collectionRecordHeadline,
  collectionRecordsDigest,
  ingestRecordFromJson,
  isCollectionMedia,
  normalizeCollectionFields,
  normalizeCollectionMedia,
  normalizeDedupeKey,
  type CollectionRecord,
} from "../collections.js"

function record(overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id: "r1",
    collectionId: "c1",
    title: "Telegram turns ten",
    text: "The messenger marks a decade.\nSecond paragraph.",
    url: "https://t.me/telegram/441",
    media: [],
    fields: {},
    dedupeKey: "https://t.me/telegram/441",
    source: {},
    createdAt: "2026-10-06T08:00:00.000Z",
    ...overrides,
  }
}

describe("collection caps by tier", () => {
  it("payg is a derived tier whose caps are basic's; enterprise reads as business", () => {
    expect(COLLECTION_TIER_CAPS.payg).toEqual(COLLECTION_TIER_CAPS.basic)
    expect(COLLECTION_TIER_CAPS.enterprise).toEqual(COLLECTION_TIER_CAPS.business)
  })

  it("the ladder Asaf decided (2026-10-05)", () => {
    expect(COLLECTION_TIER_CAPS.free).toEqual({ collections: 3, records: 500 })
    expect(COLLECTION_TIER_CAPS.basic).toEqual({ collections: 10, records: 5_000 })
    expect(COLLECTION_TIER_CAPS.standard).toEqual({ collections: 30, records: 20_000 })
    expect(COLLECTION_TIER_CAPS.pro).toEqual({ collections: 100, records: 100_000 })
    expect(COLLECTION_TIER_CAPS.business).toEqual({ collections: 300, records: 250_000 })
  })

  it("every paid tier holds at least as much as the one below it", () => {
    const ladder = ["free", "basic", "standard", "pro", "business"].map((t) => COLLECTION_TIER_CAPS[t]!)
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]!.collections).toBeGreaterThanOrEqual(ladder[i - 1]!.collections)
      expect(ladder[i]!.records).toBeGreaterThanOrEqual(ladder[i - 1]!.records)
    }
  })

  it("an unknown, empty or missing tier has NO caps here (the API then holds it to none, never to free's)", () => {
    expect(collectionCapsForTier("gold")).toBeUndefined()
    expect(collectionCapsForTier("")).toBeUndefined()
    expect(collectionCapsForTier(null)).toBeUndefined()
    expect(collectionCapsForTier(undefined)).toBeUndefined()
    expect(collectionCapsForTier("pro")).toEqual(COLLECTION_TIER_CAPS.pro)
    expect(collectionCapsForTier("free")).toEqual(COLLECTION_TIER_CAPS.free)
  })
})

describe("clampChars", () => {
  it("counts characters as Postgres does and never splits a surrogate pair", () => {
    expect(clampChars("abc", 5)).toBe("abc")
    expect(clampChars("abcdef", 3)).toBe("abc")
    expect(clampChars("😀😀😀", 2)).toBe("😀😀")
    expect(clampChars("😀😀😀", 3)).toBe("😀😀😀")
    expect(Array.from(clampChars("a😀".repeat(10), 7))).toHaveLength(7)
  })
})

describe("normalizeDedupeKey", () => {
  it("trims, collapses spaces, lower-cases and caps the length", () => {
    expect(normalizeDedupeKey("  Https://T.me/Telegram/441  ")).toBe("https://t.me/telegram/441")
    expect(normalizeDedupeKey("a   b\n\tc")).toBe("a b c")
    expect(normalizeDedupeKey("x".repeat(400))!.length).toBe(300)
  })

  it("reads a number as its text and nothing else as a key", () => {
    expect(normalizeDedupeKey(441)).toBe("441")
    expect(normalizeDedupeKey("   ")).toBeNull()
    expect(normalizeDedupeKey(undefined)).toBeNull()
    expect(normalizeDedupeKey({ id: 1 })).toBeNull()
    expect(normalizeDedupeKey(Number.NaN)).toBeNull()
  })
})

describe("media and fields as stored", () => {
  it("keeps known kinds with http(s) links, drops repeats and anything else, at most 20", () => {
    expect(isCollectionMedia({ type: "image", url: "https://cdn.example.com/a.jpg" })).toBe(true)
    expect(isCollectionMedia({ type: "image", url: "javascript:alert(1)" })).toBe(false)
    expect(isCollectionMedia({ type: "hologram", url: "https://cdn.example.com/a.jpg" })).toBe(false)
    expect(isCollectionMedia({ type: "video", url: "https://cdn.example.com/v.mp4", posterUrl: "data:x" })).toBe(false)
    expect(isCollectionMedia({ type: "image", url: "https://cdn.example.com/a.jpg", posterUrl: null })).toBe(true)
    expect(normalizeCollectionMedia([{ type: "image", url: "https://cdn.example.com/a.jpg", posterUrl: null }])).toEqual([{ type: "image", url: "https://cdn.example.com/a.jpg" }])
    const many = Array.from({ length: 25 }, (_, i) => ({ type: "image", url: `https://cdn.example.com/${i}.jpg` }))
    expect(normalizeCollectionMedia([...many, many[0], { type: "nope" }, "x"]).length).toBe(COLLECTION_RECORD_MEDIA_MAX)
    expect(normalizeCollectionMedia("not a list")).toEqual([])
  })

  it("keeps scalar fields only, bounded by count and bytes", () => {
    const fields = normalizeCollectionFields({ a: "1", b: 2, c: true, d: null, e: { nested: 1 }, f: [1], "": "empty key" })
    expect(fields).toEqual({ a: "1", b: 2, c: true })
    const tooMany = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]))
    expect(Object.keys(normalizeCollectionFields(tooMany)).length).toBe(COLLECTION_RECORD_FIELDS_MAX)
    const big = normalizeCollectionFields({ one: "x".repeat(COLLECTION_RECORD_FIELDS_BYTES_MAX), two: "fits?" })
    expect(big).toEqual({})
    expect(normalizeCollectionFields("nope")).toEqual({})
  })
})

describe("headline and digest", () => {
  it("the headline is the title, else the first non-empty line of the text, else the link", () => {
    expect(collectionRecordHeadline(record())).toBe("Telegram turns ten")
    expect(collectionRecordHeadline(record({ title: "  " }))).toBe("The messenger marks a decade.")
    expect(collectionRecordHeadline(record({ title: "", text: "\n\n  \n" }))).toBe("https://t.me/telegram/441")
    expect(collectionRecordHeadline(record({ title: "", text: "", url: null }))).toBe("")
    const long = collectionRecordHeadline(record({ title: "", text: "w".repeat(300) }))
    expect(long.length).toBe(120)
    expect(long.endsWith("…")).toBe(true)
  })

  it("headlines: one line per record with the date and the link", () => {
    const digest = collectionRecordsDigest([record(), record({ id: "r2", title: "No link", url: null, createdAt: "2026-10-05T20:00:00Z" })])
    expect(digest).toBe(["- Telegram turns ten · 2026-10-06 · https://t.me/telegram/441", "- No link · 2026-10-05"].join("\n"))
  })

  it("full: the text under its headline, records separated by a rule; a record with nothing adds nothing", () => {
    const digest = collectionRecordsDigest(
      [record(), record({ id: "r2", title: "", text: "Only a line", url: null }), record({ id: "r3", title: "", text: "", url: null })],
      "full",
    )
    expect(digest).toBe(
      [
        "### Telegram turns ten\nThe messenger marks a decade.\nSecond paragraph.\nhttps://t.me/telegram/441",
        "### Only a line",
      ].join("\n\n---\n\n"),
    )
  })
})

describe("ingestRecordFromJson", () => {
  const telegramPost = {
    id: 441,
    channel: "telegram",
    postUrl: "https://t.me/telegram/441",
    text: "Telegram turns ten.\nA decade of messaging.",
    date: "2026-10-06T08:00:00.000Z",
    forwardedFrom: { name: "Durov's Channel", url: "https://t.me/durov" },
    media: [
      { type: "photo", url: "https://cdn4.telesco.pe/file/a.jpg?token=1" },
      { type: "video", posterUrl: "https://cdn4.telesco.pe/file/poster.jpg" },
      { type: "video", url: "https://cdn4.telesco.pe/file/v.mp4", posterUrl: "https://cdn4.telesco.pe/file/p2.jpg" },
    ],
    imageUrl: "https://cdn4.telesco.pe/file/a.jpg?token=1",
    views: "1.52M",
  }

  it("reads a Telegram post: link, text, every medium, the forwarded-from name and the scalars as fields", () => {
    const r = ingestRecordFromJson(telegramPost)
    expect(r.title).toBe("")
    expect(r.text).toBe("Telegram turns ten.\nA decade of messaging.")
    expect(r.url).toBe("https://t.me/telegram/441")
    expect(r.dedupeKey).toBe("https://t.me/telegram/441")
    expect(r.media).toEqual([
      { type: "image", url: "https://cdn4.telesco.pe/file/a.jpg?token=1" },
      { type: "image", url: "https://cdn4.telesco.pe/file/poster.jpg" },
      { type: "video", url: "https://cdn4.telesco.pe/file/v.mp4", posterUrl: "https://cdn4.telesco.pe/file/p2.jpg" },
    ])
    expect(r.fields).toEqual({ id: 441, channel: "telegram", date: "2026-10-06T08:00:00.000Z", forwardedFrom: "Durov's Channel", views: "1.52M" })
    expect(collectionRecordHeadline({ ...r, url: r.url })).toBe("Telegram turns ten.")
  })

  it("reads a Social Search post: title, the object-shaped media, the author's name", () => {
    const r = ingestRecordFromJson({
      id: "tiktok:7300000000000000001",
      platform: "tiktok",
      url: "https://www.tiktok.com/@maker/video/7300000000000000001",
      title: "Three ways to fold a shirt",
      text: "Long story",
      author: { handle: "maker", name: "Maker" },
      metrics: { views: 1200 },
      media: { kind: "video", thumbnailUrl: "https://cdn.example.com/still.jpg", videoUrl: "https://cdn.example.com/v.mp4" },
      hashtags: ["laundry"],
    })
    expect(r.title).toBe("Three ways to fold a shirt")
    expect(r.text).toBe("Long story")
    expect(r.url).toBe("https://www.tiktok.com/@maker/video/7300000000000000001")
    expect(r.media).toEqual([{ type: "video", url: "https://cdn.example.com/v.mp4", posterUrl: "https://cdn.example.com/still.jpg" }])
    expect(r.fields).toEqual({ id: "tiktok:7300000000000000001", platform: "tiktok", author: "Maker" })
    expect(r.dedupeKey).toBe("https://www.tiktok.com/@maker/video/7300000000000000001")
  })

  it("reads an LLM's article object: headline / dek / body, the slug as the dedupe key when there is no link", () => {
    const r = ingestRecordFromJson({ headline: "Markets rally", dek: "A short deck.", slug: "Markets-Rally", confidence: 0.9, topic: "business" })
    expect(r.title).toBe("Markets rally")
    expect(r.text).toBe("A short deck.")
    expect(r.url).toBeNull()
    expect(r.dedupeKey).toBe("markets-rally")
    expect(r.fields).toEqual({ slug: "Markets-Rally", confidence: 0.9, topic: "business" })
  })

  it("a link that is not http(s) is not a link, and the dedupe key then falls back to an id", () => {
    const r = ingestRecordFromJson({ url: "javascript:alert(1)", id: 7, text: "x" })
    expect(r.url).toBeNull()
    expect(r.dedupeKey).toBe("7")
    expect(r.fields).toEqual({ id: 7 })
  })

  it("the first link key whose value IS a link wins over an earlier key that is not", () => {
    const r = ingestRecordFromJson({ url: "t.me/x/1", postUrl: "https://t.me/x/1", text: "x" })
    expect(r.url).toBe("https://t.me/x/1")
    expect(r.dedupeKey).toBe("https://t.me/x/1")
  })

  it("reads a huge media list in one pass and keeps the first twenty distinct links", () => {
    const media = Array.from({ length: 30_000 }, (_, i) => ({ type: "photo", url: `https://cdn.example.com/${i % 25}.jpg` }))
    const started = Date.now()
    const r = ingestRecordFromJson({ text: "x", media })
    expect(Date.now() - started).toBeLessThan(500)
    expect(r.media).toHaveLength(20)
    expect(r.media[0]).toEqual({ type: "image", url: "https://cdn.example.com/0.jpg" })
  })

  it("a long text is cut to whole characters, never through a surrogate pair", () => {
    const r = ingestRecordFromJson({ text: "😀".repeat(20_500) })
    expect(Array.from(r.text)).toHaveLength(20_000)
  })

  it("a string or a scalar becomes the text; nothing becomes nothing", () => {
    expect(ingestRecordFromJson("Just a line")).toEqual({ title: "", text: "Just a line", url: null, media: [], fields: {}, dedupeKey: null })
    expect(ingestRecordFromJson(42).text).toBe("42")
    expect(ingestRecordFromJson(null).text).toBe("")
    expect(ingestRecordFromJson(undefined).text).toBe("")
    expect(ingestRecordFromJson([1, 2]).text).toBe("[1,2]")
  })
})
