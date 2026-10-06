/**
 * An idle tick is NOTHING on every pip. The feed's and Read Collection's
 * routes write `json: []` on an empty window; a consumer wired to `json`
 * must read that as no input (so the skip rule starves it), never as the
 * two-character text "[]" — a paid model call on brackets, a junk record, a
 * reply published to nothing (series review C1, 2026-10-06).
 */
import { describe, expect, it } from "vitest"
import { getPrimaryOutput } from "../output-extractor.js"

describe("getPrimaryOutput on an empty window", () => {
  it("Telegram Channel Feed: json is undefined when the posts are [], the text pip is the (empty) digest", () => {
    expect(getPrimaryOutput({ json: [], text: "", listResults: [] }, "telegram-channel-feed", "json")).toBeUndefined()
    expect(getPrimaryOutput({ json: [], text: "" }, "telegram-channel-feed", "text")).toBe("")
    expect(getPrimaryOutput({ json: [], text: "" }, "telegram-channel-feed", undefined)).toBe("")
  })

  it("Telegram Channel Feed: with posts, json is the posts as text and the text pip is the digest", () => {
    const posts = [{ id: 1, channel: "acme", postUrl: "https://t.me/acme/1", text: "hello", media: [] }]
    expect(getPrimaryOutput({ json: posts, text: "hello" }, "telegram-channel-feed", "json")).toBe(JSON.stringify(posts))
    expect(getPrimaryOutput({ json: posts, text: "hello" }, "telegram-channel-feed", "text")).toBe("hello")
  })

  it("Read Collection: the same rule", () => {
    expect(getPrimaryOutput({ json: [], text: "" }, "collection-read", "json")).toBeUndefined()
    expect(getPrimaryOutput({ json: [{ id: "r1" }], text: "- r1" }, "collection-read", "json")).toBe(JSON.stringify([{ id: "r1" }]))
  })
})
