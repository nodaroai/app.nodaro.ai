import { describe, expect, it } from "vitest"
import { imageSetFailSafe, imageSetRangeFor } from "../model-options"
import { buildCreditModelIdentifier } from "../helpers"

describe("a node's set (Kling Image 4.0) follows its model", () => {
  it("only a model that makes sets has a range", () => {
    expect(imageSetRangeFor("kling-image-4")).toEqual({ min: 2, max: 10 })
    expect(imageSetRangeFor("kling-image-4-i2i")).toEqual({ min: 2, max: 10 })
    expect(imageSetRangeFor("seedream-5-5")).toBeUndefined()
    expect(imageSetRangeFor(undefined)).toBeUndefined()
  })

  it("is cleared on a model without sets, moved into range on one with them, else left alone", () => {
    expect(imageSetFailSafe("seedream-5-5", { imageSetCount: 4 })).toEqual({ imageSetCount: undefined })
    expect(imageSetFailSafe(undefined, { imageSetCount: 4 })).toEqual({ imageSetCount: undefined })
    expect(imageSetFailSafe("kling-image-4", { imageSetCount: 14 })).toEqual({ imageSetCount: 10 })
    expect(imageSetFailSafe("kling-image-4", { imageSetCount: 4 })).toEqual({})
    expect(imageSetFailSafe("seedream-5-5", {})).toEqual({})
  })

  it("the editor's price reads the set, and a masked node prices one picture", () => {
    expect(buildCreditModelIdentifier("kling-image-4", { resolution: "4K", imageSetCount: 3 })).toBe("kling-image-4:4K:x3")
    expect(buildCreditModelIdentifier("kling-image-4", { resolution: "8K" })).toBe("kling-image-4:8K")
    expect(buildCreditModelIdentifier("kling-image-4", { imageSetCount: 3, maskUrl: "https://cdn.example.com/m.png" })).not.toContain(":x")
    expect(buildCreditModelIdentifier("seedream-5-5", { resolution: "2K", imageSetCount: 3 })).toBe("seedream-5-5:2K")
  })
})

describe("the editor's price for Kling Image 4.0 counts a wired character as one item", () => {
  it("a character on the assets handle is one input item, however many of its views the run sends", () => {
    // `countImageInputEdges` counts an identity node on the assets handle once.
    expect(buildCreditModelIdentifier("kling-image-4", { resolution: "2K" }, 1)).toBe("kling-image-4-i2i:2K:1ref")
    expect(buildCreditModelIdentifier("kling-image-4", { resolution: "2K" }, 3)).toBe("kling-image-4-i2i:2K:3ref")
  })
})

describe("the editor's badge counts Kling Image 4.0 input items as the run does", () => {
  const character = (extra: number) => ({
    id: "c", type: "character",
    data: { characterName: "Kira", defaultAssetUrl: "https://cdn.test/c.png", poses: Array.from({ length: extra }, (_, i) => ({ name: `pose ${i + 1}`, url: `https://cdn.test/c-${i}.png` })) },
  })
  const gen = { id: "g", type: "generate-image", data: {} }
  const edges = [{ source: "c", target: "g", targetHandle: "assets", sourceHandle: "output" }]
  it("a character with 5 views is 2 items, 6 views 3; a reference wired twice is one", () => {
    expect(buildCreditModelIdentifier("kling-image-4", { resolution: "2K" }, 1, undefined, { nodeId: "g", nodes: [gen, character(4)], edges })).toBe("kling-image-4-i2i:2K:2ref")
    expect(buildCreditModelIdentifier("kling-image-4", { resolution: "2K" }, 1, undefined, { nodeId: "g", nodes: [gen, character(5)], edges })).toBe("kling-image-4-i2i:2K:3ref")
    const ref = { source: "u", target: "g", targetHandle: "references", sourceHandle: "output" }
    expect(buildCreditModelIdentifier("kling-image-4", { resolution: "2K" }, 2, undefined, { nodeId: "g", nodes: [gen, { id: "u", type: "upload-image", data: {} }], edges: [ref, ref] })).toBe("kling-image-4-i2i:2K:1ref")
  })
})

describe("the badge prices 8K on a model that does not list it at its largest size", () => {
  it("nano-banana-pro at 8K is priced as at 4K", () => {
    expect(buildCreditModelIdentifier("nano-banana-pro", { resolution: "8K" })).toBe(buildCreditModelIdentifier("nano-banana-pro", { resolution: "4K" }))
    expect(buildCreditModelIdentifier("nano-banana-pro", { resolution: "4K" })).toContain("4K")
  })
})
