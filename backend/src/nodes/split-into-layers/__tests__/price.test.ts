import { describe, it, expect } from "vitest"
import { layerSplitCreditIds } from "@nodaro/render-rules"
import { price } from "../price.ee.js"

/**
 * Split into Layers' rows: a run holds the row for the most images it may
 * return and settles on the row for the images it returned. Each row is the
 * KIE bill (1.44 for the input, 3.6 per image at 1K/1.5K, 6.3 at 2K/auto)
 * converted at 2.5 base credits per KIE credit, summed in hundredths and
 * rounded once.
 */
const KIE_HUNDREDTHS = { input: 144, perImage: { "1k": 360, "2k": 630 } } as const
const base = (tier: "1k" | "2k", images: number) => Math.ceil(((KIE_HUNDREDTHS.input + KIE_HUNDREDTHS.perImage[tier] * images) * 25) / 1000)
/** Today's markup (10%), applied once, rounded up. */
const charged = (b: number) => Math.ceil((b * 110) / 100)

describe("split-into-layers price", () => {
  it("one row per tier and image count (1–100), each the formula, plus the bare row at the default hold", () => {
    const ids = layerSplitCreditIds("split-into-layers")
    expect(ids).toHaveLength(200)
    expect(Object.keys(price.staticCosts).sort()).toEqual(["split-into-layers", ...ids].sort())
    for (const tier of ["1k", "2k"] as const) {
      for (let k = 1; k <= 100; k++) expect(price.staticCosts[`split-into-layers:${tier}:${k}` as keyof typeof price.staticCosts], `${tier}:${k}`).toBe(base(tier, k))
    }
    expect(price.staticCosts["split-into-layers"]).toBe(price.staticCosts["split-into-layers:1k:10"])
  })

  it("the worked examples: base and charged at today's 10%", () => {
    const row = (id: string) => price.staticCosts[id as keyof typeof price.staticCosts]
    // The default hold: 9 layers at 1K (10 images).
    expect(row("split-into-layers:1k:10")).toBe(94)
    expect(charged(94)).toBe(104)
    // 3 layers returned (4 images) at 1K, then at 2K / auto.
    expect([row("split-into-layers:1k:4"), charged(row("split-into-layers:1k:4"))]).toEqual([40, 44])
    expect([row("split-into-layers:2k:4"), charged(row("split-into-layers:2k:4"))]).toEqual([67, 74])
    // Max layers 5 at 1K holds 6 images.
    expect([row("split-into-layers:1k:6"), charged(row("split-into-layers:1k:6"))]).toEqual([58, 64])
    // A base-only run.
    expect(row("split-into-layers:1k:1")).toBe(13)
    expect(row("split-into-layers:2k:1")).toBe(20)
    // The extremes.
    expect(row("split-into-layers:1k:100")).toBe(904)
    expect(row("split-into-layers:2k:100")).toBe(1579)
  })

  it("the row a run holds follows its settings: the size's tier at Max layers + 1", () => {
    const id = price.creditId!
    expect(id({})).toBe("split-into-layers:1k:10")
    expect(id({ size: "1.5K", maxLayers: 5 })).toBe("split-into-layers:1k:6")
    expect(id({ size: "2K", maxLayers: 3 })).toBe("split-into-layers:2k:4")
    expect(id({ size: "auto", maxLayers: 99 })).toBe("split-into-layers:2k:100")
    // Out of range or junk settles to the bounds and the defaults.
    expect(id({ size: "4K", maxLayers: 500 })).toBe("split-into-layers:1k:100")
    expect(id({ maxLayers: 0 })).toBe("split-into-layers:1k:2")
    expect(id({ maxLayers: "7" })).toBe("split-into-layers:1k:8")
  })
})
