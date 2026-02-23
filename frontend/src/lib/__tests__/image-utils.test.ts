import { describe, it, expect } from "vitest"
import { polygonBoundingBox } from "../image-utils"
import type { Point } from "../image-utils"

describe("polygonBoundingBox", () => {
  it("returns bounding box for a triangle", () => {
    const points: Point[] = [
      { x: 10, y: 20 },
      { x: 50, y: 10 },
      { x: 30, y: 60 },
    ]
    const box = polygonBoundingBox(points)
    expect(box).toEqual({ x: 10, y: 10, width: 40, height: 50 })
  })

  it("returns bounding box for a rectangle", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]
    const box = polygonBoundingBox(points)
    expect(box).toEqual({ x: 0, y: 0, width: 100, height: 50 })
  })

  it("handles single point (zero-size box)", () => {
    const points: Point[] = [{ x: 25, y: 75 }]
    const box = polygonBoundingBox(points)
    expect(box).toEqual({ x: 25, y: 75, width: 0, height: 0 })
  })

  it("rounds values to integers", () => {
    const points: Point[] = [
      { x: 10.3, y: 20.7 },
      { x: 50.9, y: 10.1 },
    ]
    const box = polygonBoundingBox(points)
    expect(box.x).toBe(Math.round(10.3))
    expect(box.y).toBe(Math.round(10.1))
    expect(box.width).toBe(Math.round(50.9 - 10.3))
    expect(box.height).toBe(Math.round(20.7 - 10.1))
  })

  it("handles negative coordinates", () => {
    const points: Point[] = [
      { x: -10, y: -20 },
      { x: 10, y: 20 },
    ]
    const box = polygonBoundingBox(points)
    expect(box).toEqual({ x: -10, y: -20, width: 20, height: 40 })
  })

  it("handles collinear points", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]
    const box = polygonBoundingBox(points)
    expect(box).toEqual({ x: 0, y: 0, width: 100, height: 0 })
  })
})
