// Colour segmentation and the table fixture's verdict, on synthetic frames.
//
// Every number the table probe reports comes from these two modules, so they
// are tested on frames whose content is known exactly: a grey room with
// rectangles of the six identity colours painted at chosen positions and
// sizes. If a threshold here is wrong, a real fixture run reports a confident
// number about the wrong pixels.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_THRESHOLDS, PILOT_RED_THRESHOLDS, PROXY_COLORS, classifyPixel, countPilotRed,
  hueDistance, longestAbsenceWindow, rgbToHsv, segmentFrame,
} from "../scene3d-acceptance/lib/color.mjs"
import { DEFAULT_FIXTURE_THRESHOLDS, TABLE_CUTS, evaluateTableFixture, motionSeries, rangeStats, tableShots } from "../scene3d-acceptance/lib/fixture-table.mjs"

const RGB = {
  red: [220, 20, 20],
  green: [20, 200, 20],
  blue: [30, 30, 220],
  yellow: [220, 220, 20],
  purple: [170, 30, 220],
  cyan: [20, 210, 210],
  grey: [128, 128, 128],
  shadow: [8, 8, 8],
}

/** A grey frame with coloured rectangles painted into it. */
function frame(width, height, rects, background = RGB.grey) {
  const buffer = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    buffer[i * 3] = background[0]
    buffer[i * 3 + 1] = background[1]
    buffer[i * 3 + 2] = background[2]
  }
  for (const { colour, x0, y0, x1, y1 } of rects) {
    const [r, g, b] = RGB[colour]
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 3
        buffer[i] = r
        buffer[i + 1] = g
        buffer[i + 2] = b
      }
    }
  }
  return buffer
}

test("hsv conversion and hue distance wrap correctly around red", () => {
  assert.deepEqual(rgbToHsv(255, 0, 0), { h: 0, s: 1, v: 1 })
  assert.equal(Math.round(rgbToHsv(0, 255, 0).h), 120)
  assert.equal(hueDistance(350, 10), 20)
  assert.equal(hueDistance(0, 180), 180)
})

test("each identity colour classifies as itself, and nothing else does", () => {
  for (const colour of PROXY_COLORS) {
    assert.equal(classifyPixel(...RGB[colour]), colour, `${colour} misclassified`)
  }
  // The room, the tabletop and a shadow must never be attributed to a proxy.
  assert.equal(classifyPixel(...RGB.grey), null)
  assert.equal(classifyPixel(...RGB.shadow), null)
  // Nor must a colour that sits between two centres.
  assert.equal(classifyPixel(150, 90, 30), null, "an orange between red and yellow was claimed by one of them")
})

test("segmentFrame reports area, foreground-band occupancy and centroid", () => {
  // 100x100: a 10x10 blue square high in the frame, a 20x20 green block at the bottom.
  const width = 100
  const height = 100
  const rgb = frame(width, height, [
    { colour: "blue", x0: 10, y0: 10, x1: 20, y1: 20 },
    { colour: "green", x0: 40, y0: 80, x1: 60, y1: 100 },
  ])
  const seg = segmentFrame(rgb, width, height)
  assert.equal(seg.colors.blue.pixels, 100)
  assert.equal(seg.colors.blue.area, 0.01)
  assert.equal(seg.colors.blue.foregroundArea, 0, "a square at the top of the frame is not a foreground mass")
  assert.equal(seg.colors.green.pixels, 400)
  // The foreground band is the bottom 40% of the frame: 100x40 = 4000 pixels.
  assert.equal(seg.colors.green.foregroundArea, 400 / 4000)
  assert.deepEqual(seg.colors.green.centroid, { x: 49.5, y: 89.5 })
  assert.deepEqual(seg.colors.green.bbox, { x0: 40, y0: 80, x1: 59, y1: 99 })
  assert.equal(seg.colors.red.pixels, 0)
  assert.equal(seg.colors.red.centroid, null)
  // Everything not a proxy and not crushed to black is the room.
  assert.equal(seg.grey.pixels, width * height - 500)
})

test("the grey mass ignores shadow, so a dark frame does not fake a camera move", () => {
  const rgb = frame(20, 20, [{ colour: "shadow", x0: 0, y0: 0, x1: 20, y1: 10 }])
  const seg = segmentFrame(rgb, 20, 20)
  assert.equal(seg.grey.pixels, 200, "only the lit half is room")
  assert.equal(seg.grey.centroid.y, 14.5)
})

