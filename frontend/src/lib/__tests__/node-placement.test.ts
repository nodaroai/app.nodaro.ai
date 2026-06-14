import { describe, it, expect } from "vitest"
import {
  connectedNodePosition,
  CONNECTED_NODE_GAP_X,
  DEFAULT_PLACEMENT_SIZE,
  type PlacementRect,
} from "../find-free-position"
import { ELK_LAYOUT_OPTIONS } from "@/hooks/use-elk-layout"

const FOCUSED: PlacementRect = { x: 100, y: 200, width: 320, height: 240 }

describe("connectedNodePosition", () => {
  it("places a downstream node to the RIGHT, a full gap past the source's right edge", () => {
    // direction "source": focused node is the SOURCE → new node is downstream.
    const pos = connectedNodePosition(FOCUSED, "source")
    expect(pos.x).toBe(FOCUSED.x + FOCUSED.width + CONNECTED_NODE_GAP_X)
    // The left edge of the new node clears the source's right edge by the gap.
    expect(pos.x - (FOCUSED.x + FOCUSED.width)).toBe(CONNECTED_NODE_GAP_X)
  })

  it("places an upstream node to the LEFT, budgeting the new node's own width before the gap", () => {
    // direction "target": focused node is the TARGET → new node is upstream.
    const pos = connectedNodePosition(FOCUSED, "target")
    expect(pos.x).toBe(FOCUSED.x - (DEFAULT_PLACEMENT_SIZE.width + CONNECTED_NODE_GAP_X))
    // The new node's right edge clears the source's left edge by the gap.
    const newRightEdge = pos.x + DEFAULT_PLACEMENT_SIZE.width
    expect(FOCUSED.x - newRightEdge).toBe(CONNECTED_NODE_GAP_X)
  })

  it("anchors the new node vertically at the source's mid-height", () => {
    expect(connectedNodePosition(FOCUSED, "source").y).toBe(FOCUSED.y + FOCUSED.height / 2)
    expect(connectedNodePosition(FOCUSED, "target").y).toBe(FOCUSED.y + FOCUSED.height / 2)
  })

  it("uses a gap roomy enough for large media cards — not the old cramped 80px", () => {
    // The bug: new nodes hugged their source at an 80px gap. Tidy uses ~200px.
    expect(CONNECTED_NODE_GAP_X).toBeGreaterThanOrEqual(200)
  })
})

describe("CONNECTED_NODE_GAP_X / Tidy Up invariant", () => {
  it("equals ELK's layered between-layers spacing so an auto-connected node lands where Tidy Up would put it", () => {
    // Single source of truth: use-elk-layout derives its ELK option from this
    // constant. If they ever drift, an auto-connected node would jump on Tidy Up.
    expect(String(CONNECTED_NODE_GAP_X)).toBe(
      ELK_LAYOUT_OPTIONS["elk.layered.spacing.nodeNodeBetweenLayers"],
    )
  })
})
