import { describe, it, expect } from "vitest"
import { normalizeEdl } from "@nodaro/shared"
import { buildEdited } from "../build-edited"
import { cutRange, keptSetOf } from "../kept-set"
import { reasonStats, reviewLengths } from "../review-stats"
import type { ReviewRenderContext } from "../restore"
import { keepSpan } from "./review-fixtures"

const VIDEO: ReviewRenderContext = { output: "video", crossfadeMs: 0, sources: [] }

// seg-0 | filler | seg-1 · seg-2 | tangent, with a silence inside it | seg-3, then a trailing silence
const plan = normalizeEdl({
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [
    { id: "seg-0", inMs: 0, outMs: 1000, video: "cam" },
    { id: "seg-1", inMs: 1300, outMs: 2000, video: "cam" },
    { id: "seg-2", inMs: 2000, outMs: 3000, video: "cam" },
    { id: "seg-3", inMs: 6000, outMs: 7000, video: "cam" },
  ],
  dropped: [
    { inMs: 1000, outMs: 1300, reason: "filler" },
    { inMs: 3000, outMs: 6000, reason: "tangent" },
    { inMs: 3500, outMs: 3800, reason: "silence" },
    { inMs: 7000, outMs: 8000, reason: "silence" },
  ],
})
const K0 = keptSetOf(plan)

describe("the footer's lengths", () => {
  it("cut length, source and removed: source − |K| is what was removed", () => {
    expect(reviewLengths(plan, buildEdited(plan, K0), K0, VIDEO)).toEqual({ outputMs: 3700, approximate: false, sourceMs: 8000, removedMs: 4300 })
  })

  it("restoring time adds it back to the cut", () => {
    const k = keepSpan(K0, plan.dropped![0]!)
    expect(reviewLengths(plan, buildEdited(plan, k), k, VIDEO)).toMatchObject({ outputMs: 4000, removedMs: 4000 })
  })

  it("with a crossfade the cut is shorter than K, and the length is shown as at most (≤)", () => {
    const lengths = reviewLengths(plan, buildEdited(plan, K0), K0, { ...VIDEO, crossfadeMs: 200 })
    expect(lengths.approximate).toBe(true)
    expect(lengths.outputMs).toBeLessThan(3700)
    expect(lengths.removedMs).toBe(4300)
  })
})

describe("the reasons panel's rows", () => {
  it("one row per reason present, in the panel's order, with the plan's count and time and what is still cut", () => {
    expect(reasonStats(plan, buildEdited(plan, K0), K0)).toEqual([
      { reason: "silence", planSpans: 2, planMs: 1300, cutSpans: 2, cutMs: 1300, state: "cut" },
      { reason: "filler", planSpans: 1, planMs: 300, cutSpans: 1, cutMs: 300, state: "cut" },
      { reason: "tangent", planSpans: 1, planMs: 3000, cutSpans: 1, cutMs: 3000, state: "cut" },
    ])
  })

  it("a reason partly restored is 'partial', fully restored 'restored'; the reviewer's cuts are a manual row", () => {
    const words = [{ text: "So", startMs: 100, endMs: 400 }]
    const k = cutRange(keepSpan(keepSpan(K0, plan.dropped![0]!), plan.dropped![3]!), { inMs: 100, outMs: 400 }, words)
    const rows = reasonStats(plan, buildEdited(plan, k), k)
    expect(rows.find((r) => r.reason === "silence")).toMatchObject({ cutMs: 300, state: "partial" })
    expect(rows.find((r) => r.reason === "filler")).toMatchObject({ cutSpans: 0, cutMs: 0, state: "restored" })
    expect(rows.at(-1)).toEqual({ reason: "manual", planSpans: 0, planMs: 0, cutSpans: 1, cutMs: 300, state: "cut" })
  })

  it("a reason the panel does not know is listed after the known ones, as written", () => {
    const odd = normalizeEdl({ ...plan, dropped: [...plan.dropped!, { inMs: 8000, outMs: 8100, reason: "breath" }] })
    expect(reasonStats(odd, buildEdited(odd, K0), K0).map((r) => r.reason)).toEqual(["silence", "filler", "tangent", "breath"])
  })
})
