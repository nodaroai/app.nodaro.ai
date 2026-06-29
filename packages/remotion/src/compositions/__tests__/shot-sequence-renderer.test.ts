import { describe, it, expect } from "vitest"
import { computeRevealOpacity, sceneCrossfadeOpacity } from "../shot-sequence-renderer.js"

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
