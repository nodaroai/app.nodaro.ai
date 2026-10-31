import { describe, expect, it } from "vitest"
import { frameTimesOf, maskFramesForClip, sameSpan } from "../face-mesh-timing.js"
import { frameRateOf } from "../draw-face-mesh.js"

describe("frameTimesOf", () => {
  it("sorts the packets' times (decode order is not display order) and counts from the first frame", () => {
    const t = frameTimesOf("1.040000\n1.000000\n1.120000\n1.080000\n")!
    expect(t.map((v) => Number(v.toFixed(6)))).toEqual([0, 0.04, 0.08, 0.12])
    expect(frameTimesOf("0.5,\n0.0,\n")).toEqual([0, 0.5])
  })
  it("a time it cannot read, or none: null", () => {
    expect(frameTimesOf("0.0\nN/A\n")).toBeNull()
    expect(frameTimesOf("")).toBeNull()
  })
})

describe("maskFramesForClip", () => {
  it("the same clock: frame for frame", () => {
    const t = [0, 1 / 30, 2 / 30, 3 / 30]
    expect([...maskFramesForClip(t, t)]).toEqual([0, 1, 2, 3])
  })

  it("a variable-rate clip against its 30 fps mask: the mask frame shown at each clip frame's moment", () => {
    const clip = [0, 0.05, 0.051, 0.2, 0.5]
    const mask = Array.from({ length: 16 }, (_, i) => i / 30)
    // 0.05 s is mask frame 1 (0.0333); 0.2 is frame 6 (0.2 exactly, within the half millisecond); 0.5 is frame 15.
    expect([...maskFramesForClip(clip, mask)]).toEqual([0, 1, 1, 6, 15])
  })

  it("never runs past the mask's last frame, and never goes back", () => {
    const out = [...maskFramesForClip([0, 1, 2, 9], [0, 0.5, 1])]
    expect(out).toEqual([0, 2, 2, 2])
    expect(out.every((v, i) => i === 0 || v >= out[i - 1]!)).toBe(true)
  })
})

describe("sameSpan", () => {
  it("within half a second or 5 %, else not this clip's mask", () => {
    expect(sameSpan([0, 10], [0, 10.4])).toBe(true)
    expect(sameSpan([0, 20], [0, 20.9])).toBe(true)
    expect(sameSpan([0, 10], [0, 12])).toBe(false)
  })
})

describe("frameRateOf", () => {
  it("a constant-rate clip: its nominal rate, even when the average rounds a little off", () => {
    expect(frameRateOf({ rFrameRate: "30/1", avgFrameRate: "30/1" })).toBe("30/1")
    expect(frameRateOf({ rFrameRate: "30/1", avgFrameRate: "7200/241" })).toBe("30/1")
  })
  it("a variable-rate clip: its average, so its length (and its audio's sync) is kept", () => {
    expect(frameRateOf({ rFrameRate: "2/1", avgFrameRate: "26/15" })).toBe("26/15")
    expect(frameRateOf({ rFrameRate: undefined, avgFrameRate: "24/1" })).toBe("24/1")
    expect(frameRateOf({ rFrameRate: "0/0", avgFrameRate: "0/0" })).toBe("30/1")
  })
})
