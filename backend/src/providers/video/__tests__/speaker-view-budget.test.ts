// Speaker View's registered job budget (C2.0, §0.4 of its design): a plugin
// handler cannot declare `livenessBudgetMs`, so before this its heartbeat
// stopped at the 90-minute default and a long final was swept mid-render.
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment } from "@nodaro/shared"
import { BUDGETED_JOB_NAMES, declaredJobBudgetMs } from "../../../lib/job-budget.js"
import { NODE_TIMEOUT_MS } from "../../../services/workflow-engine/types.js"
import { applyEdlRenderBudgetMs, edlTimelineRenderBudgetMs } from "../apply-edl-budget.js"
import { SPEAKER_VIEW_MAX_SLOTS, speakerViewJobBudgetMs, speakerViewWorstCaseSlots } from "../speaker-view-budget.js"

const MIN = 60_000
const SOURCES = [
  { id: "A", url: "https://f.test/a.mp4", kind: "video" },
  { id: "B", url: "https://f.test/b.mp4", kind: "video" },
  { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" },
]

/** `n` segments of `segMs` alternating cameras, speakers from `speakers`. */
function edit(n: number, segMs: number, speakers: readonly string[] = ["Host", "Guest"]): Edl {
  const segments = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, inMs: i * segMs, outMs: (i + 1) * segMs, video: i % 2 ? "B" : "A",
    ...(speakers.length ? { speaker: speakers[i % speakers.length] } : {}),
  })) as EdlSegment[]
  return { version: 1, clock: "master", sources: SOURCES, segments } as unknown as Edl
}

describe("speaker-view's budget is registered and read the same way by every reader", () => {
  it("is a registered budgeted job, so the dispatch site's fallback finds it", () => {
    expect(BUDGETED_JOB_NAMES).toContain("speaker-view")
    const edl = edit(40, 30_000)
    expect(declaredJobBudgetMs("speaker-view", { edl })).toBe(speakerViewJobBudgetMs({ edl }))
  })

  it("outlives the 90-minute default for a 3-hour final — the failure it exists to stop", () => {
    const edl = edit(360, 30_000) // 180 min, two speakers
    const budget = declaredJobBudgetMs("speaker-view", { edl, quality: "final" })!
    expect(budget).toBeGreaterThan(NODE_TIMEOUT_MS)
    // and never below Apply EDL's for the same edit: a composite is more work
    expect(budget).toBeGreaterThan(applyEdlRenderBudgetMs(edl))
  })

  it("assumes one slot per speaker the edit names, at most six, and six when it names none", () => {
    expect(speakerViewWorstCaseSlots(edit(4, 1000, ["Host"]))).toBe(1)
    expect(speakerViewWorstCaseSlots(edit(4, 1000, ["Host", "Guest"]))).toBe(2)
    expect(speakerViewWorstCaseSlots(edit(9, 1000, ["a", "b", "c", "d", "e", "f", "g", "h"]))).toBe(SPEAKER_VIEW_MAX_SLOTS)
    expect(speakerViewWorstCaseSlots(edit(4, 1000, []))).toBe(SPEAKER_VIEW_MAX_SLOTS)
    // Camera Switch's hint slots name speakers too
    const hinted = edit(2, 1000, ["Host"])
    const withHint = { ...hinted, segments: [hinted.segments[0], { ...hinted.segments[1], layout: { mode: "side-by-side", slots: [{ source: "A", speaker: "Host" }, { source: "B", speaker: "Producer" }] } }] } as Edl
    expect(speakerViewWorstCaseSlots(withHint)).toBe(2)
    const edl = edit(20, 20_000)
    expect(speakerViewJobBudgetMs({ edl })).toBe(edlTimelineRenderBudgetMs(edl, { output: "video", assumeSlots: 2 }))
  })

  // Turn splitting happens in the handler, after dispatch: the post-split
  // render, with the slots actually laid out, must still fit the budget the
  // dispatch site declared on the edit as given.
  it("covers the render the handler actually makes: turns split, two slots laid out", () => {
    const given = edit(120, 30_000) // 60 min
    const split = {
      ...given,
      segments: given.segments.flatMap((s) => [0, 1, 2, 3].map((k) => ({
        ...s, id: `${s.id}.${k}`, inMs: s.inMs + k * 7500, outMs: s.inMs + (k + 1) * 7500,
        layout: { mode: "side-by-side", slots: [{ source: "A", speaker: "Host" }, { source: "B", speaker: "Guest" }] },
      }))),
    } as unknown as Edl
    expect(speakerViewJobBudgetMs({ edl: given })!).toBeGreaterThanOrEqual(edlTimelineRenderBudgetMs(split, { output: "video" }))
  })

  // The payload is the private plugin route's `job.data`; until its shape is
  // exported from the plugin's contract (C2.1) this in-repo fixture stands in
  // for it. Every valid payload must declare a budget — `undefined` here is
  // exactly the 90-minute failure again.
  it("declares a budget for every valid payload shape, whatever else rides on it", () => {
    const edl = edit(30, 20_000)
    const payloads = [
      { edl },
      { edl, quality: "proxy" },
      { edl, quality: "final", clipKey: "clip-3", jobId: "j1", usageLogId: "u1" },
      { edl, transcript: { words: [], segments: [] }, speakerRegions: [{ source: "A", speaker: "Host", region: { x: 0, y: 0, w: 0.5, h: 1 } }] },
      { edl, layout: "auto", switch: { type: "cut" }, emphasis: { style: "scale", durationMs: 300 }, targetAspect: "9:16" },
      { edl: edit(1, 5000, []) },
      { edl, type: "speaker-view", node_id: "n1" }, // a jobs row's input_data
    ]
    for (const p of payloads) expect(speakerViewJobBudgetMs(p), JSON.stringify(Object.keys(p))).toBeGreaterThan(0)
  })

  it("declares nothing for a payload it cannot read, or an edit over the 180-minute cap", () => {
    for (const p of [undefined, null, "edl", {}, { edl: {} }, { edl: { segments: [], sources: [] } }, { edl: { segments: "x", sources: [] } }]) {
      expect(speakerViewJobBudgetMs(p), JSON.stringify(p)).toBeUndefined()
    }
    expect(speakerViewJobBudgetMs({ edl: edit(181, MIN) })).toBeUndefined()
  })
})
