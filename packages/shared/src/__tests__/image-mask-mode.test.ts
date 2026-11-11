import { describe, it, expect } from "vitest"
import { I2I_MASK_SUPPORT, IMAGE_GEN_PROVIDERS, MODIFY_IMAGE_PROVIDERS } from "../model-constants.js"
import { IMAGE_MASK_MODE } from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"

describe("IMAGE_MASK_MODE", () => {
  it("has an entry for every image-gen provider (completeness invariant)", () => {
    const missing = IMAGE_GEN_PROVIDERS.filter((p) => IMAGE_MASK_MODE[p] === undefined)
    expect(missing).toEqual([])
  })

  it("only uses prompt|composite in Phase 1 (native is reserved for Phase 1.5)", () => {
    const values = new Set(Object.values(IMAGE_MASK_MODE))
    expect(values.has("native")).toBe(false)
    for (const v of values) expect(["prompt", "composite"]).toContain(v)
  })
})

describe("I2I_MASK_SUPPORT (the image-to-image models that take a mask of their own)", () => {
  it("lists GPT Image 2.6 Flare and Sunburst edits beside Ideogram Edit and FLUX Fill", () => {
    expect([...I2I_MASK_SUPPORT].sort()).toEqual([
      "flux-fill",
      "gpt-image-2-6-flare-i2i",
      "gpt-image-2-6-sunburst-i2i",
      "ideogram-edit",
    ])
  })

  it("leaves out the GPT Image edits that take no mask", () => {
    for (const id of ["gpt-image-2-6-economy-i2i", "gpt-image-2-5-flare-i2i", "gpt-image-2-5-sunburst-i2i", "gpt-image-2-i2i"]) {
      expect(I2I_MASK_SUPPORT.has(id)).toBe(false)
    }
  })

  it("names only models /v1/image-to-image takes", () => {
    expect([...I2I_MASK_SUPPORT].filter((id) => !(MODIFY_IMAGE_PROVIDERS as readonly string[]).includes(id))).toEqual([])
  })

  // One way only: FLUX Fill takes a mask but has no catalog entry.
  it("holds every catalog entry that lists the mask feature", () => {
    const listed = Object.values(MODEL_CATALOG).filter((m) => m.features?.includes("mask")).map((m) => m.id)
    expect(listed.filter((id) => !I2I_MASK_SUPPORT.has(id))).toEqual([])
  })

  it("is listed with the mask feature by every catalog entry it names", () => {
    const inCatalog = [...I2I_MASK_SUPPORT].filter((id) => MODEL_CATALOG[id] !== undefined)
    expect(inCatalog.filter((id) => !MODEL_CATALOG[id]!.features?.includes("mask"))).toEqual([])
  })
})
