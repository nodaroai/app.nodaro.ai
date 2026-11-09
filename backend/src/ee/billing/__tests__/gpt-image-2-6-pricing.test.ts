// @test-units-by-name looks up only the gpt-image-2-6 credit rows it names
import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { imageCreditIdentifierFor } from "../../../routes/generate-image-credit-id.js"
import { resolveImageToImageCreditIdentifier } from "../../../routes/image-to-image-credit-id.js"
import { gptImage26AutoBaseCredits, gptImage26BaseCredits, gptImage26StaticCosts } from "../gpt-image-2-6-pricing.js"

const T2I = ["gpt-image-2-6-flare", "gpt-image-2-6-sunburst"]
const I2I = ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"]
const QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const
const SIZES = ["1K", "2K", "4K"] as const

describe("GPT Image 2.6 base credits", () => {
  it("is KIE's figure, a prompt and the input images, through the credit conversion, rounded up", () => {
    expect(gptImage26BaseCredits("medium", "1K", 0)).toBe(20)
    expect(gptImage26BaseCredits("low", "1K", 0)).toBe(12)
    expect(gptImage26BaseCredits("high", "4K", 0)).toBe(81)
    expect(gptImage26BaseCredits("medium", "1K", 1)).toBe(26)
    expect(gptImage26BaseCredits("medium", "1K", 16)).toBe(108)
    expect(gptImage26BaseCredits("high", "4K", 16)).toBe(169)
  })

  it("the same row for Flare and Sunburst", () => {
    for (const quality of QUALITIES) for (const size of SIZES) {
      expect(STATIC_CREDIT_COSTS[`gpt-image-2-6-flare:${quality}:${size}`]).toBe(STATIC_CREDIT_COSTS[`gpt-image-2-6-sunburst:${quality}:${size}`])
    }
  })

  it("has a row for every combination, 616 in all", () => {
    expect(Object.keys(gptImage26StaticCosts())).toHaveLength(616)
  })

  it("prices extra high and max by the same formula", () => {
    expect(gptImage26BaseCredits("xhigh", "1K", 0)).toBe(43)
    expect(gptImage26BaseCredits("xhigh", "4K", 0)).toBe(143)
    expect(gptImage26BaseCredits("max", "1K", 0)).toBe(96)
    expect(gptImage26BaseCredits("max", "4K", 0)).toBe(321)
    expect(gptImage26BaseCredits("max", "4K", 16)).toBe(409)
  })

  it("reserves Auto at the Max row, for every size and image count", () => {
    for (const size of SIZES) for (let n = 0; n <= 16; n++) {
      expect(gptImage26BaseCredits("auto", size, n)).toBe(gptImage26BaseCredits("max", size, n))
    }
  })

  it("settles Auto on what KIE billed, through the same conversion", () => {
    expect(gptImage26AutoBaseCredits(7.82)).toBe(20)
    expect(gptImage26AutoBaseCredits(4)).toBe(10)
    expect(gptImage26AutoBaseCredits(4.01)).toBe(11)
    expect(gptImage26AutoBaseCredits(0.01)).toBe(1)
  })

  it("Economy is flat", () => {
    expect(STATIC_CREDIT_COSTS["gpt-image-2-6-economy"]).toBe(13)
    expect(STATIC_CREDIT_COSTS["gpt-image-2-6-economy-i2i"]).toBe(13)
  })

  it("every id a run can be priced on has a row", () => {
    for (const quality of QUALITIES) for (const size of SIZES) {
      for (const id of T2I) expect(STATIC_CREDIT_COSTS[buildCreditModelIdentifier(id, quality, size)], `${id} ${quality} ${size}`).toBeGreaterThan(0)
      for (const id of I2I) for (let n = 1; n <= 16; n++) {
        expect(STATIC_CREDIT_COSTS[buildCreditModelIdentifier(id, quality, size, undefined, undefined, n)], `${id} ${quality} ${size} ${n}`).toBeGreaterThan(0)
      }
    }
  })

  it("the catalog's rows are the rows charged", () => {
    for (const id of [...T2I, ...I2I, "gpt-image-2-6-economy", "gpt-image-2-6-economy-i2i"]) {
      for (const row of MODEL_CATALOG[id]!.pricing) expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })

  it("the existing GPT Image rows did not move", () => {
    expect(STATIC_CREDIT_COSTS["gpt-image-2-5-flare"]).toBe(15)
    expect(STATIC_CREDIT_COSTS["gpt-image-2-5-sunburst-i2i:4K"]).toBe(40)
    expect(STATIC_CREDIT_COSTS["gpt-image-2"]).toBe(15)
  })
})

describe("GPT Image 2.6 in an estimate and at the route", () => {
  it("a node's own images and the wired ones price the run as an edit", () => {
    const node = { id: "a", type: "generate-image", data: { provider: "gpt-image-2-6-flare", quality: "high", resolution: "2K", referenceImageUrls: ["https://a.png"] } }
    expect(getNodeModelIdentifier(node as never, { imageRefsWired: 2 })).toBe("gpt-image-2-6-flare-i2i:high:2K:3ref")
  })

  it("an edit node counts its source image", () => {
    const node = { id: "b", type: "image-to-image", data: { provider: "gpt-image-2-6-sunburst-i2i", quality: "low", resolution: "1K", referenceImageUrls: ["https://a.png"] } }
    expect(getNodeModelIdentifier(node as never, { imageRefsWired: 0 })).toBe("gpt-image-2-6-sunburst-i2i:low:1K:2ref")
  })

  it("no other model is touched by the count", () => {
    const node = { id: "c", type: "generate-image", data: { provider: "flux-2-max", resolution: "2 MP", referenceImageUrls: ["https://a.png"] } }
    expect(getNodeModelIdentifier(node as never, { imageRefsWired: 2 })).toBe("flux-2-max:2MP:0ref")
  })

  it("the route's CHECK prices a transparent run at the size it renders", () => {
    expect(imageCreditIdentifierFor({ provider: "gpt-image-2-6-flare", resolution: "4K", background: "transparent", prompt: "x" }, undefined, undefined))
      .toBe("gpt-image-2-6-flare:medium:1K")
  })

  it("the edit route's CHECK counts the source image with the references", () => {
    const req = { body: { provider: "gpt-image-2-6-flare-i2i", imageUrl: "https://a.png", referenceImageUrls: ["https://b.png", "https://c.png"], quality: "high", resolution: "2K" } }
    expect(resolveImageToImageCreditIdentifier(req as never)).toBe("gpt-image-2-6-flare-i2i:high:2K:3ref")
  })
})

describe("GPT Image 2.6: a base image and wired identities", () => {
  const BASE = "https://cdn.example.com/base.png"
  const REF = "https://cdn.example.com/ref.png"
  const check = (body: Record<string, unknown>) => imageCreditIdentifierFor(body, undefined, undefined)

  it("the route's CHECK counts the base of an edit", () => {
    expect(check({ provider: "gpt-image-2-6-flare", quality: "high", resolution: "4K", baseImageUrl: BASE }))
      .toBe("gpt-image-2-6-flare-i2i:high:4K:1ref")
    expect(check({ provider: "gpt-image-2-6-flare", baseImageUrl: BASE, referenceImageUrls: [REF] }))
      .toBe("gpt-image-2-6-flare-i2i:medium:1K:2ref")
  })

  it("a base already among the references is counted once", () => {
    expect(check({ provider: "gpt-image-2-6-flare", baseImageUrl: BASE, referenceImageUrls: [BASE, REF] }))
      .toBe("gpt-image-2-6-flare-i2i:medium:1K:2ref")
  })

  it("another model's base does not change its price", () => {
    expect(check({ provider: "gpt-image-2-5-flare", baseImageUrl: BASE })).toBe("gpt-image-2-5-flare")
  })

  it("an estimate counts a wired identity, a saved character and a base", () => {
    const node = (data: Record<string, unknown>) => ({ id: "a", type: "generate-image", data: { provider: "gpt-image-2-6-flare", ...data } })
    expect(getNodeModelIdentifier(node({}) as never, { imageRefsWired: 1 })).toBe("gpt-image-2-6-flare-i2i:medium:1K:1ref")
    expect(getNodeModelIdentifier(node({ characterDefinitionIds: ["c1"] }) as never, {})).toBe("gpt-image-2-6-flare-i2i:medium:1K:1ref")
    expect(getNodeModelIdentifier(node({ baseImageUrl: BASE }) as never, {})).toBe("gpt-image-2-6-flare-i2i:medium:1K:1ref")
  })
})
