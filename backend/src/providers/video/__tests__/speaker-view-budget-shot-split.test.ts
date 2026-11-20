// Speaker View's budget covers the shot split (decided 2026-11-20): with face
// tracks wired the handler splits a segment at the scene cuts of the cameras
// it follows, AFTER dispatch and of named segments too, so the budget the
// dispatch site declares on the edit as given must cover the render of the
// split edit.
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment, EdlSource } from "@nodaro/shared/edl"
import { declaredJobBudgetMs } from "../../../lib/job-budget.js"
import { edlTimelineRenderBudgetMs } from "../apply-edl-budget.js"
import { shotCutPieces, speakerViewJobBudgetMs, speakerViewWorstCaseSlots } from "../speaker-view-budget.js"

const CAM: EdlSource = { id: "cam", url: "https://f.test/cam.mp4", kind: "video" }
const edit = (segments: EdlSegment[], sources: EdlSource[] = [CAM]): Edl => ({ version: 1, clock: "master", sources, segments } as unknown as Edl)
const seg = (id: string, inMs: number, outMs: number, more: Partial<EdlSegment> = {}): EdlSegment => ({ id, inMs, outMs, video: "cam", speaker: "Host", ...more } as EdlSegment)
const tracksOf = (cuts: number[], sourceId = "cam") => ({ version: 1, sampleFps: 2, sources: [{ sourceId, clock: "source", cuts, tracks: [] }] })
const renderBudget = (edl: Edl) => edlTimelineRenderBudgetMs(edl, { output: "video", assumeSlots: speakerViewWorstCaseSlots(edl) })

/** `edl` with every segment cut at every one of `cuts` (master clock) inside
 *  it — the most the plugin's shot split can do. Only a first piece keeps its
 *  transition, as the plugin's pieces do. */
function splitAtEvery(edl: Edl, cuts: readonly number[]): Edl {
  const segments = edl.segments.flatMap((s) => {
    const inside = cuts.filter((c) => c > s.inMs && c < s.outMs)
    const bounds = [s.inMs, ...inside, s.outMs]
    return bounds.slice(0, -1).map((inMs, k) => {
      const piece = { ...s, id: `${s.id}.c${k}`, inMs, outMs: bounds[k + 1]! }
      if (k === 0) return piece
      const { transition: _t, ...rest } = piece
      return rest as EdlSegment
    })
  })
  return { ...edl, segments }
}

describe("shotCutPieces — the pieces the shot split can add, per segment", () => {
  const edl = edit([seg("a", 0, 4000), seg("b", 6000, 9000)])

  it("counts the tracks' cuts strictly inside each segment, on the master clock", () => {
    expect(shotCutPieces(edl, tracksOf([1333, 4000, 5000, 6000, 7000, 8000, 9000]))).toEqual([1, 2])
  })

  it("moves a cut by its source's offset", () => {
    const shifted = edit([seg("a", 0, 4000)], [{ ...CAM, offsetMs: 3000 }])
    expect(shotCutPieces(shifted, tracksOf([500]))).toEqual([1])
    expect(shotCutPieces(shifted, tracksOf([1500]))).toEqual([0])
  })

  it("reads the tracks as an object or as their JSON string, and nothing from what it cannot read", () => {
    expect(shotCutPieces(edl, JSON.stringify(tracksOf([1333])))).toEqual([1, 0])
    for (const bad of [undefined, null, "", "{", 7, {}, { sources: "x" }, { sources: [null, { sourceId: "cam" }, { sourceId: 1, cuts: [1333] }] }]) {
      expect(shotCutPieces(edl, bad)).toEqual([0, 0])
    }
  })
})

describe("the budget declared on the edit as given covers the edit split at its cameras' cuts", () => {
  it("an edit with no cut inside a segment keeps exactly the budget of the edit as given", () => {
    const edl = edit([seg("a", 0, 4000), seg("b", 6000, 9000)])
    for (const tracks of [undefined, tracksOf([]), tracksOf([4000, 5000, 20_000]), tracksOf([1333], "other")]) {
      expect(speakerViewJobBudgetMs({ edl, tracks })).toBe(renderBudget(edl))
    }
  })

  it("the job's clip: one named 4-second segment, one cut", () => {
    const edl = edit([seg("seg-0", 0, 4000, { speaker: "speaker_0" })])
    const budget = speakerViewJobBudgetMs({ edl, tracks: tracksOf([1333]) })!
    expect(budget).toBeGreaterThanOrEqual(renderBudget(splitAtEvery(edl, [1333])))
    expect(budget).toBeGreaterThanOrEqual(renderBudget(edl))
  })

  it("a fast-cut camera: a cut every 400 ms over 30 minutes of named segments, with crossfades between them", () => {
    const segments = Array.from({ length: 30 }, (_, k) =>
      seg(`s${k}`, k * 70_000, k * 70_000 + 60_000, k > 0 ? { transition: { type: "crossfade", durationMs: 500 } } as Partial<EdlSegment> : {}))
    const edl = edit(segments)
    const cuts = Array.from({ length: Math.floor((30 * 70_000) / 400) }, (_, k) => (k + 1) * 400)
    const split = splitAtEvery(edl, cuts)
    expect(split.segments.length).toBeGreaterThan(4000) // the case is what it says
    expect(renderBudget(split)).toBeGreaterThan(renderBudget(edl)) // the split costs more
    expect(speakerViewJobBudgetMs({ edl, tracks: tracksOf(cuts) })!).toBeGreaterThanOrEqual(renderBudget(split))
  })

  it("stacks on the turn split: unnamed segments, a labelled transcript and cuts", () => {
    const edl = edit([{ id: "s0", inMs: 0, outMs: 120_000, video: "cam" } as EdlSegment])
    const words = Array.from({ length: 240 }, (_, k) => ({ text: "w", startMs: k * 500, endMs: k * 500 + 450, speaker: Math.floor(k / 6) % 2 ? "Guest" : "Host" }))
    const transcript = { version: 1, words }
    const turnsOnly = speakerViewJobBudgetMs({ edl, transcript })!
    const both = speakerViewJobBudgetMs({ edl, transcript, tracks: tracksOf(Array.from({ length: 100 }, (_, k) => (k + 1) * 1000)) })!
    expect(both).toBeGreaterThanOrEqual(turnsOnly)
  })

  it("is what the dispatch site declares", () => {
    const data = { edl: edit([seg("a", 0, 4000)]), tracks: tracksOf([1333]) }
    expect(declaredJobBudgetMs("speaker-view", data)).toBe(speakerViewJobBudgetMs(data))
  })
})
