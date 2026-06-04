import { describe, it, expect } from "vitest"
import { getFocusedNodeMedia } from "@/lib/focused-node-media"

describe("getFocusedNodeMedia", () => {
  it("returns the active video result with the full results array for the carousel", () => {
    const node = {
      type: "generate-video",
      data: { generatedResults: [{ url: "v1" }, { url: "v2" }], activeResultIndex: 1 },
    }
    expect(getFocusedNodeMedia(node)).toEqual({
      type: "video",
      url: "v2",
      results: [
        { url: "v1", type: "video" },
        { url: "v2", type: "video" },
      ],
      initialIndex: 1,
    })
  })

  it("returns a single image result", () => {
    const node = {
      type: "generate-image",
      data: { generatedResults: [{ url: "i1" }], activeResultIndex: 0 },
    }
    expect(getFocusedNodeMedia(node)).toEqual({
      type: "image",
      url: "i1",
      results: [{ url: "i1", type: "image" }],
      initialIndex: 0,
    })
  })

  it("falls back to the single-field URL when generatedResults is empty (audio)", () => {
    const node = {
      type: "text-to-audio",
      data: { generatedResults: [], generatedAudioUrl: "a1" },
    }
    expect(getFocusedNodeMedia(node)).toEqual({
      type: "audio",
      url: "a1",
      results: [{ url: "a1", type: "audio" }],
      initialIndex: 0,
    })
  })

  it("clamps a streaming activeResultIndex of -1 to 0", () => {
    const node = {
      type: "generate-image",
      data: { generatedResults: [{ url: "i1" }, { url: "i2" }], activeResultIndex: -1 },
    }
    const media = getFocusedNodeMedia(node)
    expect(media?.initialIndex).toBe(0)
    expect(media?.url).toBe("i1")
  })

  it("clamps an out-of-range activeResultIndex to the last result", () => {
    const node = {
      type: "generate-image",
      data: { generatedResults: [{ url: "i1" }, { url: "i2" }], activeResultIndex: 9 },
    }
    const media = getFocusedNodeMedia(node)
    expect(media?.initialIndex).toBe(1)
    expect(media?.url).toBe("i2")
  })

  it("returns null for a text-only node (no media output)", () => {
    const node = { type: "generate-script", data: { generatedResults: [{ text: "hello" }] } }
    expect(getFocusedNodeMedia(node)).toBeNull()
  })

  it("returns null when the node has no results at all", () => {
    const node = { type: "generate-image", data: {} }
    expect(getFocusedNodeMedia(node)).toBeNull()
  })

  it("returns null for an unknown node type", () => {
    const node = { type: "totally-unknown", data: { generatedResults: [{ url: "x" }] } }
    expect(getFocusedNodeMedia(node)).toBeNull()
  })

  it("ignores result entries that have no url (e.g. mask-shaped results)", () => {
    const node = {
      type: "generate-image",
      data: { generatedResults: [{ imageUrl: "m1", maskUrl: "m2" }] },
    }
    expect(getFocusedNodeMedia(node)).toBeNull()
  })

  it("returns null for a null or undefined node", () => {
    expect(getFocusedNodeMedia(null)).toBeNull()
    expect(getFocusedNodeMedia(undefined)).toBeNull()
  })
})
