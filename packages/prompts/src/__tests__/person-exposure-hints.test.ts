import { describe, it, expect } from "vitest"
import { buildPersonHints } from "../person.js"
import { buildStylingHints } from "../styling.js"

/**
 * Content-rejection hardening (app_reports batch, 2026-07-18): skin-exposure
 * and lipstick clauses COMPOUND in providers' output-safety classifiers when
 * the analyzer fills several overlapping dimensions from one photo. These
 * tests pin the two de-stacking rules.
 */

describe("exposure hint collapsing", () => {
  it("midriff + navel together fold into ONE neutral clause", () => {
    const hints = buildPersonHints({
      distinctiveFeature: ["feature-midriff-visible", "feature-navel-visible"],
    } as never)
    const exposure = hints.filter((h) => /midriff|navel|stomach/i.test(h))
    expect(exposure).toEqual(["wearing a cropped style, midriff and navel visible"])
  })

  it("each alone keeps its own (softened, garment-language) hint", () => {
    const midriffOnly = buildPersonHints({
      distinctiveFeature: ["feature-midriff-visible"],
    } as never)
    expect(midriffOnly).toContain("wearing a cropped style with the midriff visible")
    expect(midriffOnly.join(" ")).not.toMatch(/bare stomach/i)

    const navelOnly = buildPersonHints({
      distinctiveFeature: ["feature-navel-visible"],
    } as never)
    expect(navelOnly).toContain("with the navel visible")
    expect(navelOnly.join(" ")).not.toMatch(/bare stomach/i)
  })

  it("other distinctive features still emit alongside the collapsed pair", () => {
    const hints = buildPersonHints({
      distinctiveFeature: [
        "feature-midriff-visible",
        "feature-navel-visible",
        "feature-freckles",
      ],
    } as never)
    expect(hints.filter((h) => /midriff/i.test(h))).toHaveLength(1)
    expect(hints.length).toBeGreaterThan(1)
  })
})

describe("bold-lips cross-catalog dedupe", () => {
  it("skips makeup-bold-lips when the shared map already carries lip-state-bold-red", () => {
    const hints = buildStylingHints({
      makeup: "makeup-bold-lips",
      lipState: ["lip-state-bold-red"],
    } as never)
    expect(hints.join(" ")).not.toMatch(/bold lips/i)
  })

  it("keeps makeup-bold-lips without the person clause (separate-node consumers)", () => {
    const hints = buildStylingHints({ makeup: "makeup-bold-lips" } as never)
    expect(hints.join(" ")).toMatch(/bold lips/i)
  })
})
