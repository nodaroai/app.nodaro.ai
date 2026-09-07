import { describe, it, expect } from "vitest"
import { SCENE3D_LIMITS } from "@nodaro/shared"
import {
  buildObjectColorOperation,
  buildBackgroundOperation,
  buildRemoveObjectOperation,
  clampChannelValue,
  clampCoordinate,
  clampFocalLength,
  withAxis,
  ROTATION_LIMIT,
} from "../edit-operations"

describe("vector helpers", () => {
  it("withAxis returns a new triple and leaves the input alone", () => {
    const source: [number, number, number] = [1, 2, 3]
    const next = withAxis(source, "y", 9)
    expect(next).toEqual([1, 9, 3])
    expect(source).toEqual([1, 2, 3])
  })

  /**
   * The bounds are READ from the shared limits rather than restated, so this
   * asserts against `SCENE3D_LIMITS` too: a test with its own copy of the
   * numbers would keep passing on the day the contract moves — which is the
   * drift this replaced (a local `SCALE_LIMIT` of 100 against a shared
   * `maxScale` of 1000 silently clamped legal values away).
   */
  it("clamps each channel to the range the shared schema accepts", () => {
    expect(clampChannelValue("position", 10_000)).toBe(SCENE3D_LIMITS.maxCoordinate)
    expect(clampChannelValue("position", -10_000)).toBe(-SCENE3D_LIMITS.maxCoordinate)
    expect(clampChannelValue("dimensions", 0)).toBe(SCENE3D_LIMITS.minSize)
    expect(clampChannelValue("dimensions", 10_000)).toBe(SCENE3D_LIMITS.maxSize)
    expect(clampChannelValue("scale", -4)).toBe(SCENE3D_LIMITS.minScale)
    expect(clampChannelValue("scale", 10_000)).toBe(SCENE3D_LIMITS.maxScale)
    expect(clampChannelValue("position", Number.NaN)).toBe(-SCENE3D_LIMITS.maxCoordinate)
  })

  it("keeps rotation on the canvas's own, TIGHTER bound (a spin box range)", () => {
    expect(clampChannelValue("rotation", 100)).toBeCloseTo(ROTATION_LIMIT)
    // Tighter than the schema's, so every value it produces is still legal.
    expect(ROTATION_LIMIT).toBeLessThan(1000)
  })

  it("clamps camera coordinates and focal length to the shared limits", () => {
    expect(clampCoordinate(10_000)).toBe(SCENE3D_LIMITS.maxCoordinate)
    expect(clampFocalLength(500)).toBe(SCENE3D_LIMITS.maxFocalLengthMm)
    expect(clampFocalLength(1)).toBe(SCENE3D_LIMITS.minFocalLengthMm)
  })
})

describe("non-animated operation builders", () => {
  it("returns null for a change that changes nothing — history stays meaningful", () => {
    expect(buildObjectColorOperation("hero", "#ffffff", "#ffffff")).toBeNull()
    expect(buildBackgroundOperation("#000000", "#000000")).toBeNull()
  })

  it("builds colour, background and remove operations", () => {
    expect(buildObjectColorOperation("hero", "#ff0073", "#000000")).toEqual({
      op: "set-object",
      objectId: "hero",
      changes: { color: "#ff0073" },
    })
    expect(buildBackgroundOperation("#ff0073", "#000000")).toEqual({ op: "set-background", color: "#ff0073" })
    expect(buildRemoveObjectOperation("hero")).toEqual({ op: "remove-object", objectId: "hero" })
  })
})
