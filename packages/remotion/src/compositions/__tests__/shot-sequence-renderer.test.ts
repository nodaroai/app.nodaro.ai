import { describe, it, expect } from "vitest"
import { computeRevealOpacity, sceneCrossfadeOpacity, cutCurveTransform } from "../shot-sequence-renderer.js"

describe("computeRevealOpacity", () => {
  it("multiplies base × enter × exit", () => {
    expect(computeRevealOpacity(0.8, 0.5, 1)).toBeCloseTo(0.4)
  })
  it("defaults base to 1 when undefined", () => {
    expect(computeRevealOpacity(undefined, 0.5, 1)).toBeCloseTo(0.5)
  })
  it("a fully exited reveal is invisible", () => {
    expect(computeRevealOpacity(1, 1, 0)).toBe(0)
  })
})

describe("sceneCrossfadeOpacity", () => {
  const DUR = 100
  it("is fully opaque with no transitions", () => {
    expect(sceneCrossfadeOpacity(50, DUR, undefined, undefined)).toBe(1)
    expect(sceneCrossfadeOpacity(50, DUR, 0, 0)).toBe(1)
  })
  it("fades IN 0→1 over the first transitionInFrames", () => {
    expect(sceneCrossfadeOpacity(0, DUR, 3, 4)).toBeCloseTo(0) // first frame invisible → outgoing shows through
    expect(sceneCrossfadeOpacity(1, DUR, 3, 4)).toBeCloseTo(1 / 3)
    expect(sceneCrossfadeOpacity(3, DUR, 3, 4)).toBeCloseTo(1) // fully in by frame 3
  })
  it("is fully opaque through the middle of the window", () => {
    expect(sceneCrossfadeOpacity(50, DUR, 3, 4)).toBe(1)
    expect(sceneCrossfadeOpacity(DUR - 1, DUR, 3, 4)).toBe(1)
  })
  it("fades OUT 1→0 across the overlap tail past the window", () => {
    expect(sceneCrossfadeOpacity(DUR, DUR, 3, 4)).toBeCloseTo(1) // start of out-fade
    expect(sceneCrossfadeOpacity(DUR + 2, DUR, 3, 4)).toBeCloseTo(0.5)
    expect(sceneCrossfadeOpacity(DUR + 4, DUR, 3, 4)).toBeCloseTo(0)
    expect(sceneCrossfadeOpacity(DUR + 10, DUR, 3, 4)).toBe(0) // clamped past the tail
  })
  it("a first scene (in-fade only) opens at full opacity", () => {
    expect(sceneCrossfadeOpacity(0, DUR, undefined, 4)).toBe(1)
  })
})

