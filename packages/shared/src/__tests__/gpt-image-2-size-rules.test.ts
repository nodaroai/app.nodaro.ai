import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, normalizeModelInput, resolutionAtAspectRatio, resolutionsAtAspectRatio } from "../model-catalog.js"
import { resolveNormalizedImageGen } from "../credit-identifiers.js"

/**
 * GPT Image 2's two size rules — "auto" renders 1K only, 1:1 does not go to
 * 4K — are catalog data (`resolutionsByAspectRatio` on `gpt-image-2` and
 * `gpt-image-2-i2i`), applied by `normalizeModelInput`'s generic per-ratio
 * step. They used to be a branch of their own in that function, so
 * `/v1/models` and the editor's size menus could not see them.
 *
 * BASELINE: every row below was recorded from the code with that branch,
 * before the rules moved: for each ratio and size asked, the ratio and size
 * sent, whether each was adjusted, and (through the size) the price id. A run
 * must keep sending, and being charged for, exactly that. Only the wording of
 * the 1:1 adjustment changed.
 */

/** [ratio asked, size asked, ratio sent, size sent, ratio adjusted, size adjustment "from>to"] */
type Row = readonly [string | null, string | null, string | null, string | null, boolean, string | null]

const BASELINE: readonly Row[] = [
  [null, null, null, null, false, null],
  [null, "1K", null, "1K", false, null],
  [null, "2K", null, "2K", false, null],
  [null, "4K", null, "4K", false, null],
  [null, "1k", null, "1K", false, null],
  [null, "4k", null, "4K", false, null],
  [null, "8K", null, "1K", false, "8K>1K"],
  ["auto", null, "auto", null, false, null],
  ["auto", "1K", "auto", "1K", false, null],
  ["auto", "2K", "auto", "1K", false, "2K>1K"],
  ["auto", "4K", "auto", "1K", false, "4K>1K"],
  ["auto", "1k", "auto", "1K", false, null],
  ["auto", "4k", "auto", "1K", false, "4K>1K"],
  ["auto", "8K", "auto", "1K", false, "8K>1K"],
  ["AUTO", null, "auto", null, false, null],
  ["AUTO", "1K", "auto", "1K", false, null],
  ["AUTO", "2K", "auto", "1K", false, "2K>1K"],
  ["AUTO", "4K", "auto", "1K", false, "4K>1K"],
  ["AUTO", "1k", "auto", "1K", false, null],
  ["AUTO", "4k", "auto", "1K", false, "4K>1K"],
  ["AUTO", "8K", "auto", "1K", false, "8K>1K"],
  ["Auto", null, "auto", null, false, null],
  ["Auto", "1K", "auto", "1K", false, null],
  ["Auto", "2K", "auto", "1K", false, "2K>1K"],
  ["Auto", "4K", "auto", "1K", false, "4K>1K"],
  ["Auto", "1k", "auto", "1K", false, null],
  ["Auto", "4k", "auto", "1K", false, "4K>1K"],
  ["Auto", "8K", "auto", "1K", false, "8K>1K"],
  ["1:1", null, "1:1", null, false, null],
  ["1:1", "1K", "1:1", "1K", false, null],
  ["1:1", "2K", "1:1", "2K", false, null],
  ["1:1", "4K", "1:1", "2K", false, "4K>2K"],
  ["1:1", "1k", "1:1", "1K", false, null],
  ["1:1", "4k", "1:1", "2K", false, "4K>2K"],
  ["1:1", "8K", "1:1", "1K", false, "8K>1K"],
  ["16:9", null, "16:9", null, false, null],
  ["16:9", "1K", "16:9", "1K", false, null],
  ["16:9", "2K", "16:9", "2K", false, null],
  ["16:9", "4K", "16:9", "4K", false, null],
  ["16:9", "1k", "16:9", "1K", false, null],
  ["16:9", "4k", "16:9", "4K", false, null],
  ["16:9", "8K", "16:9", "1K", false, "8K>1K"],
  ["9:16", null, "9:16", null, false, null],
  ["9:16", "1K", "9:16", "1K", false, null],
  ["9:16", "2K", "9:16", "2K", false, null],
  ["9:16", "4K", "9:16", "4K", false, null],
  ["9:16", "1k", "9:16", "1K", false, null],
  ["9:16", "4k", "9:16", "4K", false, null],
  ["9:16", "8K", "9:16", "1K", false, "8K>1K"],
  ["4:3", null, "4:3", null, false, null],
  ["4:3", "1K", "4:3", "1K", false, null],
  ["4:3", "2K", "4:3", "2K", false, null],
  ["4:3", "4K", "4:3", "4K", false, null],
  ["4:3", "1k", "4:3", "1K", false, null],
  ["4:3", "4k", "4:3", "4K", false, null],
  ["4:3", "8K", "4:3", "1K", false, "8K>1K"],
  ["3:4", null, "3:4", null, false, null],
  ["3:4", "1K", "3:4", "1K", false, null],
  ["3:4", "2K", "3:4", "2K", false, null],
  ["3:4", "4K", "3:4", "4K", false, null],
  ["3:4", "1k", "3:4", "1K", false, null],
  ["3:4", "4k", "3:4", "4K", false, null],
  ["3:4", "8K", "3:4", "1K", false, "8K>1K"],
  ["21:9", null, "auto", null, true, null],
  ["21:9", "1K", "auto", "1K", true, null],
  ["21:9", "2K", "auto", "1K", true, "2K>1K"],
  ["21:9", "4K", "auto", "1K", true, "4K>1K"],
  ["21:9", "1k", "auto", "1K", true, null],
  ["21:9", "4k", "auto", "1K", true, "4K>1K"],
  ["21:9", "8K", "auto", "1K", true, "8K>1K"],
  ["1x1", null, "auto", null, true, null],
  ["1x1", "1K", "auto", "1K", true, null],
  ["1x1", "2K", "auto", "1K", true, "2K>1K"],
  ["1x1", "4K", "auto", "1K", true, "4K>1K"],
  ["1x1", "1k", "auto", "1K", true, null],
  ["1x1", "4k", "auto", "1K", true, "4K>1K"],
  ["1x1", "8K", "auto", "1K", true, "8K>1K"],
]

