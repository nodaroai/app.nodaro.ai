import { describe, it, expect } from "vitest"
import { panDelta, findNodeNearestToPoint } from "@/lib/canvas-navigation"

describe("panDelta", () => {
  const step = 80

  // Scroll convention: pressing an arrow reveals content in that direction, like
  // arrow-keys scrolling a page. The returned dx/dy are ADDED to the React Flow
  // viewport translate (which moves content), so revealing content to the right
  // means the viewport x must DECREASE.
  it("ArrowRight reveals content to the right (viewport x decreases)", () => {
    expect(panDelta("ArrowRight", step)).toEqual({ dx: -80, dy: 0 })
  })

  it("ArrowLeft reveals content to the left (viewport x increases)", () => {
    expect(panDelta("ArrowLeft", step)).toEqual({ dx: 80, dy: 0 })
  })

  it("ArrowDown reveals content below (viewport y decreases)", () => {
    expect(panDelta("ArrowDown", step)).toEqual({ dx: 0, dy: -80 })
  })

  it("ArrowUp reveals content above (viewport y increases)", () => {
    expect(panDelta("ArrowUp", step)).toEqual({ dx: 0, dy: 80 })
  })

  it("returns null for non-arrow codes", () => {
    expect(panDelta("KeyF", step)).toBeNull()
    expect(panDelta("Space", step)).toBeNull()
  })
})

describe("findNodeNearestToPoint", () => {
  const node = (
    id: string,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ) => ({ id, position: { x, y }, measured: { width: 100, height: 100 }, ...extra })

  it("returns null when there are no nodes", () => {
    expect(findNodeNearestToPoint([], { x: 0, y: 0 })).toBeNull()
  })

  it("picks the node whose center is closest to the point", () => {
    const nodes = [node("a", 0, 0), node("b", 500, 0), node("c", 1000, 0)]
    // closest to b's center (550, 50)
    expect(findNodeNearestToPoint(nodes, { x: 540, y: 40 })).toBe("b")
  })

  it("compares against node center (position + half measured size), not the top-left corner", () => {
    const nodes = [node("a", 0, 0)] // 100x100 -> center (50, 50)
    expect(findNodeNearestToPoint(nodes, { x: 50, y: 50 })).toBe("a")
  })

  it("still considers a node when measured size is absent (uses a fallback size)", () => {
    const nodes = [{ id: "a", position: { x: 0, y: 0 } }]
    expect(findNodeNearestToPoint(nodes, { x: 0, y: 0 })).toBe("a")
  })

  it("excludes hidden nodes", () => {
    const nodes = [node("a", 1000, 1000), node("hidden", 0, 0, { hidden: true })]
    // origin is nearest the hidden node, but it must be skipped
    expect(findNodeNearestToPoint(nodes, { x: 0, y: 0 })).toBe("a")
  })

  it("excludes sticky-note nodes", () => {
    const nodes = [node("a", 1000, 1000), node("sticky", 0, 0, { type: "sticky-note" })]
    expect(findNodeNearestToPoint(nodes, { x: 0, y: 0 })).toBe("a")
  })

  it("returns null when every node is excluded", () => {
    const nodes = [
      node("sticky", 0, 0, { type: "sticky-note" }),
      node("hidden", 10, 10, { hidden: true }),
    ]
    expect(findNodeNearestToPoint(nodes, { x: 0, y: 0 })).toBeNull()
  })

  it("breaks ties by array order (stable, first wins)", () => {
    const nodes = [node("a", 0, 0), node("b", 0, 0)]
    expect(findNodeNearestToPoint(nodes, { x: 50, y: 50 })).toBe("a")
  })
})
