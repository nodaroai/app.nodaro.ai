/**
 * How a fan-out item lands on a node's inputs: text feeds the prompt, a media
 * link feeds the matching media field — except on a lane where a link IS the
 * item (Save to Collection's `in`), and never for JSON that merely carries an
 * address (review finding H3, 2026-10-06).
 */
import { describe, expect, it } from "vitest"
import type { ResolvedInputs } from "../../services/workflow-engine/types.js"
import { overrideInputWithListItem } from "../list-item-override.js"

const apply = (item: string, lane?: { nodeType: string; targetHandle: string }): ResolvedInputs => {
  const inputs: ResolvedInputs = {}
  overrideInputWithListItem(inputs, item, lane)
  return inputs
}

describe("overrideInputWithListItem", () => {
  it("text is the prompt and the override; a media link is the matching media field and never a prompt", () => {
    expect(apply("write about autumn")).toEqual({ prompt: "write about autumn", overridePrompt: "write about autumn" })
    expect(apply("https://cdn.example.test/a.jpg?token=1")).toEqual({ imageUrl: "https://cdn.example.test/a.jpg?token=1" })
    expect(apply("https://cdn.example.test/clip.mp4")).toEqual({ videoUrl: "https://cdn.example.test/clip.mp4" })
    expect(apply("https://cdn.example.test/voice.mp3")).toEqual({ audioUrl: "https://cdn.example.test/voice.mp3" })
  })

  it("a scraped post's JSON with an image address inside is TEXT — the prompt, not a picture", () => {
    const post = JSON.stringify({ title: "A post", imageUrl: "https://cdn.example.test/a.jpg?token=1", text: "Body" })
    expect(apply(post, { nodeType: "llm-chat", targetHandle: "prompt" })).toEqual({ prompt: post, overridePrompt: post })
  })

  it("on Save to Collection's `in`, a link stays the item (the record's link); on its `image` lane it is a picture", () => {
    const link = "https://news.example.test/story-7"
    expect(apply(link, { nodeType: "collection-write", targetHandle: "in" })).toEqual({ prompt: link, overridePrompt: link })
    expect(apply("https://cdn.example.test/cover.jpg", { nodeType: "collection-write", targetHandle: "image" })).toEqual({ imageUrl: "https://cdn.example.test/cover.jpg" })
  })

  it("an empty cell overrides nothing", () => {
    expect(apply("   ")).toEqual({})
  })
})