test("the pilot red count reads a central column, byte-for-byte as published", () => {
  const width = 100
  const height = 50
  // A red block on the far left — outside a 25% central column.
  const left = frame(width, height, [{ colour: "red", x0: 0, y0: 10, x1: 10, y1: 20 }])
  assert.equal(countPilotRed(left, width, height, { centralFraction: 0.25 }), 0)
  assert.equal(countPilotRed(left, width, height, { centralFraction: 1 }), 100)
  // The same block in the middle is seen by both.
  const middle = frame(width, height, [{ colour: "red", x0: 45, y0: 10, x1: 55, y1: 20 }])
  assert.ok(countPilotRed(middle, width, height, { centralFraction: 0.25 }) > 0)
  // Purple is not red, however much red it contains.
  const purple = frame(width, height, [{ colour: "purple", x0: 45, y0: 10, x1: 55, y1: 20 }])
  assert.equal(countPilotRed(purple, width, height, { centralFraction: 1 }), 0)
})

test("the absence window is the LONGEST run below the floor, reported in seconds", () => {
  const counts = [50, 50, 0, 0, 0, 40, 0, 0, 60, 60]
  const window = longestAbsenceWindow(counts, 24, PILOT_RED_THRESHOLDS.absencePixels)
  assert.deepEqual(window, { startFrame: 2, endFrame: 4, frames: 3, startSeconds: 2 / 24, endSeconds: 5 / 24 })
  assert.equal(longestAbsenceWindow([50, 50, 50], 24), null)
})

// --- the fixture verdict --------------------------------------------------

/** A segment record with the given per-colour areas. */
function seg({ areas = {}, foreground = {}, greyCentroid = { x: 0, y: 0 } } = {}) {
  const colors = {}
  for (const colour of PROXY_COLORS) {
    colors[colour] = {
      pixels: 0,
      area: areas[colour] ?? 0,
      foregroundArea: foreground[colour] ?? 0,
      centroid: (areas[colour] ?? 0) > 0 ? { x: 10, y: 10 } : null,
      bbox: null,
    }
  }
  return { width: 384, height: 164, total: 384 * 164, bandStartY: 98, colors, grey: { pixels: 1, area: 0.5, centroid: greyCentroid } }
}

/** A 720-frame fixture that satisfies every clause of section 6A. */
function passingFixture() {
  const segments = []
  for (let i = 0; i < 720; i++) {
    if (i < 360) {
      // Orbit: the camera passes behind red early and cyan mid-shot.
      const foreground = {}
      if (i < 60) foreground.red = 0.3
      if (i >= 150 && i < 210) foreground.cyan = 0.3
      segments.push(seg({ areas: { yellow: 0.01, blue: 0.01, green: 0.01 }, foreground, greyCentroid: { x: 10 + Math.sin(i / 20) * 4, y: 10 } }))
    } else if (i < 432) {
      segments.push(seg({ areas: { cyan: 0.01 }, foreground: { blue: 0.25 } }))
    } else if (i < 492) {
      segments.push(seg({ areas: { red: 0.01 }, foreground: { yellow: 0.25 } }))
    } else {
      const areas = i < 606 ? { purple: 0.01 } : { cyan: 0.01 }
      segments.push(seg({ areas, foreground: { green: 0.25 } }))
    }
  }
  const diffs = segments.map((_, i) => (i === 0 ? 0 : 3))
  for (const cut of TABLE_CUTS) diffs[cut] = 90
  return { segments, diffs }
}

test("the four shots are derived from the cut list", () => {
  const shots = tableShots()
  assert.deepEqual(shots.map((s) => [s.from, s.to]), [[0, 360], [360, 432], [432, 492], [492, 720]])
  assert.equal(shots[1].subject, "cyan")
  assert.equal(shots[1].shoulder, "blue")
  assert.deepEqual(shots[3].gaze, { from: "purple", to: "cyan", midpoint: 606 })
})

test("rangeStats counts frames at or above the floor, and reports the spread", () => {
  const segments = [seg({ areas: { cyan: 0.02 } }), seg({ areas: { cyan: 0.0001 } }), seg({ areas: { cyan: 0.02 } })]
  const stats = rangeStats(segments, 0, 3, "cyan", "area", 0.0015)
  assert.equal(stats.framesAtOrAboveFloor, 2)
  assert.equal(stats.fraction, 2 / 3)
  assert.equal(stats.max, 0.02)
  assert.equal(stats.min, 0.0001)
})

