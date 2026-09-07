import { describe, it, expect } from "vitest"
import {
  planObjects,
  planCamera,
  planFps,
  planDurationInFrames,
  planDimensions,
  planBackgroundColor,
  planRevisionId,
  isRenderableScene,
  vec3,
  finite,
} from "../plan-view"
import { makePlan, REV_A } from "./fixture"

describe("scene3d plan readers", () => {
  it("reads the fields a well-formed plan carries", () => {
    const plan = makePlan()
    expect(planRevisionId(plan)).toBe(REV_A)
    expect(planFps(plan)).toBe(24)
    expect(planDurationInFrames(plan)).toBe(96)
    expect(planDimensions(plan)).toEqual({ width: 1920, height: 1080 })
    expect(planBackgroundColor(plan)).toBe("#101014")
    expect(planObjects(plan).map((o) => o.id)).toEqual(["ground", "hero"])
    expect(planCamera(plan).focalLengthMm).toBe(50)
    expect(planObjects(plan)[1].keyframeCount).toBe(2)
    expect(isRenderableScene(plan)).toBe(true)
  })

  it("never throws on a malformed plan — it falls back", () => {
    const junk = { fps: "24", durationInFrames: -3, objects: "nope", camera: 7, width: NaN }
    expect(planFps(junk)).toBe(24)
    expect(planDurationInFrames(junk)).toBe(96)
    expect(planDimensions(junk)).toEqual({ width: 1920, height: 1080 })
    expect(planObjects(junk)).toEqual([])
    expect(planCamera(junk).position).toEqual([0, 2, 6])
    expect(planRevisionId(junk)).toBeUndefined()
    expect(isRenderableScene(junk)).toBe(false)
  })

  it("drops objects with no id — an unaddressable row would be an uneditable lie", () => {
    const plan = makePlan({
      objects: [
        { name: "nameless", primitive: "box", dimensions: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#fff" },
        { id: "real", name: "Real", primitive: "box", dimensions: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#fff" },
      ],
    })
    expect(planObjects(plan).map((o) => o.id)).toEqual(["real"])
  })

  it("coerces non-finite numbers rather than passing NaN to an input", () => {
    expect(finite(Number.NaN, 3)).toBe(3)
    expect(finite(Number.POSITIVE_INFINITY, 3)).toBe(3)
    expect(finite("5", 3)).toBe(3)
    expect(vec3([1, Number.NaN, 3])).toEqual([1, 0, 3])
    expect(vec3([1, 2])).toEqual([0, 0, 0])
  })

  it("returns a fresh triple each call (no shared fallback array)", () => {
    const a = vec3(undefined)
    const b = vec3(undefined)
    a[0] = 99
    expect(b[0]).toBe(0)
  })
})
