// Hard-cut detection, exercised on synthetic difference sequences.
//
// The fixture's claim is not "the picture changes at frame 360" — a slow orbit
// changes the picture on every frame. It is that the change AT the cut is a
// spike and not a ramp, with no blended transition frame. These tests are
// written mostly as NEGATIVES: a two-frame dissolve, a fast pan and a ramp all
// produce a large difference, and all three must be refused.
import { test } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_CUT_THRESHOLDS, checkExpectedCuts, describeBoundary, detectCuts, neighbourValues, shotWindows } from "../scene3d-acceptance/lib/cuts.mjs"

/** A slow orbit: small, steady frame-to-frame difference. */
function orbit(length, base = 3) {
  return Array.from({ length }, (_, i) => (i === 0 ? 0 : base + ((i % 3) * 0.2)))
}

function withCutAt(length, index, magnitude = 90) {
  const diffs = orbit(length)
  diffs[index] = magnitude
  return diffs
}

test("index i names the FIRST frame of the new shot, and frame 0 can never be a cut", () => {
  const diffs = withCutAt(20, 10)
  assert.deepEqual(detectCuts(diffs).map((c) => c.index), [10])
  // diffs[0] is 0 by construction: the first frame has no predecessor.
  assert.equal(describeBoundary(diffs, 0).isHardCut, false)
})

test("a spike that dominates its neighbours is a hard cut", () => {
  const boundary = describeBoundary(withCutAt(20, 10), 10)
  assert.equal(boundary.aboveFloor, true)
  assert.equal(boundary.dominates, true)
  assert.equal(boundary.noBlend, true)
  assert.equal(boundary.isHardCut, true)
})

test("a two-frame dissolve is REFUSED — the neighbour carries too much of the change", () => {
  const diffs = orbit(20)
  diffs[10] = 50
  diffs[11] = 45 // the blended frame
  const report = checkExpectedCuts(diffs, [10], { tolerance: 0 })
  assert.equal(report.pass, false)
  assert.equal(report.expected[0].boundary.noBlend, false)
})

test("a ramp is refused even when its peak is large", () => {
  const diffs = [0, 5, 12, 26, 48, 70, 48, 26, 12, 5]
  assert.deepEqual(detectCuts(diffs).map((c) => c.index), [])
})

test("a fast whip pan is refused: big, but not big RELATIVE to its neighbours", () => {
  const diffs = [0, 30, 34, 36, 35, 31]
  assert.deepEqual(detectCuts(diffs).map((c) => c.index), [])
})

test("a small change is refused however isolated it is", () => {
  const diffs = [0, 0, 0, DEFAULT_CUT_THRESHOLDS.minSpike - 1, 0, 0]
  assert.deepEqual(detectCuts(diffs).map((c) => c.index), [])
  const diffsAtFloor = [0, 0, 0, DEFAULT_CUT_THRESHOLDS.minSpike, 0, 0]
  assert.deepEqual(detectCuts(diffsAtFloor).map((c) => c.index), [3])
})

test("the fixture's three boundaries are found, and the offset is reported not absorbed", () => {
  const diffs = orbit(720)
  diffs[360] = 95
  diffs[433] = 88 // one frame late
  diffs[492] = 91
  const report = checkExpectedCuts(diffs, [360, 432, 492], { tolerance: 1 })
  assert.equal(report.pass, true)
  assert.deepEqual(report.expected.map((e) => e.offset), [0, 1, 0])
  assert.deepEqual(report.unexpectedIndices, [])
})

test("a cut outside the tolerance fails, and a cut nobody asked for is reported", () => {
  const diffs = orbit(720)
  diffs[363] = 95 // three frames late
  diffs[432] = 88
  diffs[492] = 91
  diffs[600] = 99 // an extra cut
  const report = checkExpectedCuts(diffs, [360, 432, 492], { tolerance: 1 })
  assert.equal(report.pass, false)
  assert.equal(report.expected[0].matchedIndex, null)
  assert.deepEqual(report.unexpectedIndices, [363, 600])
})

test("neighbourValues treats the ends as zero rather than inventing a frame", () => {
  assert.deepEqual(neighbourValues([0, 9], 1), { at: 9, before: 0, after: 0 })
  assert.deepEqual(neighbourValues([0, 5, 9], 2), { at: 9, before: 5, after: 0 })
})

test("shot windows are derived from the cut list, so one edit moves both", () => {
  assert.deepEqual(shotWindows([360, 432, 492], 720), [
    { index: 0, from: 0, to: 360 },
    { index: 1, from: 360, to: 432 },
    { index: 2, from: 432, to: 492 },
    { index: 3, from: 492, to: 720 },
  ])
})
