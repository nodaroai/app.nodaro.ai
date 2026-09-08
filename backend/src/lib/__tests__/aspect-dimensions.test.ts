import { describe, it, expect } from "vitest"
import { ASPECT_DIMENSIONS } from "@/lib/aspect-dimensions.js"

describe("ASPECT_DIMENSIONS", () => {
  it("contains exactly the ratios the platform can size", () => {
    expect([...Object.keys(ASPECT_DIMENSIONS)].sort()).toEqual(["16:9", "1:1", "21:9", "4:5", "9:16"].sort())
  })

  it("has correct dimensions for 16:9", () => {
    expect(ASPECT_DIMENSIONS["16:9"]).toEqual({ width: 1920, height: 1080 })
  })

  it("has correct dimensions for 9:16", () => {
    expect(ASPECT_DIMENSIONS["9:16"]).toEqual({ width: 1080, height: 1920 })
  })

  it("has correct dimensions for 1:1", () => {
    expect(ASPECT_DIMENSIONS["1:1"]).toEqual({ width: 1080, height: 1080 })
  })

  it("has correct dimensions for 4:5", () => {
    expect(ASPECT_DIMENSIONS["4:5"]).toEqual({ width: 1080, height: 1350 })
  })

  // Ultra-wide, reachable only from a node whose own enum offers it (3D Render
  // Pro). 1680x720 rather than a 1920-wide pair: the Scene3D v2 admission
  // bounds require even integers on both axes and 1920/(21/9) is odd.
  it("has correct dimensions for 21:9", () => {
    expect(ASPECT_DIMENSIONS["21:9"]).toEqual({ width: 1680, height: 720 })
  })
})
