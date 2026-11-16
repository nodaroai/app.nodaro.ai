// @vitest-environment node
import { describe, expect, it } from "vitest"
import { layoutRows, layoutShares } from "../layout-rows"

const tracks = [
  { id: "v1", order: 2 },
  { id: "v2", order: 1 },
  { id: "v3", order: 0 },
]
const clip = (id: string, trackId: string, from: number, durationInFrames: number, width = 2880) => ({ id, type: "video", trackId, from, durationInFrames, mediaId: "take", transform: { x: 0, y: 0, width, height: Math.round((width * 9) / 16) } })

describe("where a layout changes, read from the timeline", () => {
  const view = {
    width: 1080,
    height: 1920,
    tracks,
    items: [
      clip("a", "v1", 0, 100),
      clip("b", "v1", 100, 50),
      clip("b2", "v2", 100, 50),
      clip("b3", "v3", 100, 50),
      // The whole picture: the copy in front is exactly as wide as the frame.
      clip("c", "v1", 150, 30),
      clip("c2", "v2", 150, 30, 1080),
      clip("d", "v1", 180, 60),
      clip("d2", "v2", 180, 60),
      clip("e", "v1", 240, 40),
      clip("e2", "v2", 240, 40),
      { id: "cap", type: "subtitle", trackId: "v3", from: 0, durationInFrames: 280 },
    ],
  }

  it("names each stretch by how many times the video is shown, and joins neighbours shown alike", () => {
    expect(layoutRows(view)).toEqual([
      { kind: "close", from: 0, to: 100 },
      { kind: "three", from: 100, to: 150 },
      { kind: "whole", from: 150, to: 180 },
      { kind: "two", from: 180, to: 280 },
    ])
  })

  it("adds up how long each way is shown", () => {
    expect(layoutShares(layoutRows(view))).toEqual({ close: 100, whole: 30, two: 100, three: 50 })
  })

  it("on a wide frame, speakers side by side are two parts even when each is shown at the frame's height", () => {
    const wide = { width: 1920, height: 1080, tracks, items: [clip("a", "v1", 0, 100, 1920), clip("a2", "v2", 0, 100, 1920)] }
    expect(layoutRows(wide)).toEqual([{ kind: "two", from: 0, to: 100 }])
  })

  it("is empty for a video that is on the timeline once", () => {
    expect(layoutRows({ width: 1920, tracks, items: [clip("a", "v1", 0, 100), clip("b", "v1", 100, 50)] })).toEqual([])
  })
})
