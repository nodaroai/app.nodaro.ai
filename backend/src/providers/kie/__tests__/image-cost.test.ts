import { describe, it, expect } from "vitest"
import { GPT_IMAGE_2_KIE_CREDITS, KIE_CREDIT_USD, KIE_IMAGE_MODELS } from "../models.js"
import { kieImageCostUsd } from "../image-cost.js"

const GPT_IMAGE_2_IDS = ["gpt-image-2", "gpt-image-2-i2i"]

describe("GPT_IMAGE_2_KIE_CREDITS", () => {
  it("is what KIE bills for one picture at each resolution, in KIE credits", () => {
    expect(GPT_IMAGE_2_KIE_CREDITS).toEqual({ "1K": 6, "2K": 10, "4K": 16 })
  })

  it("the two model entries state its 1K figure", () => {
    for (const id of GPT_IMAGE_2_IDS) {
      expect(KIE_IMAGE_MODELS[id]!.credits, id).toBe(GPT_IMAGE_2_KIE_CREDITS["1K"])
      expect(KIE_IMAGE_MODELS[id]!.cost, id).toBe(GPT_IMAGE_2_KIE_CREDITS["1K"] * KIE_CREDIT_USD)
    }
  })
})

describe("kieImageCostUsd", () => {
  // A config whose own figure matches nothing billed: an answer equal to a
  // billed figure can only have come from the table.
  const config = (id: string) => ({ ...KIE_IMAGE_MODELS[id]!, cost: 0.123 })

  it.each(GPT_IMAGE_2_IDS)("%s: each resolution sent is its own figure", (id) => {
    expect(kieImageCostUsd(id, config(id), "1K")).toBe(6 * KIE_CREDIT_USD)
    expect(kieImageCostUsd(id, config(id), "2K")).toBe(10 * KIE_CREDIT_USD)
    expect(kieImageCostUsd(id, config(id), "4K")).toBe(16 * KIE_CREDIT_USD)
  })

  it.each(GPT_IMAGE_2_IDS)("%s: no resolution on the wire is KIE's default, 1K", (id) => {
    expect(kieImageCostUsd(id, config(id), undefined)).toBe(6 * KIE_CREDIT_USD)
  })

  // IMAGE_RESOLUTION_VALUES carries megapixel values, and the wire field is not
  // typed; an inherited key must not read as a figure either.
  it.each(["1 MP", "8K", "4k", "", "constructor", "toString", 4])(
    "a resolution the table does not name (%s) keeps the config's figure, never NaN",
    (resolution) => {
      expect(kieImageCostUsd("gpt-image-2", config("gpt-image-2"), resolution)).toBe(0.123)
    },
  )

  it.each(["nano-banana-pro", "gpt-image-2-5-flare", "gpt-image-2-5-sunburst-i2i", "gpt-image"])(
    "%s keeps its config's figure at every resolution",
    (id) => {
      for (const resolution of ["1K", "2K", "4K", undefined]) {
        expect(kieImageCostUsd(id, config(id), resolution)).toBe(0.123)
      }
    },
  )
})
