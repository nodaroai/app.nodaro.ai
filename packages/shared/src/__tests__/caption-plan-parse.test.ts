import { describe, expect, it } from "vitest"
import { parseCaptionPlan } from "../caption-plan.js"

const plan = { v: 1, hookText: "Sample hook", hookEndMs: 1400, bodyEndMs: 5300, captions: [{ text: "one", startMs: 1500, endMs: 1800 }] }

describe("parseCaptionPlan", () => {
  it("accepts the object and its JSON string", () => {
    expect(parseCaptionPlan(plan)).toEqual({ plan })
    expect(parseCaptionPlan(JSON.stringify({ ...plan, videoDurationMs: 6000, language: "he" }))).toEqual({ plan: { ...plan, videoDurationMs: 6000, language: "he" } })
  })
  it("names the bad field", () => {
    expect(parseCaptionPlan({ ...plan, v: 2 })).toEqual({ error: "Caption plan: v must be 1." })
    expect(parseCaptionPlan({ ...plan, hookEndMs: -1 })).toEqual({ error: "Caption plan: hookEndMs must be a non-negative number." })
    expect(parseCaptionPlan({ ...plan, bodyEndMs: Number.POSITIVE_INFINITY })).toEqual({ error: "Caption plan: bodyEndMs must be a non-negative number." })
    expect(parseCaptionPlan({ ...plan, captions: [{ text: "x", startMs: 9, endMs: 3 }] })).toEqual({ error: "Caption plan: captions[0] ends before it starts." })
    expect(parseCaptionPlan({ ...plan, captions: "nope" })).toEqual({ error: "Caption plan: captions must be a list." })
    expect(parseCaptionPlan("{not json")).toEqual({ error: "Caption plan: not valid JSON." })
    expect(parseCaptionPlan(null)).toEqual({ error: "Caption plan: not an object." })
  })
  it("never copies an unknown key onto the plan", () => {
    expect(parseCaptionPlan({ ...plan, style: "karaoke" })).toEqual({ plan })
  })
})
