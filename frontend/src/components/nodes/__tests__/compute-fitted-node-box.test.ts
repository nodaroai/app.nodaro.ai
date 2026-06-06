import { describe, it, expect } from "vitest"
import { computeFittedNodeBox } from "../video-node-defaults"

describe("computeFittedNodeBox", () => {
  it("preserves AREA when the aspect ratio changes (16:9 box → 9:16 result)", () => {
    // User resized a 16:9 node to 1600×900 (area 1.44M); a 9:16 result must keep that area,
    // i.e. ~900×1600 — NOT 1600×2844 (which keeping the width would produce).
    const box = computeFittedNodeBox({ aspectRatio: 9 / 16, width: 1600, height: 900, minWidth: 240, minHeight: 427 })
    expect(box.width).toBeCloseTo(900, 0)
    expect(box.height).toBeCloseTo(1600, 0)
    expect(box.width * box.height).toBeCloseTo(1600 * 900, -2) // area preserved
  })

  it("is stable once already fitted to the aspect (re-run is a no-op)", () => {
    const box = computeFittedNodeBox({ aspectRatio: 9 / 16, width: 900, height: 1600, minWidth: 240, minHeight: 427 })
    expect(box.width).toBeCloseTo(900, 0)
    expect(box.height).toBeCloseTo(1600, 0)
  })

  it("first fit (no prior height) starts from minWidth/width, clamped to the proportional minimum", () => {
    // 16:9, only a default width, no height yet → snug 654×368 landscape box.
    const a = computeFittedNodeBox({ aspectRatio: 16 / 9, width: 220, height: undefined, minWidth: 240, minHeight: 368 })
    expect(a.width).toBeCloseTo(654, 0)
    expect(a.height).toBeCloseTo(368, 0)
    const b = computeFittedNodeBox({ aspectRatio: 16 / 9, width: undefined, height: undefined, minWidth: 240, minHeight: 368 })
    expect(b.width).toBeCloseTo(654, 0)
    expect(b.height).toBeCloseTo(368, 0)
  })

  it("floors width and height to the minimums for a tiny area", () => {
    const box = computeFittedNodeBox({ aspectRatio: 1, width: 10, height: 10, minWidth: 240, minHeight: 368 })
    expect(box.width).toBeGreaterThanOrEqual(368) // proportionalMinWidth = max(240, 368*1)
    expect(box.height).toBeGreaterThanOrEqual(368)
  })

  it("keeps the result's aspect ratio in the output box", () => {
    const box = computeFittedNodeBox({ aspectRatio: 9 / 16, width: 1600, height: 900, minWidth: 240, minHeight: 427 })
    expect(box.width / box.height).toBeCloseTo(9 / 16, 3)
  })
})
