import { describe, it, expect } from "vitest"
import { findNonOverlappingPosition, nodeRect, type PlacementRect } from "../find-free-position"

const SIZE = { width: 100, height: 100 }
const MARGIN = 24

/** True when rect a (inflated by margin) intersects rect b. */
function tooClose(a: PlacementRect, b: PlacementRect, margin = MARGIN): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  )
}

describe("findNonOverlappingPosition", () => {
  it("returns the desired position unchanged when it is free", () => {
    expect(findNonOverlappingPosition({ x: 50, y: 60 }, SIZE, [])).toEqual({ x: 50, y: 60 })
  })

  it("returns the desired position when obstacles are far away", () => {
    const obstacles = [{ x: 1000, y: 1000, width: 200, height: 200 }]
    expect(findNonOverlappingPosition({ x: 0, y: 0 }, SIZE, obstacles)).toEqual({ x: 0, y: 0 })
  })

  it("moves off an overlapping node and keeps the margin of air", () => {
    const obstacles = [{ x: 0, y: 0, width: 200, height: 200 }]
    const result = findNonOverlappingPosition({ x: 50, y: 50 }, SIZE, obstacles)
    expect(result).not.toEqual({ x: 50, y: 50 })
    expect(tooClose({ ...result, ...SIZE }, obstacles[0])).toBe(false)
  })

  it("stays close to the desired point (nearest free ring)", () => {
    const obstacles = [{ x: 0, y: 0, width: 200, height: 200 }]
    const result = findNonOverlappingPosition({ x: 50, y: 50 }, SIZE, obstacles)
    const dist = Math.hypot(result.x - 50, result.y - 50)
    // The analytic closest free spot is 174px away (200 + 24 margin − 50);
    // the grid search may land one step further, never wildly far.
    expect(dist).toBeLessThanOrEqual(300)
  })

  it("is deterministic", () => {
    const obstacles = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 250, y: 0, width: 200, height: 200 },
    ]
    const a = findNonOverlappingPosition({ x: 100, y: 80 }, SIZE, obstacles)
    const b = findNonOverlappingPosition({ x: 100, y: 80 }, SIZE, obstacles)
    expect(a).toEqual(b)
  })

  it("navigates between multiple obstacles to a truly free spot", () => {
    // A 3-wide wall of nodes; desired sits on the middle one.
    const obstacles = [
      { x: -300, y: 0, width: 250, height: 400 },
      { x: 0, y: 0, width: 250, height: 400 },
      { x: 300, y: 0, width: 250, height: 400 },
    ]
    const result = findNonOverlappingPosition({ x: 100, y: 100 }, SIZE, obstacles)
    for (const o of obstacles) {
      expect(tooClose({ ...result, ...SIZE }, o)).toBe(false)
    }
  })

  it("falls back to the desired position when everything within range is blocked", () => {
    const obstacles = [{ x: -10000, y: -10000, width: 20000, height: 20000 }]
    expect(findNonOverlappingPosition({ x: 0, y: 0 }, SIZE, obstacles)).toEqual({ x: 0, y: 0 })
  })
})

describe("nodeRect", () => {
  it("prefers measured dimensions, then explicit width/height, then the default estimate", () => {
    expect(
      nodeRect({ position: { x: 1, y: 2 }, measured: { width: 300, height: 150 }, width: 50, height: 50 }),
    ).toEqual({ x: 1, y: 2, width: 300, height: 150 })
    expect(nodeRect({ position: { x: 1, y: 2 }, width: 320, height: 240 })).toEqual({
      x: 1,
      y: 2,
      width: 320,
      height: 240,
    })
    const fallback = nodeRect({ position: { x: 0, y: 0 } })
    expect(fallback.width).toBeGreaterThan(100)
    expect(fallback.height).toBeGreaterThan(100)
  })
})
