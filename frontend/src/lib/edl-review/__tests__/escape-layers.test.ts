import { describe, it, expect } from "vitest"
import { collapseLastRun, collapseRun, expandRun, hasReviewerRun, innermostLayer, trackExpandedRuns } from "../escape-layers"

/**
 * Escape closes the innermost layer first (§2.4 of the inspectors design):
 * the span popover (a Radix layer, which closes itself), then the selection
 * toolbar, then the find bar, then a run the reviewer expanded, then the dialog.
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

  it("closes the selection toolbar before the find bar, and the find bar before an expanded run", () => {
    expect(innermostLayer({ selection: true, find: true, expanded: true })).toBe("selection")
    expect(innermostLayer({ selection: false, find: true, expanded: true })).toBe("find")
  })
})

describe("the expanded runs, by word range, most recent last", () => {
  const mine = (first: number, end: number) => ({ first, end, byReviewer: true })
  const finds = (first: number, end: number) => ({ first, end, byReviewer: false })

  it("expanding a run moves it to the end; expanding it again does not repeat it", () => {
    expect(expandRun([mine(1, 4), mine(9, 12)], { first: 1, end: 4 }, true)).toEqual([mine(9, 12), mine(1, 4)])
    expect(expandRun([], { first: 4, end: 6 }, true)).toEqual([mine(4, 6)])
  })

  it("a run the reviewer opened stays theirs when find opens it again", () => {
    expect(expandRun([mine(1, 4)], { first: 1, end: 4 }, false)).toEqual([mine(1, 4)])
    expect(expandRun([finds(1, 4)], { first: 1, end: 4 }, true)).toEqual([mine(1, 4)])
  })

  it("collapses one run, or the one the reviewer opened last (an Escape), never one find opened", () => {
    expect(collapseRun([mine(1, 4), mine(9, 12)], { first: 2, end: 3 })).toEqual([mine(9, 12)])
    expect(collapseLastRun([mine(1, 4), mine(9, 12)])).toEqual([mine(1, 4)])
    expect(collapseLastRun([mine(1, 4), finds(9, 12)])).toEqual([finds(9, 12)])
    expect(hasReviewerRun([finds(9, 12)])).toBe(false)
    expect(collapseLastRun([])).toEqual([])
  })

  it("follows the open runs: a run that lost its first paragraph keeps its place, one that is gone is dropped", () => {
    // [1, 10) lost its first paragraph [1, 4); [20, 24) was restored whole.
    const runs = [mine(1, 10), finds(20, 24)]
    expect(trackExpandedRuns(runs, [{ first: 4, end: 10 }])).toEqual([mine(4, 10)])
    // A paragraph before it was cut: the run grew backwards.
    expect(trackExpandedRuns([mine(4, 10)], [{ first: 1, end: 10 }])).toEqual([mine(1, 10)])
  })

  it("merges two runs that became one, keeping the reviewer's", () => {
    expect(trackExpandedRuns([mine(1, 4), finds(6, 9)], [{ first: 1, end: 9 }])).toEqual([mine(1, 9)])
  })

  it("returns the list itself when nothing moved", () => {
    const runs = [mine(1, 4)]
    expect(trackExpandedRuns(runs, [{ first: 1, end: 4 }])).toBe(runs)
  })

  it("never mutates the list it is given", () => {
    const runs = Object.freeze([mine(1, 4), mine(6, 9)])
    expandRun(runs, { first: 10, end: 12 }, true)
    collapseRun(runs, { first: 1, end: 4 })
    collapseLastRun(runs)
    trackExpandedRuns(runs, [{ first: 2, end: 9 }])
    expect(runs).toEqual([mine(1, 4), mine(6, 9)])
  })
})
