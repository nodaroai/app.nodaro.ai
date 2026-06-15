import { describe, it, expect } from "vitest"
import { nearestNodeInDirection, type SpatialNode } from "../node-spatial-nav"

const n = (id: string, x: number, y: number, extra: Partial<SpatialNode> = {}): SpatialNode => ({
  id,
  position: { x, y },
  measured: { width: 200, height: 100 },
  ...extra,
})

describe("nearestNodeInDirection", () => {
  const nodes = [
    n("c", 0, 0),
    n("right", 300, 0),
    n("right-far", 600, 0),
    n("left", -300, 0),
    n("down", 0, 300),
    n("up", 0, -300),
  ]

  it("picks the nearest node in each direction", () => {
    expect(nearestNodeInDirection(nodes, "c", "ArrowRight")).toBe("right")
    expect(nearestNodeInDirection(nodes, "c", "ArrowLeft")).toBe("left")
    expect(nearestNodeInDirection(nodes, "c", "ArrowDown")).toBe("down")
    expect(nearestNodeInDirection(nodes, "c", "ArrowUp")).toBe("up")
  })

  it("returns null when nothing lies in that direction", () => {
    expect(nearestNodeInDirection([n("c", 0, 0), n("left", -300, 0)], "c", "ArrowRight")).toBeNull()
  })

  it("skips hidden nodes", () => {
    const ns = [n("c", 0, 0), n("r1", 300, 0, { hidden: true }), n("r2", 400, 0)]
    expect(nearestNodeInDirection(ns, "c", "ArrowRight")).toBe("r2")
  })

  it("returns null for an unknown origin id", () => {
    expect(nearestNodeInDirection(nodes, "nope", "ArrowRight")).toBeNull()
  })
})
