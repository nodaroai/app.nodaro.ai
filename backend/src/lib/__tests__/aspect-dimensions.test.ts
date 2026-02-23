import { describe, it, expect } from "vitest"
import { ASPECT_DIMENSIONS } from "@/lib/aspect-dimensions.js"

describe("ASPECT_DIMENSIONS", () => {
  it("contains exactly 4 aspect ratio entries", () => {
    expect(Object.keys(ASPECT_DIMENSIONS)).toHaveLength(4)
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
})
