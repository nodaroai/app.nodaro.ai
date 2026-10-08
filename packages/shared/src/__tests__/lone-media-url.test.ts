import { describe, it, expect } from "vitest"
import { loneMediaUrlKind, isLoneMediaLinkSource } from "../lone-media-url.js"
import { IMAGE_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES } from "../producer-types.js"

describe("loneMediaUrlKind — one media link, and nothing else", () => {
  it("reads the file name from the path, token or poster query included", () => {
    expect(loneMediaUrlKind("https://cdn4.telesco.pe/file/abc.jpg?token=xyz")).toBe("image")
    expect(loneMediaUrlKind(" https://media.nodaro.ai/images/9b1c.png \n")).toBe("image")
    expect(loneMediaUrlKind("https://cdn.example/x.JPG")).toBe("image")
    expect(loneMediaUrlKind("https://cdn.example/a.webp")).toBe("image")
    expect(loneMediaUrlKind("https://cdn.example/a.gif")).toBe("image")
    expect(loneMediaUrlKind("https://cdn4.telesco.pe/file/clip.mp4?poster=x.jpg")).toBe("video")
    expect(loneMediaUrlKind("https://cdn.example/v/clip.mov")).toBe("video")
    expect(loneMediaUrlKind("https://cdn.example/v/clip.webm")).toBe("video")
  })

  it("a page link is not a medium, even when its host or query looks like a file name", () => {
    for (const link of [
      "https://t.me/somechannel/123",
      "https://www.movistar.es/news/ai",
      "https://www.webmd.com/news/story",
      "https://www.avid.com/pro-tools",
      "https://www.gifs.com/trending",
      "https://www.svgrepo.com/",
      "https://site.com/page?img=a.png",
      "https://site.com/podcast.mp3?cover=art.jpg",
      "https://en.wikipedia.org/wiki/File:Example.jpg/",
    ]) {
      expect(loneMediaUrlKind(link), link).toBeNull()
    }
  })

  it("a format the platforms do not post stays text", () => {
    for (const link of ["https://cdn.example/a.avif", "https://cdn.example/a.heic", "https://cdn.example/a.svg", "https://cdn.example/a.bmp", "https://cdn.example/a.mp3"]) {
      expect(loneMediaUrlKind(link), link).toBeNull()
    }
  })

  it("anything that is not exactly one link is text", () => {
    for (const value of [
      "",
      "   ",
      "Seedance 2 is out https://example.com/demo.png",
      "https://example.com/demo.png looks amazing",
      "https://a.example/x.png,https://b.example/y.png",
      "https://a.example/x.png\nhttps://b.example/y.png",
      '["https://a.example/x.png"]',
      '{"url":"https://a.example/x.png"}',
      "data:image/png;base64,iVBORw0KGgo=",
      "ftp://a.example/x.png",
      "cdn.example/x.png",
      "https://cdn.example/x.png.",
    ]) {
      expect(loneMediaUrlKind(value), JSON.stringify(value)).toBeNull()
    }
  })
})

describe("isLoneMediaLinkSource — the sources whose wire a social post reads as text", () => {
  it("covers the text-shaped nodes", () => {
    for (const type of ["extract-field", "llm-chat", "combine-text", "split-text", "text-prompt", "json-process", "filter-list", "selector", "router", "collection-read", "webhook-trigger"]) {
      expect(isLoneMediaLinkSource(type), type).toBe(true)
    }
  })

  it("excludes every declared media producer, every dynamic producer, the message triggers and the entities", () => {
    for (const type of [...IMAGE_PRODUCER_TYPES, ...VIDEO_PRODUCER_TYPES, ...AUDIO_PRODUCER_TYPES, ...DYNAMIC_PRODUCER_TYPES]) {
      expect(isLoneMediaLinkSource(type), type).toBe(false)
    }
    // A Telegram message's one wire carries its caption AND its photo; the
    // engines route both from the message — the wire's value is never a lone link.
    for (const type of ["character", "object", "creature", "location", "face", "list", "upload-image", "generate-image", "extract-frame", "upload-video", "text-to-speech", "telegram-trigger", "telegram-account-trigger"]) {
      expect(isLoneMediaLinkSource(type), type).toBe(false)
    }
    expect(isLoneMediaLinkSource(undefined)).toBe(false)
    expect(isLoneMediaLinkSource("")).toBe(false)
  })
})
