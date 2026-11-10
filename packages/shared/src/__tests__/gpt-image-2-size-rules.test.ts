import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, normalizeModelInput, resolutionAtAspectRatio, resolutionsAtAspectRatio } from "../model-catalog.js"
import { resolveNormalizedImageGen } from "../credit-identifiers.js"

/**
 * GPT Image 2 (`gpt-image-2`, `gpt-image-2-i2i`) renders every ratio it offers
 * at every size it lists: "auto" and 1:1 included. It used to carry two size
 * rules ("auto" at 1K only, 1:1 at 1K or 2K) taken from older provider docs;
 * live runs on 2026-11-10 rendered 1:1 at 4K (2880x2880), "auto" at 2K
 * (2048x2048) and an edit at "auto" and 2K (1536x2048 from a 768x1024 photo),
 * each billed as its own size. So nothing is snapped by size, there is no
 * adjustment, and a run is priced at the size it asks for.
 */

const MODELS = ["gpt-image-2", "gpt-image-2-i2i"] as const

/** The price id's size suffix: 1K is the base id. */
const tier = (size: string | undefined) => (size === undefined || size === "1K" ? "" : `:${size}`)

describe.each(MODELS)("%s: every offered ratio renders every size", (model) => {
  const entry = MODEL_CATALOG[model]!
  const ratios = entry.aspectRatios!
  const sizes = entry.resolutions!

  it("offers auto, 1:1, 16:9, 9:16, 4:3 and 3:4 at 1K, 2K and 4K", () => {
    expect(ratios).toEqual(["auto", "1:1", "16:9", "9:16", "4:3", "3:4"])
    expect(sizes).toEqual(["1K", "2K", "4K"])
  })

  it("declares no size rule per ratio", () => {
    expect(entry.resolutionsByAspectRatio).toBeUndefined()
  })

  const cells = ratios.flatMap((ratio) => [undefined, ...sizes].map((size) => [ratio, size ?? null] as const))

  it.each(cells)("ratio %s, size %s: sent as asked, no adjustment, priced at that size", (ratio, sizeOrNull) => {
    const size = sizeOrNull ?? undefined
    const out = normalizeModelInput(model, { aspectRatio: ratio, resolution: size })
    expect(out.aspectRatio).toBe(ratio)
    expect(out.resolution).toBe(size)
    expect(out.adjustments).toEqual([])

    // The price id the image routes reserve, with and without a reference
    // photo (which swaps the text-to-image id to its edit).
    const t2i = resolveNormalizedImageGen({ provider: model, aspectRatio: ratio, resolution: size, refCount: 0, swapToI2i: true })
    expect(t2i.identifier).toBe(`${model}${tier(size)}`)
    const withRef = resolveNormalizedImageGen({ provider: model, aspectRatio: ratio, resolution: size, refCount: 1, swapToI2i: true })
    expect(withRef.identifier).toBe(`gpt-image-2-i2i${tier(size)}`)
  })

  it.each(ratios)("the sizes on offer at %s are all of them, and none moves", (ratio) => {
    expect(resolutionsAtAspectRatio(model, ratio)).toEqual(sizes)
    for (const size of sizes) expect(resolutionAtAspectRatio(model, ratio, size)).toBe(size)
  })

  it("every 2K and 4K price row exists in the catalog", () => {
    const ids = entry.pricing.map((p) => p.identifier)
    for (const size of sizes) expect(ids).toContain(`${model}${tier(size)}`)
  })

  // Off-list values are still the per-lever snaps, and only those: a ratio the
  // model does not offer moves to its first ("auto") and keeps its size; a
  // size it does not list moves to its first (1K). Spelling is canonicalised.
  it.each([
    ["21:9", "4K", "auto", "4K", ["aspectRatio"]],
    ["21:9", "2K", "auto", "2K", ["aspectRatio"]],
    ["1x1", "4K", "auto", "4K", ["aspectRatio"]],
    ["1:1", "8K", "1:1", "1K", ["resolution"]],
    ["1:1", "4k", "1:1", "4K", []],
    ["auto", "2k", "auto", "2K", []],
    ["AUTO", "4K", "auto", "4K", []],
  ] as const)("%s at %s goes as %s at %s", (ratio, size, sentRatio, sentSize, adjusted) => {
    const out = normalizeModelInput(model, { aspectRatio: ratio, resolution: size })
    expect(out.aspectRatio).toBe(sentRatio)
    expect(out.resolution).toBe(sentSize)
    expect(out.adjustments.map((a) => a.field)).toEqual(adjusted)
    const t2i = resolveNormalizedImageGen({ provider: model, aspectRatio: ratio, resolution: size, refCount: 0, swapToI2i: true })
    expect(t2i.identifier).toBe(`${model}${tier(sentSize)}`)
  })
})
