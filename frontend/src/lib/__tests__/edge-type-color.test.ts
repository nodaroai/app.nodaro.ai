import { describe, it, expect } from "vitest"
import { getEdgeTypeColor } from "../edge-type-color"
import { HANDLE_COLORS } from "../handle-colors"

describe("getEdgeTypeColor", () => {
  it("colors picker outputs by their family", () => {
    // text-prompt is a picker whose family is `text`.
    expect(getEdgeTypeColor("text-prompt", "prompt")).toBe(HANDLE_COLORS.text)
  })

  it("colors by the per-node output registry (disambiguates multi-output nodes)", () => {
    expect(getEdgeTypeColor("llm-chat", "text")).toBe(HANDLE_COLORS.text)
    expect(getEdgeTypeColor("generate-image", "image")).toBe(HANDLE_COLORS.image)
    expect(getEdgeTypeColor("text-to-speech", "audio")).toBe(HANDLE_COLORS.audio)
    // generate-script is multi-output: each wire matches its own handle.
    expect(getEdgeTypeColor("generate-script", "dialogue")).toBe(HANDLE_COLORS.text)
    expect(getEdgeTypeColor("generate-script", "images")).toBe(HANDLE_COLORS.image)
    expect(getEdgeTypeColor("generate-script", "scenes")).toBe(HANDLE_COLORS.video)
    // Entity refs match their OWN node's pip color, not a unified identity:
    // character=pink, object=emerald, location=cyan, face=orange.
    expect(getEdgeTypeColor("character", "characterRef")).toBe(HANDLE_COLORS.identity)
    expect(getEdgeTypeColor("object", "objectRef")).toBe(HANDLE_COLORS.imageRef)
    expect(getEdgeTypeColor("location", "locationRef")).toBe(HANDLE_COLORS.image)
    // faceRef is the `face` node's OUTPUT (it's an input on face-swap).
    expect(getEdgeTypeColor("face", "faceRef")).toBe(HANDLE_COLORS.face)
  })

  it("disambiguates the reused `out` handle id per source node", () => {
    // The same handle id means different types on different nodes — only a
    // per-node registry can resolve this.
    expect(getEdgeTypeColor("sort-list", "out")).toBe(HANDLE_COLORS.list)
    expect(getEdgeTypeColor("reduce", "out")).toBe(HANDLE_COLORS.control)
    expect(getEdgeTypeColor("save-to-storage", "out")).toBe(HANDLE_COLORS.approve)
  })

  it("reflects the corrected mis-colored outputs", () => {
    expect(getEdgeTypeColor("llm-chat", "items")).toBe(HANDLE_COLORS.list)
    expect(getEdgeTypeColor("forced-alignment", "data")).toBe(HANDLE_COLORS.look)
    expect(getEdgeTypeColor("video-retake", "video")).toBe(HANDLE_COLORS.video)
  })

  it("leaves runtime-typed and unknown sources neutral (undefined)", () => {
    expect(getEdgeTypeColor(undefined, null)).toBeUndefined()
    expect(getEdgeTypeColor("definitely-not-a-node", "out")).toBeUndefined()
    // sub-workflow ports are typed per mediaType at runtime — not statically known.
    expect(getEdgeTypeColor("sub-workflow", "out_abc")).toBeUndefined()
  })
})
