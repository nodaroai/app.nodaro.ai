import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { resolveNodeInputs } from "../node-input-resolver"

// A social post's text-shaped wire whose WHOLE value is one media LINK — a
// path ending in a file name the platforms post — carries the medium, not the
// caption: a publisher reading an article's stored cover through Extract Field
// posts the picture (decided 2026-10-08). A sentence with a link in it, a page
// link, or a format no platform posts stays the caption. The rule is
// @nodaro/shared's (`loneMediaUrlKind`, `isLoneMediaLinkSource`) — the same
// pre-pass the backend input-resolver runs; its cases mirror
// `backend/src/services/workflow-engine/__tests__/input-resolver.test.ts`.

const SOCIAL_TYPES = ["telegram-post", "x-post", "instagram-post", "facebook-post", "linkedin-post", "tiktok-post", "youtube-upload", "publish-social"]

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): any {
  return { id, type, data: { label: type, ...data }, position: { x: 0, y: 0 } }
}

function makeEdge(source: string, target: string, sourceHandle?: string): any {
  return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle: "in" }
}

const resolve = (sourceType: string, text: string, targetType = "telegram-post", data: Record<string, unknown> = {}) => {
  const src = makeNode("s", sourceType, { text, extractedText: text })
  const target = makeNode("t", targetType, data)
  return resolveNodeInputs(target, [src, target], [makeEdge("s", "t", sourceType === "extract-field" ? "text" : undefined)])
}

describe("social post nodes: a text wire that is ONE media link carries the medium", () => {
  it("a lone image link from Extract Field lands as the photo, not the caption — on every social post type", () => {
    const url = " https://cdn4.telesco.pe/file/abc.jpg?token=xyz "
    for (const type of SOCIAL_TYPES) {
      const inputs = resolve("extract-field", url, type)
      expect(inputs.imageUrl, type).toBe(url.trim())
      expect(inputs.prompt, type).toBeUndefined()
    }
  })

  it("a lone video link lands as the video", () => {
    const url = "https://cdn4.telesco.pe/file/clip.mp4?poster=x.jpg"
    const inputs = resolve("text-prompt", url)
    expect(inputs.videoUrl).toBe(url)
    expect(inputs.prompt).toBeUndefined()
  })

  it("a lone media link into a NON-social consumer is still its text", () => {
    const url = "https://cdn4.telesco.pe/file/abc.jpg"
    const inputs = resolve("text-prompt", url, "llm-chat")
    expect(inputs.prompt).toBe(url)
    expect(inputs.imageUrl).toBeUndefined()
  })

  it("a sentence with a link, a page link, a host that merely looks like a file name, and a format no platform posts stay the caption", () => {
    for (const text of [
      "Seedance 2 is out https://example.com/demo.png",
      "https://example.com/demo.png looks amazing",
      "https://t.me/somechannel/123",
      "https://www.movistar.es/news/ai",
      "https://site.com/page?img=a.png",
      "https://cdn.example/images/cover.avif",
      "Just the news.",
    ]) {
      const inputs = resolve("text-prompt", text)
      expect(inputs.prompt, text).toBe(text)
      expect(inputs.imageUrl, text).toBeUndefined()
      expect(inputs.videoUrl, text).toBeUndefined()
    }
  })

  it("a text-only action keeps the link as its text", () => {
    const url = "https://media.nodaro.ai/images/9b1c.png"
    const inputs = resolve("text-prompt", url, "linkedin-post", { action: "post-text" })
    expect(inputs.prompt).toBe(url)
    expect(inputs.imageUrl).toBeUndefined()
  })

  it("a real image wire is never displaced by a text-derived link, whichever comes first", () => {
    const real = "https://media.nodaro.ai/images/real.png"
    const other = "https://media.nodaro.ai/images/other.png"
    const img = makeNode("i", "upload-image", { url: real })
    const src = makeNode("s", "text-prompt", { text: other })
    const target = makeNode("t", "telegram-post")
    for (const edges of [
      [makeEdge("i", "t"), makeEdge("s", "t")],
      [makeEdge("s", "t"), makeEdge("i", "t")],
    ]) {
      const inputs = resolveNodeInputs(target, [img, src, target], edges)
      expect(inputs.imageUrl).toBe(real)
    }
  })

  it("a one-row List holding a link keeps its own routing (the rule is for text-shaped sources only)", () => {
    // List is a dynamic producer: its typed columns route by column type, and
    // its Instagram carousel items must keep reaching `mediaItems`.
    const url = "https://media.nodaro.ai/images/9b1c.png"
    const list = makeNode("l", "list", { items: url })
    const target = makeNode("t", "instagram-post", { action: "post-carousel" })
    const inputs = resolveNodeInputs(target, [list, target], [makeEdge("l", "t")])
    expect(inputs.imageUrl).toBeUndefined()
  })
})
