import { describe, expect, it } from "vitest"
import {
  assertScene3DShotStillClaims,
  scene3DShotStillDimensions,
  scene3DShotStillSlots,
} from "../shot-stills.js"

const v2 = (starts: number[], durationInFrames = 96) => ({
  planType: "3d-scene", schemaVersion: 2, revisionId: "r", width: 1280, height: 720,
  durationInFrames,
  shots: starts.map((startFrame, i) => ({ id: `s${i}`, startFrame,
    endFrameExclusive: starts[i + 1] ?? durationInFrames })),
})
const v1 = { planType: "3d-scene", schemaVersion: 1, revisionId: "r", width: 640, height: 360, durationInFrames: 24 }

describe("which stills a composition owes", () => {
  it("reads the v2 shot order verbatim: 0-based index, the shot's own first frame", () => {
    expect(scene3DShotStillSlots(v2([0, 24, 60]))).toEqual([
      { shotIndex: 0, frame: 0 }, { shotIndex: 1, frame: 24 }, { shotIndex: 2, frame: 60 },
    ])
  })

  it("gives a single-shot v1 scene exactly one still, at frame 0", () => {
    expect(scene3DShotStillSlots(v1)).toEqual([{ shotIndex: 0, frame: 0 }])
  })

  it("refuses a composition whose shots cannot each own one still", () => {
    expect(() => scene3DShotStillSlots({ ...v2([0, 24]), shots: [] })).toThrow(/must declare its shots/)
    expect(() => scene3DShotStillSlots(v2([0, 0]))).toThrow(/distinct first frames/)
    expect(() => scene3DShotStillSlots(v2([0, 96]))).toThrow(/inside the composition/)
    expect(() => scene3DShotStillSlots(v2([0, -1]))).toThrow(/inside the composition/)
    expect(() => scene3DShotStillSlots({ ...v2([0]), shots: [{ id: "s0" }] })).toThrow(/inside the composition/)
  })
})

describe("agreeing on what was pinned", () => {
  it("accepts no stills at all — they are additive evidence", () => {
    expect(() => assertScene3DShotStillClaims(v2([0, 24]), [])).not.toThrow()
  })

  it("accepts the whole set in any order", () => {
    expect(() => assertScene3DShotStillClaims(v2([0, 24]), [
      { shotIndex: 1, frame: 24 }, { shotIndex: 0, frame: 0 },
    ])).not.toThrow()
  })

  it("refuses a partial sheet, a wrong frame, or a shot that does not exist", () => {
    expect(() => assertScene3DShotStillClaims(v2([0, 24]), [{ shotIndex: 0, frame: 0 }]))
      .toThrow(/do not match the delivered composition/)
    expect(() => assertScene3DShotStillClaims(v2([0, 24]), [
      { shotIndex: 0, frame: 0 }, { shotIndex: 1, frame: 25 },
    ])).toThrow(/do not match the delivered composition/)
    expect(() => assertScene3DShotStillClaims(v2([0, 24]), [
      { shotIndex: 0, frame: 0 }, { shotIndex: 1, frame: 24 }, { shotIndex: 2, frame: 60 },
    ])).toThrow(/do not match the delivered composition/)
    expect(() => assertScene3DShotStillClaims(v1, [{ shotIndex: 0, frame: 1 }]))
      .toThrow(/do not match the delivered composition/)
  })
})

describe("the size recorded for a still", () => {
  it("takes the composition's frame size when the producer states none", () => {
    expect(scene3DShotStillDimensions(v2([0]), {})).toEqual({ width: 1280, height: 720 })
    expect(scene3DShotStillDimensions(v1, {})).toEqual({ width: 640, height: 360 })
  })

  it("takes the producer's size when it states one", () => {
    expect(scene3DShotStillDimensions(v1, { width: 320, height: 180 })).toEqual({ width: 320, height: 180 })
  })

  it("refuses a size no reader could trust", () => {
    expect(() => scene3DShotStillDimensions({}, {})).toThrow(/must have a pixel size/)
    expect(() => scene3DShotStillDimensions(v1, { width: 0, height: 180 })).toThrow(/must have a pixel size/)
    expect(() => scene3DShotStillDimensions(v1, { width: 1.5, height: 180 })).toThrow(/must have a pixel size/)
  })
})
