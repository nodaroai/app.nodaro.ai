import { describe, expect, it } from "vitest"
import { VIDEO_DEPTH_COLORMAPS } from "@nodaro/shared/media"
import { depthColormapTable } from "../depth-colormaps.js"

const at = (t: Uint8Array, i: number) => [t[3 * i], t[3 * i + 1], t[3 * i + 2]]

describe("depthColormapTable", () => {
  it("has 256 colours for every Video Depth colormap", () => {
    for (const c of VIDEO_DEPTH_COLORMAPS) expect(depthColormapTable(c)).toHaveLength(768)
  })

  it("grayscale is the identity", () => {
    const t = depthColormapTable("grayscale")
    for (let i = 0; i < 256; i++) expect(at(t, i)).toEqual([i, i, i])
  })

  it("the colour maps are matplotlib's (their ends and middle, 8 bits)", () => {
    expect(at(depthColormapTable("turbo"), 0)).toEqual([0x30, 0x12, 0x3b])
    expect(at(depthColormapTable("turbo"), 255)).toEqual([0x7a, 0x04, 0x03])
    expect(at(depthColormapTable("inferno"), 0)).toEqual([0, 0, 4])
    expect(at(depthColormapTable("inferno"), 255)).toEqual([252, 255, 164])
    expect(at(depthColormapTable("magma"), 0)).toEqual([0, 0, 4])
    expect(at(depthColormapTable("magma"), 255)).toEqual([252, 253, 191])
    expect(at(depthColormapTable("viridis"), 0)).toEqual([68, 1, 84])
    expect(at(depthColormapTable("viridis"), 255)).toEqual([253, 231, 37])
    expect(at(depthColormapTable("viridis"), 128)).toEqual([33, 145, 140])
  })

  it("inferno, magma and viridis brighten from end to end (near = bright, as the gray render)", () => {
    const luma = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    for (const c of ["inferno", "magma", "viridis"] as const) {
      const t = depthColormapTable(c)
      for (let i = 1; i < 256; i++) expect(luma(at(t, i))).toBeGreaterThanOrEqual(luma(at(t, i - 1)) - 0.5)
    }
  })
})
