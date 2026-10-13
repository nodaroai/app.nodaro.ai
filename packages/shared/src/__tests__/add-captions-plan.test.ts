import { describe, expect, it, vi } from "vitest"
import { captionPlanBodyLevers, styleCaptionPlan } from "../add-captions-plan.js"

const plan = { v: 1, hookText: "Sample hook", hookEndMs: 1400, bodyEndMs: 5300, captions: [{ text: "one", startMs: 1500, endMs: 1800 }] }
const leverKeys = ["style", "look", "position", "positionY", "fontSize", "fontWeight", "maxWordsPerLine", "color", "backgroundColor", "highlightColor", "fontFamily", "uppercase", "strokeColor", "strokeWidth", "animate"]
const plate = { startMs: 0, endMs: 1400, text: "Sample hook", style: "subtitle", look: "clean", positionY: 20 }
const body = { startMs: 1400, endMs: 5300, captions: plan.captions, style: "word-highlight", look: "outline" }

describe("styleCaptionPlan — one composition for both engines (spec §6.2)", () => {
  it("passes the node's set levers as bodyLevers, and none when the node sets none", () => {
    expect(captionPlanBodyLevers({ label: "Captions", style: "karaoke", color: null, fontSize: undefined, autoTranscribe: true }, leverKeys)).toEqual({ style: "karaoke" })
    expect(captionPlanBodyLevers({ label: "Captions", autoTranscribe: true }, leverKeys)).toBeUndefined()
    const segmentsFor = vi.fn(() => ({ segments: [plate, body], dropped: [] }))
    styleCaptionPlan(plan, { label: "Captions" }, { segmentsFor, leverKeys })
    expect(segmentsFor).toHaveBeenCalledWith(plan, undefined)
    styleCaptionPlan(plan, { style: "karaoke" }, { segmentsFor, leverKeys })
    expect(segmentsFor).toHaveBeenLastCalledWith(plan, { bodyLevers: { style: "karaoke" } })
  })
  it("returns the helper's segments as the route's schema reads them, or the parser's error", () => {
    const styler = { segmentsFor: () => ({ segments: [plate, body], dropped: [] }), leverKeys }
    // A word entry from the plan carries only { text, startMs, endMs }: the route's
    // schema completes it, and so does this check — a DAG payload never passes the
    // route, and the render plan rejected the bare entry after credits were reserved.
    const completedBody = { ...body, captions: [{ ...plan.captions[0], timestampMs: null, confidence: null }] }
    expect(styleCaptionPlan(JSON.stringify(plan), {}, styler)).toEqual({ segments: [plate, completedBody] })
    expect(styleCaptionPlan({ ...plan, v: 3 }, {}, styler)).toEqual({ error: "Caption plan: v must be 1." })
  })
  it("refuses overlapping or schema-invalid segments before anything is reserved", () => {
    const overlap = { segmentsFor: () => ({ segments: [plate, { ...body, startMs: 900 }], dropped: [] }), leverKeys }
    expect(styleCaptionPlan(plan, {}, overlap)).toEqual({ error: "Caption plan: segments overlap: [0, 1400) and [900, 5300)." })
    const inverted = { segmentsFor: () => ({ segments: [{ ...plate, endMs: 0 }], dropped: [] }), leverKeys }
    expect(styleCaptionPlan(plan, {}, inverted)).toEqual({ error: "Caption plan: segment 1: segment endMs must be greater than startMs." })
  })
  it("an empty result is an empty list, never an error (the node passes the video through)", () => {
    expect(styleCaptionPlan(plan, {}, { segmentsFor: () => ({ segments: [], dropped: ["hook", "body"] }), leverKeys })).toEqual({ segments: [] })
  })
})
