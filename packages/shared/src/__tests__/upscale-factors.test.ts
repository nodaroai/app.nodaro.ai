import { describe, it, expect } from "vitest"
import {
  NODARO_IMAGE_UPSCALE_DEFAULT_FACTOR,
  NODARO_IMAGE_UPSCALE_FACTORS,
  UPSCALE_FACTORS,
  resolveNodaroImageUpscaleFactor,
  resolveTopazUpscale,
  resolveUpscaleFactor,
  snappedUpscaleFactor,
  TOPAZ_UPSCALE_FACTORS,
  upscaleFactorsFor,
} from "../entries/credits.js"
import { HOUSE_ONLY_UPSCALE_FACTORS } from "../upscale-factors.js"
import { buildCreditModelIdentifier } from "../credit-identifiers.js"
import { MODEL_CATALOG } from "../model-catalog.js"
import { IMAGE_EDIT_PROVIDERS, UPSCALE_IMAGE_PROVIDERS } from "../model-constants.js"

describe("the factors each upscaler takes", () => {
  it("Nodaro Image Upscale takes 1 / 2 / 4 / 8, default 2; Topaz keeps 1 / 2 / 4; Recraft takes none", () => {
    expect(NODARO_IMAGE_UPSCALE_FACTORS).toEqual(["1", "2", "4", "8"])
    expect(NODARO_IMAGE_UPSCALE_DEFAULT_FACTOR).toBe("2")
    expect(upscaleFactorsFor("nodaro-image-upscale")).toEqual(["1", "2", "4", "8"])
    expect(upscaleFactorsFor("topaz-image-upscale")).toEqual(TOPAZ_UPSCALE_FACTORS)
    expect(TOPAZ_UPSCALE_FACTORS).toEqual(["1", "2", "4"])
    expect(upscaleFactorsFor("recraft-upscale")).toBeUndefined()
  })

  it("UPSCALE_FACTORS is every factor any upscaler takes", () => {
    const union = new Set(UPSCALE_IMAGE_PROVIDERS.flatMap((p) => upscaleFactorsFor(p) ?? []))
    expect([...UPSCALE_FACTORS].sort()).toEqual([...union].sort())
  })
})

describe("resolveNodaroImageUpscaleFactor / resolveUpscaleFactor", () => {
  it("a listed factor is rendered as given; anything else at 2", () => {
    for (const f of ["1", "2", "4", "8"]) expect(resolveNodaroImageUpscaleFactor(f)).toBe(f)
    expect(resolveNodaroImageUpscaleFactor(" 8 ")).toBe("8")
    expect(resolveNodaroImageUpscaleFactor(4)).toBe("4")
    for (const f of [undefined, null, "", "3", "16", "8K", 0]) expect(resolveNodaroImageUpscaleFactor(f)).toBe("2")
  })

  it("Topaz resolves exactly as resolveTopazUpscale (8 still renders at 2, a legacy tier still maps)", () => {
    for (const upscaleFactor of [undefined, "1", "2", "4", "8"]) {
      for (const targetResolution of [undefined, "2K", "4K", "8K"]) {
        expect(resolveUpscaleFactor("topaz-image-upscale", { upscaleFactor, targetResolution })).toBe(
          resolveTopazUpscale({ upscaleFactor, targetResolution }).upscaleFactor,
        )
      }
    }
  })

  it("Nodaro Image Upscale never reads a stored tier; a model with no factor list is sent its value as before, never an 8", () => {
    expect(resolveUpscaleFactor("nodaro-image-upscale", { targetResolution: "4K" })).toBe("2")
    // As it always was: a stored or mapped 1/2/4 is passed on.
    expect(resolveUpscaleFactor("recraft-upscale", { upscaleFactor: "4" })).toBe("4")
    expect(resolveUpscaleFactor("nano-banana-edit", { upscaleFactor: "2" })).toBe("2")
    expect(resolveUpscaleFactor("grok-2-edit", { upscaleFactor: "1" })).toBe("1")
    expect(resolveUpscaleFactor("recraft-upscale", {})).toBeUndefined()
    // Only the house model takes 8: a node kept from it never sends it elsewhere.
    expect(resolveUpscaleFactor("recraft-upscale", { upscaleFactor: "8" })).toBeUndefined()
    expect(resolveUpscaleFactor(undefined, { upscaleFactor: "8" })).toBeUndefined()
    expect(HOUSE_ONLY_UPSCALE_FACTORS).toEqual(["8"])
  })
})

describe("snappedUpscaleFactor (the editor's fail-safe on a model switch)", () => {
  it("a Nodaro Image Upscale 8x switched to Topaz runs, and is stored, at 2x", () => {
    expect(snappedUpscaleFactor("topaz-image-upscale", { upscaleFactor: "8" })).toBe("2")
  })

  it("a Nodaro Image Upscale 8x switched to Recraft (or to no model, which runs as Recraft) keeps no factor", () => {
    expect(snappedUpscaleFactor("recraft-upscale", { upscaleFactor: "8" })).toBeNull()
    expect(snappedUpscaleFactor(undefined, { upscaleFactor: "8" })).toBeNull()
  })

  it("a saved Recraft node's own 1/2/4 stands, as it always did", () => {
    for (const f of ["1", "2", "4"]) expect(snappedUpscaleFactor("recraft-upscale", { upscaleFactor: f }), f).toBeUndefined()
  })

  it("a factor the new model takes, or no factor stored: nothing to change", () => {
    expect(snappedUpscaleFactor("nodaro-image-upscale", { upscaleFactor: "4" })).toBeUndefined()
    expect(snappedUpscaleFactor("topaz-image-upscale", { upscaleFactor: "4" })).toBeUndefined()
    expect(snappedUpscaleFactor("topaz-image-upscale", {})).toBeUndefined()
    expect(snappedUpscaleFactor("recraft-upscale", {})).toBeUndefined()
    expect(snappedUpscaleFactor("nodaro-image-upscale", { upscaleFactor: "3" })).toBe("2")
  })
})

describe("the catalog and the provider lists", () => {
  it("Nodaro Image Upscale is an own-label image upscaler, priced by output tier with a hold", () => {
    const entry = MODEL_CATALOG["nodaro-image-upscale"]!
    expect(entry).toMatchObject({ kind: "image", modes: ["upscale"], ownLabel: true, family: "Nodaro Upscale", series: "Nodaro Upscale", label: "Nodaro Image Upscale" })
    expect(entry).not.toHaveProperty("maker")
    expect(entry.pricing.map((p) => [p.identifier, p.credits])).toEqual([
      ["nodaro-image-upscale:2K", 4],
      ["nodaro-image-upscale:4K", 10],
      ["nodaro-image-upscale:8K", 30],
      ["nodaro-image-upscale", 30],
    ])
    expect(IMAGE_EDIT_PROVIDERS).toContain("nodaro-image-upscale")
    expect(UPSCALE_IMAGE_PROVIDERS).toContain("nodaro-image-upscale")
  })

  it("the shared builder prices it at the hold — the size-aware id is built from the image's size, never a stored tier", () => {
    expect(buildCreditModelIdentifier("nodaro-image-upscale", undefined, undefined, undefined, "4K")).toBe("nodaro-image-upscale")
  })
})
