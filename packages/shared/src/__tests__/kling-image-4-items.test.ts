import { describe, expect, it } from "vitest"
import { klingImage4EstimatedItems, klingImage4ItemsFromSubjects } from "../kling-image-4-items.js"
import { pricedEstimatedImages } from "../input-image-pricing.js"

// A Character node with a portrait and `extra` further views (poses).
const character = (id: string, name: string, extra: number) => ({
  id,
  type: "character",
  data: {
    characterName: name,
    defaultAssetUrl: `https://cdn.test/${id}-portrait.png`,
    poses: Array.from({ length: extra }, (_, i) => ({ name: `pose ${i + 1}`, url: `https://cdn.test/${id}-pose-${i + 1}.png` })),
  },
})
const node = { id: "g", type: "generate-image", data: {} }
const assets = (source: string) => ({ source, target: "g", targetHandle: "assets", sourceHandle: "output" })
const items = (nodes: { id: string; type: string; data: unknown }[], edges: { source: string; target: string; targetHandle: string; sourceHandle?: string }[], data: Record<string, unknown> = {}) =>
  klingImage4EstimatedItems("kling-image-4", data, "g", [node, ...nodes], edges)

describe("Kling Image 4.0 input items: the route's count and every estimate's", () => {
  it("a subject is one item of at most 4 views; its further views are plain references", () => {
    expect(klingImage4ItemsFromSubjects(4, [4])).toBe(1)
    expect(klingImage4ItemsFromSubjects(5, [5])).toBe(2)
    expect(klingImage4ItemsFromSubjects(6, [6])).toBe(3)
    expect(klingImage4ItemsFromSubjects(1, [1])).toBe(1)
  })

  it("a wired character with 1, 4, 5 and 6 views", () => {
    expect(items([character("c", "Kira", 0)], [assets("c")])).toBe(1)
    expect(items([character("c", "Kira", 3)], [assets("c")])).toBe(1)
    expect(items([character("c", "Kira", 4)], [assets("c")])).toBe(2)
    expect(items([character("c", "Kira", 5)], [assets("c")])).toBe(3)
  })

  it("a reference wired twice, or listed twice, counts once", () => {
    const upload = { id: "u", type: "upload-image", data: { imageUrl: "https://cdn.test/u.png" } }
    const ref = { source: "u", target: "g", targetHandle: "references", sourceHandle: "output" }
    expect(items([upload], [ref, { ...ref }])).toBe(1)
    expect(items([], [], { referenceImageUrls: ["https://cdn.test/a.png", "https://cdn.test/a.png"] })).toBe(1)
  })

  it("three 4-view characters and a plain reference are four items", () => {
    expect(items([character("a", "Ann", 3), character("b", "Bo", 3), character("c", "Cy", 3)], [assets("a"), assets("b"), assets("c")], { referenceImageUrls: ["https://cdn.test/x.png"] })).toBe(4)
  })

  it("pricedEstimatedImages uses it for Kling with a graph; other models keep their count", () => {
    const graph = { nodeId: "g", nodes: [node, character("c", "Kira", 5)], edges: [assets("c")] }
    expect(pricedEstimatedImages("kling-image-4", {}, 1, graph)).toBe(3)
    expect(pricedEstimatedImages("seedream-5-5", {}, 1, graph)).toBe(1)
  })
})

describe("with the prompt known, a character counts the views the run attaches", () => {
  it("named nowhere: its portrait alone; named by two views: those two", () => {
    const c = character("c", "Kira", 5)
    expect(items([c], [assets("c")], { prompt: "a walk in the park" })).toBe(1)
    expect(items([c], [assets("c")], { prompt: "@kira:1:pose-1 then @kira:1:pose-2" })).toBe(1)
    expect(items([c], [assets("c")], { prompt: "@kira:1 @kira:1:pose-1 @kira:1:pose-2 @kira:1:pose-3 @kira:1:pose-4" })).toBe(2)
  })

  it("a prompt wired in, or a {Label} in it, is not known: every view counts", () => {
    const c = character("c", "Kira", 5)
    expect(items([c], [assets("c"), { source: "t", target: "g", targetHandle: "prompt" }], { prompt: "x" })).toBe(3)
    expect(items([c], [assets("c")], { prompt: "{Scene}" })).toBe(3)
  })

  it("an edit counts its source once, its own or its first image wire", () => {
    expect(klingImage4EstimatedItems("kling-image-4-i2i", { sourceImageUrl: "https://cdn.test/s.png" }, "g", [node], [])).toBe(1)
    expect(klingImage4EstimatedItems("kling-image-4-i2i", {}, "g", [node], [{ source: "u", target: "g", targetHandle: "image" }])).toBe(1)
  })
})

describe("a character the run cannot group", () => {
  it("one with no slug counts each image it sends as its own item, as the run does", () => {
    // A Character node wired by its plain image pip has no slug for the node it feeds.
    const plain = { ...character("c", "Kira", 3), data: { defaultAssetUrl: "https://cdn.test/c.png", poses: [{ name: "pose 1", url: "https://cdn.test/c-0.png" }] } }
    const n = klingImage4EstimatedItems("kling-image-4", {}, "g", [node, plain], [{ source: "c", target: "g", targetHandle: "assets", sourceHandle: "image" }])
    expect(n).toBe(1)
  })
})
