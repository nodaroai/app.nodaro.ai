import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { itemFromWire, prepareRecord } from "../collections-store.js"

describe("itemFromWire — what a node receives on its `in` wire", () => {
  it("reads JSON text that is an object as that object", () => {
    expect(itemFromWire('{"postUrl":"https://t.me/x/1","text":"hi"}')).toEqual({ postUrl: "https://t.me/x/1", text: "hi" })
    expect(itemFromWire('  {"a":1}  ')).toEqual({ a: 1 })
  })

  it("keeps a list, broken JSON and plain text as the text they are", () => {
    expect(itemFromWire('[{"a":1},{"a":2}]')).toBe('[{"a":1},{"a":2}]')
    expect(itemFromWire('{"a":')).toBe('{"a":')
    expect(itemFromWire("Just a headline")).toBe("Just a headline")
  })

  it("a list of exactly ONE object is that object — an each wire that held a single post never fanned out", () => {
    expect(itemFromWire('[{"postUrl":"https://t.me/x/9","text":"only one"}]')).toEqual({ postUrl: "https://t.me/x/9", text: "only one" })
    expect(itemFromWire([{ title: "T" }])).toEqual({ title: "T" })
    expect(itemFromWire('["just a string"]')).toBe('["just a string"]')
    expect(itemFromWire("[]")).toBe("[]")
  })

  it("JSON a model wrapped in a ```json fence is still JSON", () => {
    expect(itemFromWire('```json\n{"headline":"Markets rally","slug":"markets-rally"}\n```')).toEqual({ headline: "Markets rally", slug: "markets-rally" })
    expect(itemFromWire("```\n{\"a\":1}\n```")).toEqual({ a: 1 })
    expect(itemFromWire("```json\nnot json\n```")).toBe("```json\nnot json\n```")
  })

  it("passes a real object or list through untouched", () => {
    const obj = { title: "T" }
    expect(itemFromWire(obj)).toBe(obj)
    expect(itemFromWire(undefined)).toBeUndefined()
  })
})

describe("prepareRecord — explicit fields win over the item", () => {
  it("maps a feed post from JSON text, the node's title winning and the link keying the dedupe", () => {
    const prepared = prepareRecord({
      item: JSON.stringify({ id: 441, channel: "telegram", postUrl: "https://T.me/Telegram/441", text: "Telegram turns ten.", media: [{ type: "photo", url: "https://cdn.example.com/a.jpg" }] }),
      title: "Telegram turns ten",
      fields: { topic: "tech" },
    })
    expect(prepared).toEqual({
      title: "Telegram turns ten",
      text: "Telegram turns ten.",
      url: "https://T.me/Telegram/441",
      media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }],
      fields: { id: 441, channel: "telegram", topic: "tech" },
      // The host folds to lower case; the path keeps its case.
      dedupeKey: "https://t.me/Telegram/441",
    })
  })

  it("the item's own media and the wired media are kept together, the item's first, repeats dropped", () => {
    const prepared = prepareRecord({
      item: { url: "https://a.example.com/1", imageUrl: "https://cdn.example.com/a.jpg" },
      media: [
        { type: "video", url: "https://cdn.example.com/b.mp4" },
        { type: "image", url: "https://cdn.example.com/a.jpg" },
      ],
    })
    expect(prepared?.media).toEqual([
      { type: "image", url: "https://cdn.example.com/a.jpg" },
      { type: "video", url: "https://cdn.example.com/b.mp4" },
    ])
  })

  it("a plain-text item that is one link is the record's link (a list of article addresses, saved row by row)", () => {
    const prepared = prepareRecord({ item: "  https://news.example.test/story-7 " })
    expect(prepared).toEqual({ title: "", text: "", url: "https://news.example.test/story-7", media: [], fields: {}, dedupeKey: "https://news.example.test/story-7" })
    // A sentence with a link in it stays text.
    expect(prepareRecord({ item: "Read https://news.example.test/story-7 today" })?.url).toBeNull()
  })

  it("an explicit link and dedupe key win; a link that is not http(s) is ignored", () => {
    const prepared = prepareRecord({ item: { url: "https://a.example.com/1" }, url: "https://b.example.com/2", dedupeKey: " Story-7 " })
    expect(prepared?.url).toBe("https://b.example.com/2")
    expect(prepared?.dedupeKey).toBe("story-7")
    expect(prepareRecord({ text: "t", url: "javascript:alert(1)" })?.url).toBeNull()
  })

  it("plain text becomes the text; a record with nothing in it is null; a poster that is null is a medium", () => {
    expect(prepareRecord({ item: "Just a headline" })?.text).toBe("Just a headline")
    expect(prepareRecord({ item: { nothing: null } })).toBeNull()
    expect(prepareRecord({})).toBeNull()
    expect(prepareRecord({ media: [{ type: "image", url: "https://cdn.example.com/a.jpg", posterUrl: null }] })?.media).toEqual([
      { type: "image", url: "https://cdn.example.com/a.jpg" },
    ])
  })

  it("cuts a long text to whole characters", () => {
    const prepared = prepareRecord({ text: "😀".repeat(20_500) })
    expect(Array.from(prepared!.text)).toHaveLength(20_000)
  })
})
