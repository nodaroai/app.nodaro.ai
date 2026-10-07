import { describe, expect, it } from "vitest"
import { BODY_CAPTIONS_PRESET_ID, getFactoryPresets } from "@nodaro/prompts"
import { captionRoutesToRemotion } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"

const preset = (id: string) => getFactoryPresets("add-captions").find((p) => p.id === id)!.data as Record<string, unknown>
const bodyCaptions = preset(BODY_CAPTIONS_PRESET_ID)
const words = [{ text: "one", startMs: 1500, endMs: 1800 }, { text: "two", startMs: 1800, endMs: 2100 }]
const PLANS = {
  hookOnly: { v: 1, hookText: "Sample hook", hookEndMs: 1400, bodyEndMs: 1400, captions: [] },
  bodyOnly: { v: 1, hookText: "", hookEndMs: 1400, bodyEndMs: 2400, captions: words },
  both: { v: 1, hookText: "Sample hook", hookEndMs: 1400, bodyEndMs: 2400, captions: words },
  hebrew: { v: 1, hookText: "שורת פתיחה", hookEndMs: 1400, bodyEndMs: 2400, captions: words, language: "he" },
}
// buildPayload(node, jobId, resolvedInputs, usageLogId?, buildCtx?) — synchronous.
const run = (plan: unknown, data: Record<string, unknown> = { label: "Captions", ...bodyCaptions }) =>
  buildPayload({ id: "cap", type: "add-captions", data } as never, "job-1", { videoUrl: "https://cdn.example/v.mp4", captionPlan: JSON.stringify(plan) } as never, "u-1")

describe("Add Captions with a wired caption plan (DAG)", () => {
  it.each(Object.entries(PLANS))("%s: segments only, Remotion, reserved as add-captions:kinetic", (_name, plan) => {
    const r = run(plan)
    expect(Object.keys(r.payload).sort()).toEqual(["jobId", "segments", "usageLogId", "videoUrl"])
    expect(r.modelIdentifier).toBe("add-captions:kinetic")
    expect((r.payload.segments as unknown[]).length).toBeGreaterThan(0)
    expect(captionRoutesToRemotion({ segments: r.payload.segments as unknown[] })).toBe(true)
  })
  it("never drops segments from a request built from a plan (the plate's one way back to drawtext)", () => {
    const r = run(PLANS.both)
    expect(Array.isArray(r.payload.segments)).toBe(true)
    expect(r.payload.text).toBeUndefined()
  })
  it("a node's own backgroundColor and highlightColor never reach the plate", () => {
    const plain = run(PLANS.both)
    const extra = run(PLANS.both, { label: "Captions", ...bodyCaptions, backgroundColor: "#FF0000", highlightColor: "#00FF00" })
    const plate = (r: { payload: Record<string, unknown> }) => (r.payload.segments as Record<string, unknown>[])[0]
    expect(plate(extra)).toEqual(plate(plain))
  })
  it("the plan wins over data.segments, data.text and a wired transcript", () => {
    const r = buildPayload(
      { id: "cap", type: "add-captions", data: { label: "Captions", text: "typed", segments: [{ startMs: 0, endMs: 10, text: "old" }] } } as never,
      "job-1",
      { videoUrl: "https://cdn.example/v.mp4", captionPlan: JSON.stringify(PLANS.both), transcript: "{\"words\":[]}" } as never,
      "u-1",
    )
    expect((r.payload.segments as Record<string, unknown>[])[0]!.text).toBe("Sample hook")
  })
  it("an unparseable plan throws before the reservation", () => {
    expect(() => run({ ...PLANS.both, v: 2 })).toThrow("Caption plan: v must be 1.")
  })
})
