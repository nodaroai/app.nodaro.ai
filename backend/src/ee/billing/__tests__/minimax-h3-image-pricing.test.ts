// @test-units-by-name looks up only the minimax-h3-image credit rows it names
import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { minimaxH3ImageBaseCredits, minimaxH3ImageStaticCosts } from "../minimax-h3-image-pricing.js"
import { imageCreditIdentifierFor } from "../../../routes/generate-image-credit-id.js"
import { resolveImageToImageCreditIdentifier } from "../../../routes/image-to-image-credit-id.js"
import {
  plainEntityCheckIdentifier,
  plainEntityCreditIdentifier,
  resolveEntityImageCreditIdentifier,
  workflowEntityCreditIdentifier,
} from "../../../lib/entity-credit-identifier.js"

const T2I = "minimax-h3-image"
const I2I = "minimax-h3-image-i2i"
const SIZES = ["1K", "2K", "4K"] as const
const BASE = "https://cdn.example.com/base.png"
const REF = (n: number) => `https://cdn.example.com/ref-${n}.png`

describe("MiniMax H3 Image base credits", () => {
  it("from a prompt: the same at 1K and 2K, more at 4K", () => {
    expect(minimaxH3ImageBaseCredits("1K", 0)).toBe(5)
    expect(minimaxH3ImageBaseCredits("2K", 0)).toBe(5)
    expect(minimaxH3ImageBaseCredits("4K", 0)).toBe(14)
  })

  it("an edit adds each reference image, summed and then rounded once", () => {
    const at2K = { 1: 6, 2: 7, 3: 9, 4: 10, 8: 15, 16: 25 }
    for (const [n, credits] of Object.entries(at2K)) {
      expect(minimaxH3ImageBaseCredits("2K", Number(n)), `2K ${n}`).toBe(credits)
      expect(minimaxH3ImageBaseCredits("1K", Number(n)), `1K ${n}`).toBe(credits)
    }
    const at4K = { 1: 15, 2: 17, 4: 19, 8: 24, 16: 34 }
    for (const [n, credits] of Object.entries(at4K)) {
      expect(minimaxH3ImageBaseCredits("4K", Number(n)), `4K ${n}`).toBe(credits)
    }
  })

  it("has a row for every size from a prompt and every size and reference count for an edit, plus the two bare ids", () => {
    const rows = minimaxH3ImageStaticCosts()
    expect(Object.keys(rows)).toHaveLength(2 + 3 + 3 * 16)
    expect(rows[T2I]).toBe(5)
    expect(rows[I2I]).toBe(6)
  })

  it("every id a run can be priced on has a row", () => {
    for (const size of SIZES) {
      expect(STATIC_CREDIT_COSTS[buildCreditModelIdentifier(T2I, undefined, size)], `${T2I} ${size}`).toBeGreaterThan(0)
      for (let n = 0; n <= 20; n++) {
        expect(STATIC_CREDIT_COSTS[buildCreditModelIdentifier(I2I, undefined, size, undefined, undefined, n)], `${I2I} ${size} ${n}`).toBeGreaterThan(0)
        expect(STATIC_CREDIT_COSTS[buildCreditModelIdentifier(T2I, undefined, size, undefined, undefined, n)], `${T2I} ${size} ${n}`).toBeGreaterThan(0)
      }
    }
  })

  it("the catalog's rows are the rows charged", () => {
    for (const id of [T2I, I2I]) {
      for (const row of MODEL_CATALOG[id]!.pricing) expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })

  it("no existing row moved, the MiniMax H3 video rows included", () => {
    expect(STATIC_CREDIT_COSTS["minimax-h3"]).toBe(550)
    expect(STATIC_CREDIT_COSTS["seedream-5-flash"]).toBe(10)
    expect(STATIC_CREDIT_COSTS["gpt-image-2-6-flare:medium:1K"]).toBe(20)
  })

  it("no image row is named like a MiniMax H3 video row", () => {
    const videoRows = Object.keys(STATIC_CREDIT_COSTS).filter((id) => id === "minimax-h3" || id.startsWith("minimax-h3:"))
    expect(videoRows.length).toBeGreaterThan(0)
    for (const id of Object.keys(minimaxH3ImageStaticCosts())) expect(videoRows).not.toContain(id)
  })
})

describe("MiniMax H3 Image: every reserving path sees the size and the images", () => {
  const check = (body: Record<string, unknown>) => imageCreditIdentifierFor(body, undefined, undefined)

  it("Generate Image's CHECK: a prompt by its size, 2K when none is named", () => {
    expect(check({ provider: T2I, prompt: "x" })).toBe("minimax-h3-image:2K")
    expect(check({ provider: T2I, prompt: "x", resolution: "1K" })).toBe("minimax-h3-image:1K")
    expect(check({ provider: T2I, prompt: "x", resolution: "4K" })).toBe("minimax-h3-image:4K")
  })

  it("Generate Image's CHECK: references move it to the edit, priced per reference", () => {
    expect(check({ provider: T2I, prompt: "x", resolution: "4K", referenceImageUrls: [REF(1), REF(2), REF(3)] }))
      .toBe("minimax-h3-image-i2i:4K:3ref")
  })

  it("Generate Image's CHECK counts the base of an edit, once", () => {
    expect(check({ provider: T2I, prompt: "x", baseImageUrl: BASE })).toBe("minimax-h3-image-i2i:2K:1ref")
    expect(check({ provider: T2I, prompt: "x", baseImageUrl: BASE, referenceImageUrls: [REF(1)] })).toBe("minimax-h3-image-i2i:2K:2ref")
    expect(check({ provider: T2I, prompt: "x", baseImageUrl: BASE, referenceImageUrls: [BASE, REF(1)] })).toBe("minimax-h3-image-i2i:2K:2ref")
  })

  it("Image to Image's CHECK counts the source with the references", () => {
    const req = { body: { provider: I2I, imageUrl: BASE, referenceImageUrls: [REF(1), REF(2)], resolution: "4K" } }
    expect(resolveImageToImageCreditIdentifier(req as never)).toBe("minimax-h3-image-i2i:4K:3ref")
  })

  it("a workflow estimate counts the node's own images, the wired ones and an edit's source", () => {
    const gen = { id: "a", type: "generate-image", data: { provider: T2I, resolution: "4K", referenceImageUrls: [REF(1)] } }
    expect(getNodeModelIdentifier(gen as never, { imageRefsWired: 2 })).toBe("minimax-h3-image-i2i:4K:3ref")
    const plain = { id: "b", type: "generate-image", data: { provider: T2I } }
    expect(getNodeModelIdentifier(plain as never, {})).toBe("minimax-h3-image:2K")
    const edit = { id: "c", type: "image-to-image", data: { provider: I2I, resolution: "1K", referenceImageUrls: [REF(1)] } }
    expect(getNodeModelIdentifier(edit as never, { imageRefsWired: 0 })).toBe("minimax-h3-image-i2i:1K:2ref")
  })

  it("the entity routes: face, object, creature, scene and surround price what they send", () => {
    expect(plainEntityCreditIdentifier(T2I, 0)).toBe("minimax-h3-image:2K")
    expect(plainEntityCreditIdentifier(T2I, 2)).toBe("minimax-h3-image-i2i:2K:2ref")
    expect(plainEntityCheckIdentifier({ provider: T2I, sourceImageUrl: BASE }, "nano-banana")).toBe("minimax-h3-image-i2i:2K:1ref")
    expect(plainEntityCheckIdentifier({ provider: T2I }, "nano-banana")).toBe("minimax-h3-image:2K")
  })

  it("the character and location routes price the size they send and the images they send", () => {
    expect(resolveEntityImageCreditIdentifier({ provider: T2I, resolution: "4K" })).toBe("minimax-h3-image:4K")
    expect(resolveEntityImageCreditIdentifier({ provider: T2I, resolution: "4K", sourceImageUrl: BASE })).toBe("minimax-h3-image-i2i:4K:1ref")
    expect(resolveEntityImageCreditIdentifier({ provider: T2I, resolution: "1K" }, 5)).toBe("minimax-h3-image-i2i:1K:5ref")
  })

  it("a workflow Character node is priced on what its job sends: no size, so 2K", () => {
    expect(workflowEntityCreditIdentifier({ provider: T2I, resolution: "4K" })).toBe("minimax-h3-image:2K")
    expect(workflowEntityCreditIdentifier({ provider: T2I, sourceImageUrl: BASE })).toBe("minimax-h3-image-i2i:2K:1ref")
  })
})