test("a fixture satisfying every clause passes", () => {
  const { segments, diffs } = passingFixture()
  const verdict = evaluateTableFixture({ segments, diffs })
  assert.equal(verdict.cuts.pass, true, JSON.stringify(verdict.cuts.expected.map((e) => e.matchedIndex)))
  for (const window of verdict.windows) {
    assert.equal(window.pass, true, `shot ${window.index + 1} failed: ${JSON.stringify(window.checks.filter((c) => !c.pass))}`)
  }
  assert.equal(verdict.pass, true)
})

test("a subject visible as a tiny dot fails — the spec refuses to accept one", () => {
  const { segments, diffs } = passingFixture()
  for (let i = 360; i < 432; i++) segments[i] = seg({ areas: { cyan: 0.00001 }, foreground: { blue: 0.25 } })
  const verdict = evaluateTableFixture({ segments, diffs })
  assert.equal(verdict.pass, false)
  const shot2 = verdict.windows[1]
  assert.equal(shot2.checks.find((c) => /cyan is visible/.test(c.what)).pass, false)
})

test("a shoulder that leaves the foreground band mid-window fails", () => {
  const { segments, diffs } = passingFixture()
  for (let i = 492; i < 620; i++) segments[i] = seg({ areas: { purple: 0.01 }, foreground: { green: 0 } })
  const verdict = evaluateTableFixture({ segments, diffs })
  assert.equal(verdict.windows[3].checks.find((c) => /green holds the foreground/.test(c.what)).pass, false)
})

test("the gaze must actually arrive: cyan absent at the end fails shot 4", () => {
  const { segments, diffs } = passingFixture()
  for (let i = 606; i < 720; i++) segments[i] = seg({ areas: { purple: 0.01 }, foreground: { green: 0.25 } })
  const verdict = evaluateTableFixture({ segments, diffs })
  const endCheck = verdict.windows[3].checks.find((c) => /cyan is clear at the end/.test(c.what))
  assert.equal(endCheck.pass, false)
})

test("a missing orbit fly-behind fails shot 1 without touching the others", () => {
  const { segments, diffs } = passingFixture()
  for (let i = 150; i < 210; i++) segments[i] = seg({ areas: { yellow: 0.01 }, foreground: {} })
  const verdict = evaluateTableFixture({ segments, diffs })
  assert.equal(verdict.windows[0].pass, false)
  assert.equal(verdict.windows[1].pass, true)
})

test("thresholds are inputs, so a verdict can be re-judged without re-rendering", () => {
  const { segments, diffs } = passingFixture()
  for (let i = 360; i < 432; i++) segments[i] = seg({ areas: { cyan: 0.001 }, foreground: { blue: 0.25 } })
  assert.equal(evaluateTableFixture({ segments, diffs }).windows[1].pass, false)
  const relaxed = evaluateTableFixture({ segments, diffs, thresholds: { minSubjectArea: 0.0005 } })
  assert.equal(relaxed.windows[1].pass, true)
  assert.equal(relaxed.thresholds.minSubjectArea, 0.0005)
  assert.equal(relaxed.thresholds.windowFrameFraction, DEFAULT_FIXTURE_THRESHOLDS.windowFrameFraction)
})

test("motion is two series: the room (camera) and the proxies (camera + breathing)", () => {
  const segments = [
    seg({ areas: { red: 0.01 }, greyCentroid: { x: 0, y: 0 } }),
    seg({ areas: { red: 0.01 }, greyCentroid: { x: 3, y: 4 } }),
  ]
  const { camera, subject } = motionSeries(segments)
  assert.deepEqual(camera, [5])
  // Both frames put the proxy centroid at the same place, so the subject series is still.
  assert.deepEqual(subject, [0])
})

test("DEFAULT_THRESHOLDS keeps every hue centre unambiguous", () => {
  // The tightest gap between two centres is blue 240 → purple 285 = 45°;
  // a ceiling at or above half of that could claim a pixel for either.
  assert.ok(DEFAULT_THRESHOLDS.maxHueDistance < 45 / 2)
})
