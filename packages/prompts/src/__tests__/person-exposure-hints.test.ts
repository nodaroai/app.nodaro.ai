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
    const exposure = hints.filter((h) => /cropped hemline|navel|stomach/i.test(h))
    expect(exposure).toEqual(["with a cropped hemline and the navel showing"])
  })

  it("each alone keeps its own (softened, garment-language) hint", () => {
    const midriffOnly = buildPersonHints({
      distinctiveFeature: ["feature-midriff-visible"],
    } as never)
    expect(midriffOnly).toContain("with a cropped hemline")
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
    expect(hints.filter((h) => /cropped hemline/i.test(h))).toHaveLength(1)
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

describe("cropped-clause de-stack across the person↔styling boundary (W1-b)", () => {
  it("the midriff person clause suppresses BOTH styling cropped twins on the shared bag", () => {
    const hints = buildStylingHints({
      distinctiveFeature: ["feature-midriff-visible"],
      top: "top-crop-top",
      wardrobeState: ["state-cropped"],
    } as never)
    const joined = hints.join(", ")
    expect(joined).not.toMatch(/cropped top|cropped above the midriff/i)
  })

  it("without the person clause, the garment wins and the modifier yields", () => {
    const hints = buildStylingHints({
      top: "top-crop-top",
      wardrobeState: ["state-cropped"],
    } as never)
    const joined = hints.join(", ")
    expect(joined).toMatch(/wearing a cropped top that ends above the midriff/i)
    expect(joined).not.toMatch(/the top cropped above the midriff with the stomach visible/i)
  })

  it("a MINOR who picks midriff + crop-top still gets exactly one cropped clause", () => {
    // The person clause is dropped by the floor (feature-midriff-visible is
    // adultOnly), so the styling twin must NOT be suppressed — otherwise the
    // floor silently deletes a garment detail instead of a body detail.
    const hints = buildStylingHints({
      age: "age-child",
      distinctiveFeature: ["feature-midriff-visible"],
      top: "top-crop-top",
    } as never)
    expect(hints.join(", ")).toMatch(/wearing a cropped top that ends above the midriff/i)
  })

  it("either styling id alone is untouched (no person clause, no twin)", () => {
    expect(buildStylingHints({ wardrobeState: ["state-cropped"] } as never).join(", "))
      .toMatch(/the top cropped above the midriff/i)
    expect(buildStylingHints({ top: "top-crop-top" } as never).join(", "))
      .toMatch(/wearing a cropped top/i)
  })

  it("de-stacks a BARE-STRING wardrobeState too, not just the array form", () => {
    // `wardrobeState` is a single-pick-or-multi field (string | string[]), and
    // `normalizeSubjectFields` unwraps a lone array pick to a bare string
    // before the styling collector ever sees it — the single-pick case is the
    // common one, not an edge case, so the suppression must not be array-only.
    const hints = buildStylingHints({
      distinctiveFeature: "feature-midriff-visible",
      top: "top-crop-top",
      wardrobeState: "state-cropped",
    } as never)
    const joined = hints.join(", ")
    expect(joined).not.toMatch(/cropped top|cropped above the midriff/i)
  })
})
