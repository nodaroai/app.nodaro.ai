import { describe, it, expect } from "vitest"
import type { ReviewRow } from "../review-rows"
import { collapseFindRuns, collapseRun, expandRun, focusedRun, innermostLayer, trackExpandedRuns } from "../escape-layers"

/**
 * Escape closes the innermost layer first (§2.4 of the inspectors design):
 * the span popover (a Radix layer, which closes itself), then the selection
 * toolbar, then the find bar, then the expanded run that has focus, then the
 * dialog (decided 2026-10-06: with no focused expanded run, Escape moves on).
 */
describe("innermostLayer", () => {
  const none = { selection: false, find: false, expanded: false }

  it("is null with no custom layer open: Escape closes the dialog", () => {
    expect(innermostLayer(none)).toBeNull()
  })

  it("each layer on its own is the innermost", () => {
    expect(innermostLayer({ ...none, selection: true })).toBe("selection")
    expect(innermostLayer({ ...none, find: true })).toBe("find")
    expect(innermostLayer({ ...none, expanded: true })).toBe("expanded")
  })

  it("closes the selection toolbar before the find bar, and the find bar before a focused expanded run", () => {
    expect(innermostLayer({ selection: true, find: true, expanded: true })).toBe("selection")
    expect(innermostLayer({ selection: false, find: true, expanded: true })).toBe("find")
  })
})

describe("focusedRun: the expanded run the focused row belongs to", () => {
  const paragraph = (first: number, end: number, run?: string): ReviewRow => ({
    kind: "paragraph",
    key: `p${first}`,
    paragraph: first,
    first,
    end,
    inMs: first * 1000,
    outMs: end * 1000,
    gaps: [],
    ...(run ? { run } : {}),
  })
  const rows: ReviewRow[] = [paragraph(0, 1), paragraph(1, 3, "run-1"), paragraph(3, 5, "run-1"), paragraph(5, 6)]

  it("is the whole run's word range for a row inside it", () => {
    expect(focusedRun(rows, 1)).toEqual({ first: 1, end: 5 })
    expect(focusedRun(rows, 2)).toEqual({ first: 1, end: 5 })
  })

  it("is undefined for a row outside every expanded run, or no row at all", () => {
    expect(focusedRun(rows, 0)).toBeUndefined()
    expect(focusedRun(rows, 3)).toBeUndefined()
    expect(focusedRun(rows, -1)).toBeUndefined()
    expect(focusedRun(rows, 99)).toBeUndefined()
  })
})

describe("the expanded runs, by word range", () => {
  const span = (first: number, end: number) => ({ first, end })

  it("expanding a run adds it once", () => {
    expect(expandRun([span(9, 12)], span(1, 4))).toEqual([span(9, 12), span(1, 4)])
    expect(expandRun([span(1, 4)], span(1, 4))).toEqual([span(1, 4)])
  })

  it("collapses the run over a span", () => {
    expect(collapseRun([span(1, 4), span(9, 12)], span(2, 3))).toEqual([span(9, 12)])
  })

  it("follows the open runs: a run that lost its first paragraph keeps its place, one that is gone is dropped", () => {
    // [1, 10) lost its first paragraph [1, 4); [20, 24) was restored whole.
    expect(trackExpandedRuns([span(1, 10), span(20, 24)], [span(4, 10)])).toEqual([span(4, 10)])
    // A paragraph before it was cut: the run grew backwards.
    expect(trackExpandedRuns([span(4, 10)], [span(1, 10)])).toEqual([span(1, 10)])
  })

  it("merges two runs that became one", () => {
    expect(trackExpandedRuns([span(1, 4), span(6, 9)], [span(1, 9)])).toEqual([span(1, 9)])
  })

  it("returns the list itself when nothing moved", () => {
    const runs = [span(1, 4)]
    expect(trackExpandedRuns(runs, [span(1, 4)])).toBe(runs)
  })

  it("never mutates the list it is given", () => {
    const runs = Object.freeze([span(1, 4), span(6, 9)])
    expandRun(runs, span(10, 12))
    collapseRun(runs, span(1, 4))
    trackExpandedRuns(runs, [span(2, 9)])
    expect(runs).toEqual([span(1, 4), span(6, 9)])
  })
})

/**
 * When find closes, the runs ONLY find opened collapse again; the runs the
 * reviewer opened stay open (decided 2026-10-07).
 */
describe("the runs find opened", () => {
  const span = (first: number, end: number) => ({ first, end })
  const byFind = (first: number, end: number) => ({ first, end, byFind: true as const })

  it("are marked when find expands them, and not when the reviewer does", () => {
    expect(expandRun([], span(1, 4), "find")).toEqual([byFind(1, 4)])
    expect(expandRun([], span(1, 4))).toEqual([span(1, 4)])
  })

  it("become the reviewer's when the reviewer expands one find opened, and stay the reviewer's when find reaches one", () => {
    expect(expandRun([byFind(1, 4)], span(1, 4))).toEqual([span(1, 4)])
    expect(expandRun([span(1, 4)], span(1, 4), "find")).toEqual([span(1, 4)])
  })

  it("collapse when find closes; the reviewer's stay open", () => {
    expect(collapseFindRuns([span(1, 4), byFind(9, 12), byFind(20, 24)])).toEqual([span(1, 4)])
  })

  it("returns the list itself when find opened none", () => {
    const runs = [span(1, 4)]
    expect(collapseFindRuns(runs)).toBe(runs)
  })

  it("keep their mark as they follow the edit, and a merge with a run the reviewer opened is the reviewer's", () => {
    expect(trackExpandedRuns([byFind(1, 10)], [span(4, 10)])).toEqual([byFind(4, 10)])
    expect(trackExpandedRuns([byFind(1, 4), byFind(6, 9)], [span(1, 9)])).toEqual([byFind(1, 9)])
    expect(trackExpandedRuns([span(1, 4), byFind(6, 9)], [span(1, 9)])).toEqual([span(1, 9)])
    expect(trackExpandedRuns([byFind(1, 4), span(6, 9)], [span(1, 9)])).toEqual([span(1, 9)])
  })
})