describe("cutCurveTransform", () => {
  const DUR = 100
  const WIDTH = 1000
  const HEIGHT = 500
  // DISTANCE_FRACTION = 0.12 → x-axis distance 120, y-axis distance 60.
  const XDIST = 120
  const YDIST = 60
  const NONE = {}

  it("with no type on either half, matches sceneCrossfadeOpacity exactly and never moves", () => {
    for (const frame of [0, 1, 3, 50, DUR - 1, DUR, DUR + 2, DUR + 4, DUR + 10]) {
      const t = cutCurveTransform(frame, DUR, WIDTH, HEIGHT, { frames: 3 }, { frames: 4 })
      expect(t.x).toBe(0)
      expect(t.y).toBe(0)
      expect(t.opacity).toBeCloseTo(sceneCrossfadeOpacity(frame, DUR, 3, 4))
    }
  })

  it("with entry.frames but no type, behaves as a plain linear fade-in (not early-completing)", () => {
    const entry = { frames: 10 }
    expect(cutCurveTransform(0, DUR, WIDTH, HEIGHT, entry, NONE).opacity).toBeCloseTo(0)
    expect(cutCurveTransform(5, DUR, WIDTH, HEIGHT, entry, NONE).opacity).toBeCloseTo(0.5)
    expect(cutCurveTransform(10, DUR, WIDTH, HEIGHT, entry, NONE).opacity).toBeCloseTo(1)
  })

  it.each([
    ["left", -XDIST, 0],
    ["right", XDIST, 0],
    ["up", 0, -YDIST],
    ["down", 0, YDIST],
  ] as const)("exit cut-the-curve %s: position reaches the direction's signed distance and opacity completes early", (direction, ex, ey) => {
    const exit = { frames: 10, type: "cut-the-curve" as const, direction }
    // At the start of the exit window: no travel yet, fully opaque.
    const start = cutCurveTransform(DUR, DUR, WIDTH, HEIGHT, NONE, exit)
    expect(start.x).toBe(0)
    expect(start.y).toBe(0)
    expect(start.opacity).toBe(1)
    // At t=0.3 (EXIT_FADE_FRACTION) opacity has just completed its fade to 0.
    const fadeComplete = cutCurveTransform(DUR + 3, DUR, WIDTH, HEIGHT, NONE, exit)
    expect(fadeComplete.opacity).toBeCloseTo(0, 5)
    // By the end of the window (t=1), position has reached the full signed distance —
    // opacity stays clamped at 0 (faded out well before the position finishes).
    const end = cutCurveTransform(DUR + 10, DUR, WIDTH, HEIGHT, NONE, exit)
    expect(end.x).toBeCloseTo(ex, 5)
    expect(end.y).toBeCloseTo(ey, 5)
    expect(end.opacity).toBe(0)
  })

  it.each([
    ["left", XDIST, 0],
    ["right", -XDIST, 0],
    ["up", 0, YDIST],
    ["down", 0, -YDIST],
  ] as const)("entry cut-the-curve %s: starts at the OPPOSITE signed distance from that direction's exit and lands at 0", (direction, startX, startY) => {
    const entry = { frames: 10, type: "cut-the-curve" as const, direction }
    const start = cutCurveTransform(0, DUR, WIDTH, HEIGHT, entry, NONE)
    expect(start.x).toBeCloseTo(startX, 5)
    expect(start.y).toBeCloseTo(startY, 5)
    // Opacity ramps in fast — fully visible well before the position settles.
    const mostlyIn = cutCurveTransform(4, DUR, WIDTH, HEIGHT, entry, NONE) // t=0.4 > ENTRY_FADE_FRACTION=0.35
    expect(mostlyIn.opacity).toBe(1)
    const end = cutCurveTransform(10, DUR, WIDTH, HEIGHT, entry, NONE)
    expect(end.x).toBeCloseTo(0, 5)
    expect(end.y).toBeCloseTo(0, 5)
    expect(end.opacity).toBe(1)
  })

  it("holds at rest (0,0, fully opaque) between the entry and exit windows", () => {
    const t = cutCurveTransform(
      50,
      DUR,
      WIDTH,
      HEIGHT,
      { frames: 10, type: "cut-the-curve", direction: "left" },
      { frames: 10, type: "cut-the-curve", direction: "up" },
    )
    expect(t).toEqual({ x: 0, y: 0, opacity: 1 })
  })

  it("mixed halves: a scene can inherit a plain-crossfade entry but author its own cut-the-curve exit", () => {
    const entry = { frames: 3 } // no type — plain fade
    const exit = { frames: 10, type: "cut-the-curve" as const, direction: "up" as const }
    // Entry window: linear fade, no motion (crossfade formula, matches sceneCrossfadeOpacity).
    const midEntry = cutCurveTransform(1, DUR, WIDTH, HEIGHT, entry, exit)
    expect(midEntry.x).toBe(0)
    expect(midEntry.y).toBe(0)
    expect(midEntry.opacity).toBeCloseTo(1 / 3)
    // Exit window: directional cut on its own terms, independent of the entry's type.
    const endExit = cutCurveTransform(DUR + 10, DUR, WIDTH, HEIGHT, entry, exit)
    expect(endExit.y).toBeCloseTo(-YDIST, 5)
    expect(endExit.opacity).toBe(0)
  })

  it("a scene's inherited entry direction and its own exit direction can genuinely differ", () => {
    const entry = { frames: 10, type: "cut-the-curve" as const, direction: "left" as const }
    const exit = { frames: 10, type: "cut-the-curve" as const, direction: "up" as const }
    const entryStart = cutCurveTransform(0, DUR, WIDTH, HEIGHT, entry, exit)
    expect(entryStart.x).toBeCloseTo(XDIST, 5) // "left" entry starts on the x-axis
    expect(entryStart.y).toBe(0)
    const exitEnd = cutCurveTransform(DUR + 10, DUR, WIDTH, HEIGHT, entry, exit)
    expect(exitEnd.x).toBe(0)
    expect(exitEnd.y).toBeCloseTo(-YDIST, 5) // "up" exit ends on the y-axis — independent axis from entry
  })
})
