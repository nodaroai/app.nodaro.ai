/**
 * The one guess both engines make about a fan-out item — media link or text —
 * and the lanes where a link stays the item.
 */
import { describe, expect, it } from "vitest"
import { fanOutUrlItemIsText, isFanOutUrlItem, resolveListFanOut, type FanOutCandidate } from "../fan-out-rows.js"

describe("isFanOutUrlItem", () => {
  it("one address is a media link, with or without a query string", () => {
    expect(isFanOutUrlItem("https://cdn.example.test/a.jpg")).toBe(true)
    expect(isFanOutUrlItem("https://cdn.example.test/a.jpg?token=1")).toBe(true)
    expect(isFanOutUrlItem("  https://news.example.test/story-7 ")).toBe(true)
    expect(isFanOutUrlItem("clip.mp4")).toBe(true)
  })

  it("JSON and sentences are text, however many addresses they carry — a scraped post is not a picture", () => {
    expect(isFanOutUrlItem('{"title":"a post","imageUrl":"https://cdn.example.test/a.jpg?token=1"}')).toBe(false)
    expect(isFanOutUrlItem('[{"url":"https://cdn.example.test/a.jpg?x"}]')).toBe(false)
    expect(isFanOutUrlItem("Read https://news.example.test/story-7 today")).toBe(false)
    expect(isFanOutUrlItem("https://cdn.example.test/a.jpg the caption")).toBe(false)
    expect(isFanOutUrlItem("")).toBe(false)
    expect(isFanOutUrlItem("plain text")).toBe(false)
  })
})

describe("fanOutUrlItemIsText — lanes where a link IS the item", () => {
  it("Save to Collection's `in` keeps a link as the record's link; every other lane keeps the media guess", () => {
    expect(fanOutUrlItemIsText("collection-write", "in")).toBe(true)
    expect(fanOutUrlItemIsText("collection-write", "image")).toBe(false)
    expect(fanOutUrlItemIsText("generate-image", "prompt")).toBe(false)
    expect(fanOutUrlItemIsText(undefined, "in")).toBe(false)
  })

  it("a list of links wired into Save to Collection's `in` DRIVES the fan-out as items (it is a text list there)", () => {
    const links: FanOutCandidate = { targetHandle: "in", aligned: ["https://news.example.test/1", "https://news.example.test/2"] }
    const plan = resolveListFanOut([links], "collection-write")
    expect(plan?.items).toEqual(["https://news.example.test/1", "https://news.example.test/2"])
    expect(plan?.targetHandle).toBe("in")
    // The same list into a prompt lane is a media list: it never supplies the items as prompts.
    const intoPrompt: FanOutCandidate = { targetHandle: "prompt", aligned: links.aligned }
    const text: FanOutCandidate = { targetHandle: "negative", aligned: ["a", "b"] }
    expect(resolveListFanOut([intoPrompt, text], "generate-image")?.targetHandle).toBe("prompt")
  })
})
