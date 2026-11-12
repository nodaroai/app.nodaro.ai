// @test-units-by-name looks up only the seedream-5-5 credit rows it names
import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { imageCreditIdentifierFor } from "../../../routes/generate-image-credit-id.js"
import { resolveImageToImageCreditIdentifier } from "../../../routes/image-to-image-credit-id.js"
import { plainEntityCheckIdentifier, plainEntityCreditIdentifier, resolveEntityImageParams, workflowEntityCreditIdentifier } from "../../../lib/entity-credit-identifier.js"
import { seedream55BaseCredits, seedream55StaticCosts } from "../seedream-5-5-pricing.js"

const SIZES = ["1K", "1.5K", "2K"] as const
const BASE = "https://cdn.example.com/base.png"
const REF = "https://cdn.example.com/ref.png"

describe("Seedream 5.5 base credits", () => {
  it("text to image: 9 at 1K and 1.5K, 16 at 2K (3.6 and 6.3 KIE credits, ×2.5, rounded up)", () => {
    expect(seedream55BaseCredits("1K", 0)).toBe(9)
    expect(seedream55BaseCredits("1.5K", 0)).toBe(9)
    expect(seedream55BaseCredits("2K", 0)).toBe(16)
  })

  it("an edit adds 1.44 KIE credits per input image, summed before the one rounding", () => {
    // ceil((360 + 144n) × 25 / 1000) at 1K / 1.5K
    expect([1, 2, 4, 10].map((n) => seedream55BaseCredits("1K", n))).toEqual([13, 17, 24, 45])
    expect([1, 2, 4, 10].map((n) => seedream55BaseCredits("1.5K", n))).toEqual([13, 17, 24, 45])
    // ceil((630 + 144n) × 25 / 1000) at 2K
    expect([1, 2, 4, 10].map((n) => seedream55BaseCredits("2K", n))).toEqual([20, 23, 31, 52])
  })

  it("has a row for every size and input image count, and the two bare ids at the default 2K", () => {
    const rows = seedream55StaticCosts()
    expect(Object.keys(rows)).toHaveLength(2 + 3 + 30)
    expect(rows["seedream-5-5"]).toBe(16)
    expect(rows["seedream-5-5-i2i"]).toBe(20)
    for (const [id, credits] of Object.entries(rows)) expect(STATIC_CREDIT_COSTS[id], id).toBe(credits)
  })

  it("every id a run can be priced on has a row", () => {
    for (const size of SIZES) {
      expect(STATIC_CREDIT_COSTS[buildCreditModelIdentifier("seedream-5-5", undefined, size)], size).toBeGreaterThan(0)
      for (let n = 0; n <= 14; n++) {
        expect(STATIC_CREDIT_COSTS[buildCreditModelIdentifier("seedream-5-5-i2i", undefined, size, undefined, undefined, n)], `${size} ${n}`).toBeGreaterThan(0)
        expect(STATIC_CREDIT_COSTS[buildCreditModelIdentifier("seedream-5-5", undefined, size, undefined, undefined, n)], `t2i ${size} ${n}`).toBeGreaterThan(0)
      }
    }
  })

  it("the catalog's rows are the rows charged", () => {
    for (const id of ["seedream-5-5", "seedream-5-5-i2i"]) {
      for (const row of MODEL_CATALOG[id]!.pricing) expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })

  it("the other Seedream rows did not move", () => {
    expect(STATIC_CREDIT_COSTS["seedream-5-flash"]).toBe(10)
    expect(STATIC_CREDIT_COSTS["seedream-5-flash-i2i"]).toBe(10)
    expect(STATIC_CREDIT_COSTS["seedream-5-pro"]).toBe(18)
    expect(STATIC_CREDIT_COSTS["seedream-5-pro-i2i:high"]).toBe(60)
    expect(STATIC_CREDIT_COSTS["seedream-5-lite"]).toBe(14)
    expect(STATIC_CREDIT_COSTS["seedream"]).toBe(16)
  })
})

describe("Seedream 5.5 credit ids", () => {
  it("text to image is priced by its size; none, or a size it does not render, is the default 2K", () => {
    expect(buildCreditModelIdentifier("seedream-5-5", undefined, "1K")).toBe("seedream-5-5:1K")
    expect(buildCreditModelIdentifier("seedream-5-5", undefined, "1.5K")).toBe("seedream-5-5:1.5K")
    expect(buildCreditModelIdentifier("seedream-5-5", undefined, "1.5k")).toBe("seedream-5-5:1.5K")
    expect(buildCreditModelIdentifier("seedream-5-5", undefined, undefined)).toBe("seedream-5-5:2K")
    expect(buildCreditModelIdentifier("seedream-5-5", undefined, "4K")).toBe("seedream-5-5:2K")
    expect(buildCreditModelIdentifier("seedream-5-5", undefined, "2 MP")).toBe("seedream-5-5:2K")
  })

  it("an edit counts its input images, at least its source and at most the 10 sent", () => {
    expect(buildCreditModelIdentifier("seedream-5-5-i2i", undefined, "1K", undefined, undefined, 0)).toBe("seedream-5-5-i2i:1K:1ref")
    expect(buildCreditModelIdentifier("seedream-5-5-i2i", undefined, "2K", undefined, undefined, 4)).toBe("seedream-5-5-i2i:2K:4ref")
    expect(buildCreditModelIdentifier("seedream-5-5-i2i", undefined, "1.5K", undefined, undefined, 14)).toBe("seedream-5-5-i2i:1.5K:10ref")
  })

  it("a text-to-image id sent images is priced as the edit it runs as", () => {
    expect(buildCreditModelIdentifier("seedream-5-5", undefined, "1K", undefined, undefined, 2)).toBe("seedream-5-5-i2i:1K:2ref")
  })
})

describe("Seedream 5.5 on every path that reserves", () => {
  const check = (body: Record<string, unknown>) => imageCreditIdentifierFor(body, undefined, undefined)

  it("the generate-image CHECK: its size, and its references as an edit", () => {
    expect(check({ provider: "seedream-5-5", resolution: "1.5K", prompt: "a red bicycle" })).toBe("seedream-5-5:1.5K")
    expect(check({ provider: "seedream-5-5", prompt: "a red bicycle" })).toBe("seedream-5-5:2K")
    expect(check({ provider: "seedream-5-5", resolution: "1K", referenceImageUrls: [REF, BASE] })).toBe("seedream-5-5-i2i:1K:2ref")
  })

  it("the generate-image CHECK counts the base of an edit, once", () => {
    expect(check({ provider: "seedream-5-5", resolution: "2K", baseImageUrl: BASE })).toBe("seedream-5-5-i2i:2K:1ref")
    expect(check({ provider: "seedream-5-5", baseImageUrl: BASE, referenceImageUrls: [REF] })).toBe("seedream-5-5-i2i:2K:2ref")
    expect(check({ provider: "seedream-5-5", baseImageUrl: BASE, referenceImageUrls: [BASE, REF] })).toBe("seedream-5-5-i2i:2K:2ref")
  })

  it("a size another model does not list moves to one it does, priced as before", () => {
    // 1.5K is in the vocabulary for Seedream 5.5 only: on any other model it snaps to that model's first size.
    expect(check({ provider: "nano-banana-pro", resolution: "1.5K" })).toBe(check({ provider: "nano-banana-pro", resolution: "1K" }))
    expect(check({ provider: "flux", resolution: "1.5K" })).toBe(check({ provider: "flux", resolution: "1K" }))
    expect(check({ provider: "gpt-image-2-6-flare", resolution: "1.5K" })).toBe(check({ provider: "gpt-image-2-6-flare", resolution: "1K" }))
    expect(check({ provider: "seedream-5-flash", resolution: "1.5K" })).toBe("seedream-5-flash")
  })

  it("the image-to-image CHECK counts the source with the references", () => {
    const req = { body: { provider: "seedream-5-5-i2i", imageUrl: BASE, referenceImageUrls: [REF, REF], resolution: "1K", prompt: "make it night" } }
    expect(resolveImageToImageCreditIdentifier(req as never)).toBe("seedream-5-5-i2i:1K:3ref")
  })

  it("a workflow estimate counts a node's own and its wired images", () => {
    const node = (type: string, data: Record<string, unknown>) => ({ id: "a", type, data })
    expect(getNodeModelIdentifier(node("generate-image", { provider: "seedream-5-5", resolution: "1.5K" }) as never, {})).toBe("seedream-5-5:1.5K")
    expect(getNodeModelIdentifier(node("generate-image", { provider: "seedream-5-5" }) as never, {})).toBe("seedream-5-5:2K")
    expect(getNodeModelIdentifier(node("generate-image", { provider: "seedream-5-5", resolution: "2K" }) as never, { imageRefsWired: 3 })).toBe("seedream-5-5-i2i:2K:3ref")
    expect(getNodeModelIdentifier(node("modify-image", { provider: "seedream-5-5-i2i", resolution: "1K", referenceImageUrls: [REF] }) as never, {})).toBe("seedream-5-5-i2i:1K:2ref")
  })

  it("the entity routes: a run with a source image is priced as the edit it runs as", () => {
    // Face, object, creature, their asset routes, surround fill and a Scene send no size (the default 2K).
    expect(plainEntityCreditIdentifier("seedream-5-5", 1)).toBe("seedream-5-5-i2i:2K:1ref")
    expect(plainEntityCreditIdentifier("seedream-5-5", 0)).toBe("seedream-5-5:2K")
    expect(plainEntityCheckIdentifier({ provider: "seedream-5-5", sourceImageUrl: BASE }, "nano-banana-pro")).toBe("seedream-5-5-i2i:2K:1ref")
    // Character and Location send the size they were given, snapped to the model's own.
    expect(resolveEntityImageParams({ provider: "seedream-5-5", resolution: "1.5K", sourceImageUrl: BASE })).toMatchObject({ identifier: "seedream-5-5-i2i:1.5K:1ref", resolution: "1.5K" })
    // A size it does not render lands on its default, 2K, not its first.
    expect(resolveEntityImageParams({ provider: "seedream-5-5", resolution: "4K" }, 3)).toMatchObject({ identifier: "seedream-5-5-i2i:2K:3ref", resolution: "2K" })
    // A workflow Character / Location job carries no size: the default.
    expect(workflowEntityCreditIdentifier({ provider: "seedream-5-5", resolution: "1K", sourceImageUrl: BASE })).toBe("seedream-5-5-i2i:2K:1ref")
  })
})
