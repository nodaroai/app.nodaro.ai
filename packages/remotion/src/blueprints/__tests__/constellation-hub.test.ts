import { describe, it, expect, vi } from "vitest"

// Stub out module-level side effects before importing the component file
vi.mock("remotion", () => ({
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 300 }),
}))
vi.mock("../../lib/font-registry", () => ({
  FONT_MAP: { Montserrat: "Montserrat, sans-serif" },
  SUPPORTED_FONTS: ["Montserrat"],
}))

import { ringNodeTransform, ENTRANCE_STAGGER_FRAMES, RESOLVE_FRACTION } from "../constellation-hub"

const DURATION = 180
const COUNT = 6

describe("ringNodeTransform", () => {
  it("staggers entrances — node 0 has entered (scale > 0) while the last node has not", () => {
    const probeFrame = ENTRANCE_STAGGER_FRAMES + 2 // after node 0 starts, before node 5 starts
    const first = ringNodeTransform(probeFrame, DURATION, 0, COUNT, "push-in")
    const last = ringNodeTransform(probeFrame, DURATION, COUNT - 1, COUNT, "push-in")
    expect(first.scale).toBeGreaterThan(0)
    expect(last.scale).toBe(0)
  })

  it("has scale 0 at frame 0 for the last node (not yet entered)", () => {
    const last = ringNodeTransform(0, DURATION, COUNT - 1, COUNT, "push-in")
    expect(last.scale).toBe(0)
  })

  it("places nodes on the unit ring (x²+y² = 1) for both finishers at all phases", () => {
    for (const finisher of ["push-in", "orbit"] as const) {
      for (const frame of [40, 90, 140, 179]) {
        for (let i = 0; i < COUNT; i++) {
          const { x, y } = ringNodeTransform(frame, DURATION, i, COUNT, finisher)
          expect(x * x + y * y).toBeCloseTo(1, 6)
        }
      }
    }
  })

  it("push-in: blur is 0 before the resolve phase and grows monotonically after", () => {
    const beforeResolve = Math.floor(DURATION * RESOLVE_FRACTION) - 2
    const early = ringNodeTransform(beforeResolve, DURATION, 2, COUNT, "push-in")
    expect(early.blur).toBe(0)
    const mid = ringNodeTransform(Math.round(DURATION * 0.6), DURATION, 2, COUNT, "push-in")
    const late = ringNodeTransform(Math.round(DURATION * 0.85), DURATION, 2, COUNT, "push-in")
    expect(mid.blur).toBeGreaterThan(0)
    expect(late.blur).toBeGreaterThan(mid.blur)
  })

  it("orbit: blur stays 0 at every phase and scale settles at 1 after entrance", () => {
    for (const frame of [10, 50, 90, 140, 179]) {
      const t = ringNodeTransform(frame, DURATION, 0, COUNT, "orbit")
      expect(t.blur).toBe(0)
    }
    const settled = ringNodeTransform(Math.round(DURATION * 0.4), DURATION, 0, COUNT, "orbit")
    expect(settled.scale).toBeCloseTo(1, 6)
  })

  it("orbit: ring actually rotates during the resolve phase (positions change)", () => {
    const start = Math.ceil(DURATION * RESOLVE_FRACTION) + 1
    const a = ringNodeTransform(start, DURATION, 0, COUNT, "orbit")
    const b = ringNodeTransform(start + 30, DURATION, 0, COUNT, "orbit")
    const moved = Math.hypot(a.x - b.x, a.y - b.y)
    expect(moved).toBeGreaterThan(0.05)
  })

  it("push-in: positions do NOT rotate (the camera move is a group transform, not node motion)", () => {
    const start = Math.ceil(DURATION * RESOLVE_FRACTION) + 1
    const a = ringNodeTransform(start, DURATION, 0, COUNT, "push-in")
    const b = ringNodeTransform(start + 30, DURATION, 0, COUNT, "push-in")
    expect(a.x).toBeCloseTo(b.x, 9)
    expect(a.y).toBeCloseTo(b.y, 9)
  })

  it("entrance overshoot never exceeds ~1.15 and settles to 1", () => {
    let max = 0
    for (let f = 0; f <= 40; f++) {
      max = Math.max(max, ringNodeTransform(f, DURATION, 0, COUNT, "orbit").scale)
    }
    expect(max).toBeLessThanOrEqual(1.15)
    expect(ringNodeTransform(40, DURATION, 0, COUNT, "orbit").scale).toBeCloseTo(1, 6)
  })
})
