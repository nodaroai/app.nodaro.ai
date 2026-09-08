/**
 * The placement the vision model returns is applied by the canvas verbatim,
 * so the schema is the only thing standing between a hallucinated answer and
 * a layer parked off-canvas. It must accept exactly the compositor's units.
 */
import { describe, it, expect } from "vitest"
import { placementSchema } from "../image-overlay-placement.js"
import { OVERLAY_ANCHORS } from "../../providers/image/overlay.js"

describe("placementSchema", () => {
  it("accepts a placement in the node's own units", () => {
    const parsed = placementSchema.safeParse({ anchor: "bottom-right", x: -4, y: -6, width: 12, reason: "Calm corner away from the face." })
    expect(parsed.success).toBe(true)
  })

  it("accepts every anchor the compositor knows and nothing else", () => {
    for (const anchor of OVERLAY_ANCHORS) {
      expect(placementSchema.safeParse({ anchor, x: 0, y: 0, width: 10, reason: "r" }).success).toBe(true)
    }
    expect(placementSchema.safeParse({ anchor: "middle", x: 0, y: 0, width: 10, reason: "r" }).success).toBe(false)
  })

  it("rejects a width or offset that would leave the layer off the picture", () => {
    expect(placementSchema.safeParse({ anchor: "center", x: 0, y: 0, width: 0, reason: "r" }).success).toBe(false)
    expect(placementSchema.safeParse({ anchor: "center", x: 0, y: 0, width: 101, reason: "r" }).success).toBe(false)
    expect(placementSchema.safeParse({ anchor: "center", x: 150, y: 0, width: 10, reason: "r" }).success).toBe(false)
  })

  it("rejects a missing reason and a runaway one", () => {
    expect(placementSchema.safeParse({ anchor: "center", x: 0, y: 0, width: 10 }).success).toBe(false)
    expect(placementSchema.safeParse({ anchor: "center", x: 0, y: 0, width: 10, reason: "x".repeat(401) }).success).toBe(false)
  })
})