const MODELS = ["gpt-image-2", "gpt-image-2-i2i"] as const

/** The price id's size suffix: 1K is the base id. */
const tier = (size: string | null) => (size === null || size === "1K" ? "" : `:${size}`)
const arg = (v: string | null) => v ?? undefined

describe.each(MODELS)("%s: every ratio × size runs, and is priced, as before the rules became data", (model) => {
  it.each(BASELINE)("ratio %s, size %s", (ratio, size, sentRatio, sentSize, ratioAdjusted, sizeAdjustment) => {
    const out = normalizeModelInput(model, { aspectRatio: arg(ratio), resolution: arg(size) })
    expect(out.aspectRatio ?? null).toBe(sentRatio)
    expect(out.resolution ?? null).toBe(sentSize)
    expect(out.adjustments.map((a) => a.field)).toEqual([
      ...(ratioAdjusted ? ["aspectRatio"] : []),
      ...(sizeAdjustment ? ["resolution"] : []),
    ])
    const moved = out.adjustments.find((a) => a.field === "resolution")
    expect(moved ? `${moved.from}>${moved.to}` : null).toBe(sizeAdjustment)

    // The price id the image routes reserve: off the snapped size, with and
    // without a reference photo (which swaps the text-to-image id to its edit).
    const t2i = resolveNormalizedImageGen({ provider: model, aspectRatio: arg(ratio), resolution: arg(size), refCount: 0, swapToI2i: true })
    expect(t2i.identifier).toBe(`${model}${tier(sentSize)}`)
    const withRef = resolveNormalizedImageGen({ provider: model, aspectRatio: arg(ratio), resolution: arg(size), refCount: 1, swapToI2i: true })
    expect(withRef.identifier).toBe(`gpt-image-2-i2i${tier(sentSize)}`)
  })
})

describe.each(MODELS)("%s: the rules are catalog data", (model) => {
  it("declares them in resolutionsByAspectRatio", () => {
    expect(MODEL_CATALOG[model]?.resolutionsByAspectRatio).toEqual({ auto: ["1K"], "1:1": ["1K", "2K"] })
  })

  it("the sizes on offer at each ratio follow them", () => {
    expect(resolutionsAtAspectRatio(model, "auto")).toEqual(["1K"])
    expect(resolutionsAtAspectRatio(model, "1:1")).toEqual(["1K", "2K"])
    for (const ratio of ["16:9", "9:16", "4:3", "3:4"]) expect(resolutionsAtAspectRatio(model, ratio)).toEqual(["1K", "2K", "4K"])
  })

  it("a price read with no normalizeModelInput (resolutionAtAspectRatio) now fits the size as a run does", () => {
    for (const [ratio, size, , sentSize] of BASELINE) {
      if (ratio === null || size === null || !MODEL_CATALOG[model]!.aspectRatios!.includes(ratio)) continue
      if (!MODEL_CATALOG[model]!.resolutions!.includes(size)) continue
      expect(resolutionAtAspectRatio(model, ratio, size), `${ratio} ${size}`).toBe(sentSize)
    }
  })

  it("the adjustments say so", () => {
    expect(normalizeModelInput(model, { aspectRatio: "auto", resolution: "2K" }).adjustments[0]?.reason)
      .toBe(`${MODEL_CATALOG[model]!.label} only renders 1K at the "auto" aspect ratio.`)
    expect(normalizeModelInput(model, { aspectRatio: "1:1", resolution: "4K" }).adjustments[0]?.reason)
      .toBe(`${MODEL_CATALOG[model]!.label} only renders 1K or 2K at the "1:1" aspect ratio.`)
  })
})
