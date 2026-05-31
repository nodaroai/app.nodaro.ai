import { describe, it, expect } from "vitest"
import { getEdgeTypeColor } from "../edge-type-color"
import { HANDLE_COLORS } from "../handle-colors"

describe("getEdgeTypeColor", () => {
  it("colors picker outputs by their family", () => {
    // text-prompt is a picker whose family is `text`.
    expect(getEdgeTypeColor("text-prompt", "prompt")).toBe(HANDLE_COLORS.text)
  })

  it("colors by output handle id (disambiguates multi-output nodes)", () => {
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
    expect(getEdgeTypeColor("face-swap", "faceRef")).toBe(HANDLE_COLORS.face)
  })

  it("falls back to undefined for unknown sources", () => {
    expect(getEdgeTypeColor(undefined, null)).toBeUndefined()
    expect(getEdgeTypeColor("definitely-not-a-node", "out")).toBeUndefined()
  })
})
