import { describe, it, expect } from "vitest"
import { buildPromptHelperNodeContext } from "../prompt-helper-context"

const img = (id: string, url: string) => ({
  id, type: "generate-image",
  data: { generatedResults: [{ url }], activeResultIndex: 0 },
})
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

describe("buildPromptHelperNodeContext", () => {
  it("counts wired image sources (existing behavior preserved)", () => {
    const ctx = buildPromptHelperNodeContext("v1",
      [img("i1", "https://a.png"), { id: "v1", type: "generate-video", data: {} }],
      [edge("i1", "v1")], "generate-video")
    expect(ctx?.referenceImageCount).toBe(1)
    expect(ctx?.referenceImageUrls).toEqual(["https://a.png"])
  })

  it("counts a wired character node's image", () => {
    const ctx = buildPromptHelperNodeContext("v1",
      [
        { id: "c1", type: "character", data: { sourceImageUrl: "https://char.png" } },
        { id: "v1", type: "generate-video", data: {} },
      ],
      [edge("c1", "v1")], "generate-video")
    expect(ctx?.referenceImageCount).toBe(1)
    expect(ctx?.connectedInputTypes).toContain("character")
  })

  it("counts the node's own manual referenceImageUrls and dedupes against wired", () => {
    const ctx = buildPromptHelperNodeContext("v1",
      [
        img("i1", "https://a.png"),
        { id: "v1", type: "generate-video", data: { referenceImageUrls: [
          { id: "m1", url: "https://manual.png" },
          { id: "m2", url: "https://a.png" }, // duplicate of wired
        ] } },
      ],
      [edge("i1", "v1")], "generate-video")
    expect(ctx?.referenceImageCount).toBe(2)
    expect(ctx?.referenceImageUrls).toEqual(["https://a.png", "https://manual.png"])
  })

  it("returns undefined for text-prompt and for nodes with no context", () => {
    expect(buildPromptHelperNodeContext("t1", [{ id: "t1", type: "text-prompt", data: {} }], [], "text-prompt")).toBeUndefined()
    expect(buildPromptHelperNodeContext("v1", [{ id: "v1", type: "generate-video", data: {} }], [], "generate-video")).toBeUndefined()
  })
})
