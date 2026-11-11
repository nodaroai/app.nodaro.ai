import { describe, it, expect } from "vitest"
import { GPT_IMAGE_2_KIE_CREDITS, KIE_CREDIT_USD, KIE_IMAGE_MODELS, MINIMAX_H3_IMAGE_KIE_HUNDREDTHS, MINIMAX_H3_IMAGE_REFERENCE_KIE_HUNDREDTHS } from "../models.js"
import { expectedKieCreditsFor, kieImageCostUsd, kieTaskCreditsConsumed } from "../image-cost.js"

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

describe("kieTaskCreditsConsumed", () => {
  const record = (fields: Record<string, unknown>) => ({ code: 200, message: "success", data: { taskId: "t1", ...fields } })

  it("reads the figure from the task inside the record, as a number or a string", () => {
    expect(kieTaskCreditsConsumed(record({ creditsConsumed: 9.5 }))).toBe(9.5)
    expect(kieTaskCreditsConsumed(record({ creditsConsumed: "12" }))).toBe(12)
    expect(kieTaskCreditsConsumed(record({ consumeCredits: 3 }))).toBe(3)
  })

  it("is undefined for a record without a usable figure", () => {
    expect(kieTaskCreditsConsumed(undefined)).toBeUndefined()
    expect(kieTaskCreditsConsumed({})).toBeUndefined()
    expect(kieTaskCreditsConsumed(record({}))).toBeUndefined()
    expect(kieTaskCreditsConsumed(record({ creditsConsumed: 0 }))).toBeUndefined()
    expect(kieTaskCreditsConsumed(record({ creditsConsumed: "many" }))).toBeUndefined()
  })
})

describe("kieImageCostUsd: Seedream 5.5", () => {
  const config = (id: string) => ({ ...KIE_IMAGE_MODELS[id]!, cost: 0.123 })

  it("text to image: 3.6 KIE credits at 1K and 1.5K, 6.3 at 2K, its default when none is sent", () => {
    expect(kieImageCostUsd("seedream-5-5", config("seedream-5-5"), "1K")).toBeCloseTo(3.6 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("seedream-5-5", config("seedream-5-5"), "1.5K")).toBeCloseTo(3.6 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("seedream-5-5", config("seedream-5-5"), "2K")).toBeCloseTo(6.3 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("seedream-5-5", config("seedream-5-5"), undefined)).toBeCloseTo(6.3 * KIE_CREDIT_USD, 10)
  })

  it("an edit adds 1.44 KIE credits for each input image sent, at least its source", () => {
    // KIE's own example: a 2K edit with two inputs is 6.3 + 2 × 1.44 = 9.18.
    expect(kieImageCostUsd("seedream-5-5-i2i", config("seedream-5-5-i2i"), "2K", 2)).toBeCloseTo(9.18 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("seedream-5-5-i2i", config("seedream-5-5-i2i"), "1K", 10)).toBeCloseTo(18 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("seedream-5-5-i2i", config("seedream-5-5-i2i"), "1.5K", 0)).toBeCloseTo(5.04 * KIE_CREDIT_USD, 10)
  })

  it("the model entries state the default: 2K, and an edit with its one source", () => {
    expect(KIE_IMAGE_MODELS["seedream-5-5"]!.credits).toBe(6.3)
    expect(KIE_IMAGE_MODELS["seedream-5-5-i2i"]!.credits).toBeCloseTo(7.74, 10)
  })
})

describe("kieImageCostUsd: MiniMax H3 Image", () => {
  const t2i = KIE_IMAGE_MODELS["minimax-h3-image"]!
  const i2i = KIE_IMAGE_MODELS["minimax-h3-image-i2i"]!

  it("is KIE's figure per picture: 1.8 KIE credits at 1K or 2K, 5.5 at 4K, 0.5 more per reference image", () => {
    expect(MINIMAX_H3_IMAGE_KIE_HUNDREDTHS).toEqual({ "1K": 180, "2K": 180, "4K": 550 })
    expect(MINIMAX_H3_IMAGE_REFERENCE_KIE_HUNDREDTHS).toBe(50)
  })

  it("a prompt is priced by the size sent, KIE's 2K when none is", () => {
    expect(kieImageCostUsd("minimax-h3-image", t2i, "1K")).toBeCloseTo(1.8 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("minimax-h3-image", t2i, "4K")).toBeCloseTo(5.5 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("minimax-h3-image", t2i, "4k")).toBeCloseTo(5.5 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("minimax-h3-image", t2i, undefined)).toBeCloseTo(1.8 * KIE_CREDIT_USD, 10)
  })

  it("an edit adds every reference image sent", () => {
    expect(kieImageCostUsd("minimax-h3-image-i2i", i2i, "2K", 1)).toBeCloseTo(2.3 * KIE_CREDIT_USD, 10)
    expect(kieImageCostUsd("minimax-h3-image-i2i", i2i, "4K", 16)).toBeCloseTo(13.5 * KIE_CREDIT_USD, 10)
  })

  it("the entries state the 2K figure, an edit's with one reference", () => {
    expect(t2i.credits).toBe(1.8)
    expect(t2i.cost).toBeCloseTo(1.8 * KIE_CREDIT_USD, 10)
    expect(i2i.credits).toBe(2.3)
    expect(i2i.cost).toBeCloseTo(2.3 * KIE_CREDIT_USD, 10)
  })
})

describe("expectedKieCreditsFor — the credit audit's expected figure", () => {
  it("is every image entry's own figure at its own listed cost: nothing changes for a price that never varies", () => {
    for (const [id, config] of Object.entries(KIE_IMAGE_MODELS)) {
      // At the default size with one input image: the figure each entry states.
      expect(expectedKieCreditsFor(config, kieImageCostUsd(id, config, undefined, 1)), id).toBe(
        id === "gpt-image-2" || id === "gpt-image-2-i2i" ? GPT_IMAGE_2_KIE_CREDITS["1K"] : config.credits,
      )
    }
  })

  it("follows what was sent: GPT Image 2 by size, MiniMax H3 Image by size and references", () => {
    const gpt2 = KIE_IMAGE_MODELS["gpt-image-2"]!
    expect(expectedKieCreditsFor(gpt2, kieImageCostUsd("gpt-image-2", gpt2, "2K"))).toBe(10)
    expect(expectedKieCreditsFor(gpt2, kieImageCostUsd("gpt-image-2", gpt2, "4K"))).toBe(16)
    const edit = KIE_IMAGE_MODELS["minimax-h3-image-i2i"]!
    expect(expectedKieCreditsFor(edit, kieImageCostUsd("minimax-h3-image-i2i", edit, "4K", 16))).toBe(13.5)
    expect(expectedKieCreditsFor(edit, kieImageCostUsd("minimax-h3-image-i2i", edit, "2K", 3))).toBe(3.3)
    const t2i = KIE_IMAGE_MODELS["minimax-h3-image"]!
    expect(expectedKieCreditsFor(t2i, kieImageCostUsd("minimax-h3-image", t2i, "4K"))).toBe(5.5)
  })
})
