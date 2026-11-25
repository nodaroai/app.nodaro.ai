// @test-units-by-name looks up only the kling-image-4 credit rows it names
import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { klingImage4BaseCredits, klingImage4StaticCosts } from "../kling-image-4-pricing.js"
import { imageCreditIdentifierFor } from "../../../routes/generate-image-credit-id.js"
import { resolveImageToImageCreditIdentifier } from "../../../routes/image-to-image-credit-id.js"
import {
  plainEntityCheckIdentifier,
  plainEntityCreditIdentifier,
  resolveEntityImageCreditIdentifier,
  workflowEntityCreditIdentifier,
} from "../../../lib/entity-credit-identifier.js"

const T2I = "kling-image-4"
const I2I = "kling-image-4-i2i"
const SIZES = ["2K", "4K", "8K"] as const
const BASE = "https://cdn.example.com/base.png"
const REF = (n: number) => `https://cdn.example.com/ref-${n}.png`

describe("Kling Image 4.0 base credits", () => {
  it("one picture from a prompt: 29 at 2K, 43 at 4K, 71 at 8K", () => {
    expect(klingImage4BaseCredits("2K", 0)).toBe(29)
    expect(klingImage4BaseCredits("4K", 0)).toBe(43)
    expect(klingImage4BaseCredits("8K", 0)).toBe(71)
  })

  it("each input item adds half a KIE credit, summed and then rounded once", () => {
    const at2K: Record<number, number> = { 1: 30, 2: 31, 4: 34, 10: 41 }
    for (const [n, credits] of Object.entries(at2K)) expect(klingImage4BaseCredits("2K", Number(n)), `2K ${n}`).toBe(credits)
    expect(klingImage4BaseCredits("4K", 1)).toBe(44)
    expect(klingImage4BaseCredits("8K", 1)).toBe(72)
    expect(klingImage4BaseCredits("8K", 10)).toBe(84)
  })

  it("a set is that many times one picture's row, never a total rounded once", () => {
    expect(klingImage4BaseCredits("2K", 0, 10)).toBe(290)
    expect(klingImage4BaseCredits("2K", 1, 3)).toBe(90)
    expect(klingImage4BaseCredits("8K", 10, 10)).toBe(840)
  })

  it("has a row for every size, item count and set count, plus the two bare ids", () => {
    const rows = klingImage4StaticCosts()
    // 3 sizes × (1 picture + 9 set counts) × (0 to 10 items) + 2 bare ids.
    expect(Object.keys(rows)).toHaveLength(3 * 10 * 11 + 2)
    expect(rows[T2I]).toBe(29)
    expect(rows[I2I]).toBe(30)
    expect(rows["kling-image-4:2K:x10"]).toBe(290)
    expect(rows["kling-image-4-i2i:4K:5ref:x2"]).toBe(2 * klingImage4BaseCredits("4K", 5))
  })

  it("every id a run can be priced on has a row", () => {
    for (const size of SIZES) {
      for (const set of [undefined, 2, 5, 10, 12]) {
        for (let n = 0; n <= 14; n++) {
          for (const id of [T2I, I2I]) {
            const credit = buildCreditModelIdentifier(id, undefined, size, undefined, undefined, n, undefined, set)
            expect(STATIC_CREDIT_COSTS[credit], credit).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it("the catalog's rows are the rows charged", () => {
    for (const id of [T2I, I2I]) {
      for (const row of MODEL_CATALOG[id]!.pricing) expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })

  it("no Kling Image row is named like a Kling 4.0 video row, and none of those moved", () => {
    const videoRows = Object.keys(STATIC_CREDIT_COSTS).filter((id) => /^kling-4(?:-|:|$)/.test(id))
    expect(videoRows.length).toBeGreaterThan(0)
    for (const id of Object.keys(klingImage4StaticCosts())) expect(videoRows).not.toContain(id)
    expect(STATIC_CREDIT_COSTS["minimax-h3-image:4K"]).toBe(14)
  })
})

describe("Kling Image 4.0: every reserving path sees the size and the input items", () => {
  const check = (body: Record<string, unknown>) => imageCreditIdentifierFor(body, undefined, undefined)

  it("Generate Image's CHECK: a prompt by its size, 2K when none is named", () => {
    expect(check({ provider: T2I, prompt: "x" })).toBe("kling-image-4:2K")
    expect(check({ provider: T2I, prompt: "x", resolution: "4K" })).toBe("kling-image-4:4K")
    expect(check({ provider: T2I, prompt: "x", resolution: "8K" })).toBe("kling-image-4:8K")
    expect(check({ provider: T2I, prompt: "x", resolution: "1K" })).toBe("kling-image-4:2K")
  })

  it("Generate Image's CHECK: references move it to the edit, priced per item, the base counted once", () => {
    expect(check({ provider: T2I, prompt: "x", resolution: "8K", referenceImageUrls: [REF(1), REF(2), REF(3)] })).toBe("kling-image-4-i2i:8K:3ref")
    expect(check({ provider: T2I, prompt: "x", baseImageUrl: BASE, referenceImageUrls: [BASE, REF(1)] })).toBe("kling-image-4-i2i:2K:2ref")
  })

  it("Image to Image's CHECK counts the source with the references", () => {
    const req = { body: { provider: I2I, imageUrl: BASE, referenceImageUrls: [REF(1), REF(2)], resolution: "4K" } }
    expect(resolveImageToImageCreditIdentifier(req as never)).toBe("kling-image-4-i2i:4K:3ref")
  })

  it("a workflow estimate counts the node's own images, the wired ones and an edit's source", () => {
    const gen = { id: "a", type: "generate-image", data: { provider: T2I, resolution: "8K", referenceImageUrls: [REF(1)] } }
    expect(getNodeModelIdentifier(gen as never, { imageRefsWired: 2 })).toBe("kling-image-4-i2i:8K:3ref")
    const plain = { id: "b", type: "generate-image", data: { provider: T2I } }
    expect(getNodeModelIdentifier(plain as never, {})).toBe("kling-image-4:2K")
    const edit = { id: "c", type: "image-to-image", data: { provider: I2I, resolution: "4K", referenceImageUrls: [REF(1)] } }
    expect(getNodeModelIdentifier(edit as never, { imageRefsWired: 0 })).toBe("kling-image-4-i2i:4K:2ref")
  })

  it("a workflow estimate of a set prices its images; a masked node prices one", () => {
    const set = { id: "s", type: "generate-image", data: { provider: T2I, resolution: "2K", imageSetCount: 6 } }
    expect(getNodeModelIdentifier(set as never, {})).toBe("kling-image-4:2K:x6")
    const masked = { id: "m", type: "generate-image", data: { provider: T2I, imageSetCount: 6, baseImageUrl: BASE, maskUrl: REF(9) } }
    expect(getNodeModelIdentifier(masked as never, {})).not.toContain(":x")
  })

  it("the entity routes: face, object, creature, scene and surround price what they send", () => {
    expect(plainEntityCreditIdentifier(T2I, 0)).toBe("kling-image-4:2K")
    expect(plainEntityCreditIdentifier(T2I, 2)).toBe("kling-image-4-i2i:2K:2ref")
    expect(plainEntityCheckIdentifier({ provider: T2I, sourceImageUrl: BASE }, "nano-banana")).toBe("kling-image-4-i2i:2K:1ref")
    expect(plainEntityCheckIdentifier({ provider: T2I }, "nano-banana")).toBe("kling-image-4:2K")
  })

  it("the character and location routes price the size they send and the images they send", () => {
    expect(resolveEntityImageCreditIdentifier({ provider: T2I, resolution: "8K" })).toBe("kling-image-4:8K")
    expect(resolveEntityImageCreditIdentifier({ provider: T2I, resolution: "4K", sourceImageUrl: BASE })).toBe("kling-image-4-i2i:4K:1ref")
    expect(resolveEntityImageCreditIdentifier({ provider: T2I, resolution: "2K" }, 5)).toBe("kling-image-4-i2i:2K:5ref")
  })

  it("a workflow Character node is priced on what its job sends: no size, so 2K", () => {
    expect(workflowEntityCreditIdentifier({ provider: T2I, resolution: "8K" })).toBe("kling-image-4:2K")
    expect(workflowEntityCreditIdentifier({ provider: T2I, sourceImageUrl: BASE })).toBe("kling-image-4-i2i:2K:1ref")
  })
})

describe("the server's workflow estimate counts Kling Image 4.0 input items as the run does", () => {
  const character = (id: string, extra: number) => ({
    id, type: "character",
    data: { characterName: "Kira", defaultAssetUrl: `https://cdn.test/${id}.png`, poses: Array.from({ length: extra }, (_, i) => ({ name: `pose ${i + 1}`, url: `https://cdn.test/${id}-${i}.png` })) },
  })
  const gen = { id: "g", type: "generate-image", data: { provider: "kling-image-4", resolution: "2K" } }
  const graphOf = (nodes: { id: string; type: string; data: unknown }[], edges: { source: string; target: string; targetHandle: string; sourceHandle?: string }[]) =>
    ({ imageRefsWired: edges.length, imageInputGraph: { nodeId: "g", nodes: [gen, ...nodes], edges } })
  const assets = (source: string) => ({ source, target: "g", targetHandle: "assets", sourceHandle: "output" })

  it("a character with 4, 5 or 6 views: 1, 2 or 3 items", () => {
    expect(getNodeModelIdentifier(gen as never, graphOf([character("c", 3)], [assets("c")]))).toBe("kling-image-4-i2i:2K:1ref")
    expect(getNodeModelIdentifier(gen as never, graphOf([character("c", 4)], [assets("c")]))).toBe("kling-image-4-i2i:2K:2ref")
    expect(getNodeModelIdentifier(gen as never, graphOf([character("c", 5)], [assets("c")]))).toBe("kling-image-4-i2i:2K:3ref")
  })

  it("a reference wired twice is one item", () => {
    const upload = { id: "u", type: "upload-image", data: {} }
    const ref = { source: "u", target: "g", targetHandle: "references", sourceHandle: "output" }
    expect(getNodeModelIdentifier(gen as never, graphOf([upload], [ref, ref]))).toBe("kling-image-4-i2i:2K:1ref")
  })
})

describe("8K on a model that does not list it: estimate = hold = charge", () => {
  it("nano-banana-pro at 8K is estimated and held at its 4K row", () => {
    const at = (resolution: string) => getNodeModelIdentifier({ id: "n", type: "generate-image", data: { provider: "nano-banana-pro", resolution } } as never, {})
    expect(at("8K")).toBe(at("4K"))
    expect(imageCreditIdentifierFor({ provider: "nano-banana-pro", resolution: "8K", prompt: "x" }, undefined, undefined)).toBe(at("4K"))
  })
})
