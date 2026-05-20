/**
 * Unit tests for the FFmpeg expression builders in speed-ramp.ts.
 *
 * These cover the algorithmic core that turns user input into FFmpeg filter
 * strings — no actual FFmpeg invocation. The integration test for the real
 * runFfmpeg path lives elsewhere (and is gated behind an env flag because it
 * needs a video file + ffmpeg binary).
 */

import { describe, it, expect } from "vitest"
import {
  buildAtempoChain,
  buildRampSetptsExpression,
  resolveAudioMode,
  type SpeedRampSegment,
} from "../speed-ramp.js"

describe("buildAtempoChain", () => {
  it("passes a single atempo filter for speeds in [0.5, 100]", () => {
    expect(buildAtempoChain(1.0)).toEqual(["atempo=1"])
    expect(buildAtempoChain(0.5)).toEqual(["atempo=0.5"])
    expect(buildAtempoChain(2.0)).toEqual(["atempo=2"])
    expect(buildAtempoChain(99.9)).toEqual(["atempo=99.9"])
  })

  it("chains atempo=0.5 to reach speeds below 0.5", () => {
    // 0.25 = 0.5 * 0.5
    const r = buildAtempoChain(0.25)
    expect(r).toEqual(["atempo=0.5", "atempo=0.5"])
  })

  it("chains for very slow speeds (0.1)", () => {
    const r = buildAtempoChain(0.1)
    // We expect multiple atempo=0.5 stages plus a final remainder
    expect(r.filter((s) => s === "atempo=0.5").length).toBeGreaterThanOrEqual(2)
    expect(r.length).toBeGreaterThanOrEqual(3)
  })

  it("chains atempo=100 to reach speeds above 100", () => {
    const r = buildAtempoChain(250)
    expect(r[0]).toBe("atempo=100.0")
    expect(r.length).toBeGreaterThanOrEqual(2)
  })

  it("throws on non-positive speed", () => {
    expect(() => buildAtempoChain(0)).toThrow(/> 0/)
    expect(() => buildAtempoChain(-1)).toThrow(/> 0/)
  })
})

describe("buildRampSetptsExpression", () => {
  it("rejects empty ramps", () => {
    expect(() => buildRampSetptsExpression([])).toThrow(/empty/)
  })

  it("rejects segments with end <= start", () => {
    expect(() => buildRampSetptsExpression([{ start: 0, end: 0, speed: 1 }])).toThrow(/end <= start/)
    expect(() => buildRampSetptsExpression([{ start: 2, end: 1, speed: 1 }])).toThrow(/end <= start/)
  })

  it("rejects segments with non-positive speed", () => {
    expect(() => buildRampSetptsExpression([{ start: 0, end: 1, speed: 0 }])).toThrow(/speed <= 0/)
    expect(() => buildRampSetptsExpression([{ start: 0, end: 1, speed: -1 }])).toThrow(/speed <= 0/)
  })

  it("rejects overlapping segments", () => {
    const ramps: SpeedRampSegment[] = [
      { start: 0, end: 2, speed: 1 },
      { start: 1, end: 3, speed: 1 },
    ]
    expect(() => buildRampSetptsExpression(ramps)).toThrow(/overlaps/)
  })

  it("builds a single-segment expression", () => {
    const expr = buildRampSetptsExpression([{ start: 0, end: 5, speed: 0.5 }])
    // Expression ends with /TB and contains a piecewise if() guarding the segment end.
    expect(expr).toMatch(/\/TB$/)
    expect(expr).toMatch(/lt\(T,5\)/)
    // Inside-segment branch should reference the segment speed.
    expect(expr).toMatch(/0\+\(T-0\)\/0\.5/)
  })

  it("builds a three-segment expression with passthrough at edges", () => {
    // Classic action-cam ramp: normal → slow-mo → normal
    //   segment 0: 0s -> 1s at 1.0×  (output time 0 .. 1)
    //   segment 1: 1s -> 3s at 0.25× (output time 1 .. 9)
    //   segment 2: 3s -> 5s at 1.0×  (output time 9 .. 11)
    const ramps: SpeedRampSegment[] = [
      { start: 0, end: 1, speed: 1 },
      { start: 1, end: 3, speed: 0.25 },
      { start: 3, end: 5, speed: 1 },
    ]
    const expr = buildRampSetptsExpression(ramps)
    expect(expr).toMatch(/\/TB$/)
    // All three segment boundaries should appear.
    expect(expr).toMatch(/lt\(T,1\)/)
    expect(expr).toMatch(/lt\(T,3\)/)
    expect(expr).toMatch(/lt\(T,5\)/)
    // The slow-mo segment offset is cum[1] = 1, branch like "1+(T-1)/0.25".
    expect(expr).toMatch(/1\+\(T-1\)\/0\.25/)
    // The third segment offset is cum[2] = 1 + (3-1)/0.25 = 9, branch like "9+(T-3)/1".
    expect(expr).toMatch(/9\+\(T-3\)\/1/)
  })
})

describe("resolveAudioMode", () => {
  it("returns 'pitch-preserve' by default", () => {
    expect(resolveAudioMode({})).toBe("pitch-preserve")
  })

  it("honors explicit audioMode", () => {
    expect(resolveAudioMode({ audioMode: "pitch-shift" })).toBe("pitch-shift")
    expect(resolveAudioMode({ audioMode: "drop" })).toBe("drop")
    expect(resolveAudioMode({ audioMode: "pitch-preserve" })).toBe("pitch-preserve")
  })

  it("maps legacy adjustAudio when audioMode is unset", () => {
    expect(resolveAudioMode({ adjustAudio: false })).toBe("drop")
    expect(resolveAudioMode({ adjustAudio: true })).toBe("pitch-preserve")
  })

  it("forces 'drop' when ramps are set, regardless of audioMode/adjustAudio", () => {
    const ramps: SpeedRampSegment[] = [{ start: 0, end: 1, speed: 0.5 }]
    expect(resolveAudioMode({ audioMode: "pitch-preserve", ramps })).toBe("drop")
    expect(resolveAudioMode({ audioMode: "pitch-shift", ramps })).toBe("drop")
    expect(resolveAudioMode({ adjustAudio: true, ramps })).toBe("drop")
  })

  it("ignores empty ramps array", () => {
    expect(resolveAudioMode({ audioMode: "pitch-preserve", ramps: [] })).toBe("pitch-preserve")
  })
})
