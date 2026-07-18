import { describe, it, expect } from "vitest"
import { resolveTargetPickers, buildGapRecords, buildMissingPickerReport } from "../describe-to-picker.js"

describe("resolveTargetPickers", () => {
  it("prefers the targetPickers array", () => {
    expect(resolveTargetPickers({ targetPickers: ["person", "styling"] })).toEqual(["person", "styling"])
  })
  it("falls back to the legacy scalar targetPicker", () => {
    expect(resolveTargetPickers({ targetPicker: "person" })).toEqual(["person"])
  })
  it("returns [] when neither present", () => {
    expect(resolveTargetPickers({})).toEqual([])
  })
})

describe("buildGapRecords", () => {
  const pickerJson = { person: { age: "age-early-20s" }, framing: { composition: ["centered", "negative-space"] } }
  it("joins chosenId from the picker section and normalizes observed", () => {
    const recs = buildGapRecords(
      { missingItems: [{ picker: "person", dimension: "age", observed: "  Late  Teens " }], missingCategories: [] },
      pickerJson,
      "u1",
    )
    expect(recs).toEqual([
      {
        p_picker_type: "person",
        p_gap_type: "item",
        p_dimension: "age",
        p_observed: "  Late  Teens ",
        p_observed_norm: "late teens",
        p_chosen_id: "age-early-20s",
        p_sample_user_id: "u1",
      },
    ])
  })
  it("uses the first array element for chosenId and null for categories", () => {
    const recs = buildGapRecords(
      {
        missingItems: [{ picker: "framing", dimension: "composition", observed: "x" }],
        missingCategories: [{ picker: "person", suggestedDimension: "freckle-density", observed: "y" }],
      },
      pickerJson,
      "u1",
    )
    expect(recs[0].p_chosen_id).toBe("centered")
    expect(recs[1]).toMatchObject({ p_gap_type: "category", p_dimension: "freckle-density", p_chosen_id: null })
  })
  it("returns [] for empty/absent gaps", () => {
    expect(buildGapRecords(undefined, pickerJson, "u1")).toEqual([])
    expect(buildGapRecords({ missingItems: [], missingCategories: [] }, pickerJson, "u1")).toEqual([])
  })
})

describe("buildMissingPickerReport", () => {
  const ctx = {
    imageUrl: "https://cdn.example/img.png",
    llmModel: "claude-opus-4.7",
    targetPickers: ["person"],
    origin: "person",
    userId: "u1",
    jobId: "j1",
  }

  it("builds a per-incident app_report carrying the image link and app origin", () => {
    const gaps = {
      missingItems: [{ picker: "person", dimension: "hair-color", observed: "blue-green ombre" }],
      missingCategories: [{ picker: "person", suggestedDimension: "freckles", observed: "dense freckles" }],
    }
    const report = buildMissingPickerReport(gaps, ctx)
    expect(report).toMatchObject({
      appSlug: "person",
      node: "describe-to-picker",
      kind: "missing-picker",
      title: "2 unmatched attributes in image analysis",
      userId: "u1",
      jobId: "j1",
    })
    expect(report?.payload).toMatchObject({ imageUrl: ctx.imageUrl, gaps, llmModel: ctx.llmModel })
  })

  it("is null when the analysis had no gaps (no report row)", () => {
    expect(buildMissingPickerReport(undefined, ctx)).toBeNull()
    expect(buildMissingPickerReport({ missingItems: [], missingCategories: [] }, ctx)).toBeNull()
  })

  it("omits the app slug when no origin was sent", () => {
    const report = buildMissingPickerReport(
      { missingItems: [{ picker: "person", dimension: "age", observed: "x" }], missingCategories: [] },
      { ...ctx, origin: undefined },
    )
    expect(report?.appSlug).toBeNull()
    expect(report?.title).toBe("1 unmatched attribute in image analysis")
  })
})
