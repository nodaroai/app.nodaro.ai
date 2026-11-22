import { describe, it, expect } from "vitest"
import { displayedSize, planImageSize } from "../image-min-size.js"

describe("planImageSize", () => {
  it("a picture at or over the minimum fits, and so does any picture when no minimum is stated", () => {
    expect(planImageSize(300, 300, { minSide: 300 })).toEqual({ kind: "fits" })
    expect(planImageSize(1920, 1080, { minSide: 300, maxSide: 2048 })).toEqual({ kind: "fits" })
    expect(planImageSize(10, 10, {})).toEqual({ kind: "fits" })
  })

  it("enlarges 281×369 so its shorter side is 300 (Kling 4), shape kept", () => {
    const plan = planImageSize(281, 369, { minSide: 300, maxSide: 2048, minRatio: 0.4, maxRatio: 2.5 })
    expect(plan).toEqual({ kind: "enlarge", width: 300, height: 394 })
  })

  it("never lands the shorter side a pixel under the minimum, landscape or portrait", () => {
    for (const [w, h] of [[299, 401], [401, 299], [7, 13], [255, 299], [123, 457]] as const) {
      const plan = planImageSize(w, h, { minSide: 300 })
      expect(plan.kind, `${w}×${h}`).toBe("enlarge")
      if (plan.kind !== "enlarge") continue
      expect(Math.min(plan.width, plan.height), `${w}×${h}`).toBe(300)
      expect(Math.abs(plan.width / plan.height - w / h), `${w}×${h}`).toBeLessThan(0.01)
    }
  })

  it("enlarges a tiny 50×50 picture to the minimum (no smallest starting size)", () => {
    expect(planImageSize(50, 50, { minSide: 300, maxSide: 2048 })).toEqual({ kind: "enlarge", width: 300, height: 300 })
  })

  it("at the max boundary: a long side landing exactly on the maximum is enlarged, one pixel over is refused", () => {
    // 400 px minimum, 2048 px cap: 200×1024 → 400×2048 fits exactly.
    expect(planImageSize(200, 1024, { minSide: 400, maxSide: 2048 })).toEqual({ kind: "enlarge", width: 400, height: 2048 })
    const over = planImageSize(200, 1025, { minSide: 400, maxSide: 2048 })
    expect(over).toMatchObject({ kind: "refuse", reason: "max-side" })
    if (over.kind === "refuse") expect(over.message).toMatch(/longer side 2050/)
  })

  it("a picture over the maximum whose scaled-down copy falls under the minimum is refused, not sent too small", () => {
    // Wan 2.6: 256 px minimum, our 2048 px cap. 2100×260 would go as 2048×254.
    const plan = planImageSize(2100, 260, { minSide: 256, maxSide: 2048 })
    expect(plan).toMatchObject({ kind: "refuse", reason: "max-side" })
    if (plan.kind === "refuse") expect(plan.message).toMatch(/254 pixels/)
    // …while one that stays at the minimum once scaled down fits.
    expect(planImageSize(2100, 263, { minSide: 256, maxSide: 2048 })).toEqual({ kind: "fits" })
  })

  it("an out-of-range shape is refused: no enlarged copy of it can fit the ratio bounds", () => {
    // Kling 2.6 motion: 300 px, 2:5 to 5:2. 100×300 is 1:3, under 2:5.
    const plan = planImageSize(100, 300, { minSide: 300, minRatio: 0.4, maxRatio: 2.5 })
    expect(plan).toMatchObject({ kind: "refuse", reason: "ratio" })
  })

  it("a shape inside the ratio bounds is enlarged even at the bound", () => {
    // 1:2.5 exactly, 120×300 → 300×750.
    expect(planImageSize(120, 300, { minSide: 300, minRatio: 0.4, maxRatio: 2.5 })).toEqual({ kind: "enlarge", width: 300, height: 750 })
  })
})

describe("displayedSize", () => {
  it("swaps the sides of a quarter-turned picture (EXIF 5–8) only", () => {
    expect(displayedSize(20, 10, 6)).toEqual({ width: 10, height: 20 })
    expect(displayedSize(20, 10, 3)).toEqual({ width: 20, height: 10 })
    expect(displayedSize(20, 10, undefined)).toEqual({ width: 20, height: 10 })
  })
})
