/**
 * The cover a flow gets when nobody picked one.
 *
 * The rule that matters and is easy to get wrong: a flow is named by what it
 * ENDS with, not by what it has most of. Three image nodes feeding one video
 * node is a video flow, and counting would call it an image flow.
 */
import { describe, expect, it } from "vitest"
import { COVER_VARIANTS, EMPTY_FLOW_COVER, coverVariantForNodeTypes, nodeTypesOf } from "../workflow-cover"

describe("coverVariantForNodeTypes", () => {
  it("gives an empty flow the one fixed default", () => {
    expect(coverVariantForNodeTypes([])).toBe(EMPTY_FLOW_COVER)
  })

  it("treats an unknown graph the same as an empty one — no wrong guess", () => {
    expect(coverVariantForNodeTypes(null)).toBe(EMPTY_FLOW_COVER)
    expect(coverVariantForNodeTypes(undefined)).toBe(EMPTY_FLOW_COVER)
  })

  it("names a flow by what it ends with, not by what it has most of", () => {
    const imageHeavy = ["generate-image", "generate-image", "generate-image", "image-to-video"]
    expect(coverVariantForNodeTypes(imageHeavy)).toBe(coverVariantForNodeTypes(["image-to-video"]))
  })

  it("separates the four media so a grid of cover-less cards is still readable", () => {
    const looks = new Set([
      coverVariantForNodeTypes(["image-to-video"]),
      coverVariantForNodeTypes(["text-to-speech"]),
      coverVariantForNodeTypes(["generate-image"]),
      coverVariantForNodeTypes(["ai-writer"]),
    ])
    expect(looks.size).toBe(4)
  })

  it("keeps a flow of pure parameters distinct from an empty canvas", () => {
    const variant = coverVariantForNodeTypes(["setting", "mood"])
    expect(variant).not.toBe(EMPTY_FLOW_COVER)
  })

  it("is stable — the same flow always looks the same", () => {
    const types = ["text", "generate-image"]
    expect(coverVariantForNodeTypes(types)).toBe(coverVariantForNodeTypes([...types].reverse()))
  })

  it("only ever returns a colourway the placeholder can render", () => {
    for (const types of [[], ["generate-image"], ["image-to-video"], ["nonsense-node"], ["setting"]]) {
      expect(COVER_VARIANTS).toContain(coverVariantForNodeTypes(types))
    }
  })
})

describe("nodeTypesOf", () => {
  it("returns the distinct types of a graph", () => {
    const nodes = [{ type: "text" }, { type: "generate-image" }, { type: "text" }]
    expect(nodeTypesOf(nodes).sort()).toEqual(["generate-image", "text"])
  })

  it("agrees with what the database trigger stores — no type, no entry", () => {
    expect(nodeTypesOf([{ type: "" }, {}, null, { type: 7 }, { type: "text" }])).toEqual(["text"])
  })

  it("survives anything that is not a graph", () => {
    expect(nodeTypesOf(null)).toEqual([])
    expect(nodeTypesOf("nodes")).toEqual([])
    expect(nodeTypesOf({ nodes: [] })).toEqual([])
  })
})
