/**
 * The rule the blank-canvas bug broke: an empty canvas is never silent.
 */
import { describe, expect, it } from "vitest"
import { emptyCanvasSurface } from "../empty-canvas-surface"

const base = { workflowId: "wf-1", nodeCount: 0, isLoading: false, copilotTurnActive: false }

describe("emptyCanvasSurface", () => {
  it("offers the first-node help on an empty workflow", () => {
    expect(emptyCanvasSurface(base)).toBe("empty-state")
  })

  it("says what the Copilot is doing instead, while it is doing it", () => {
    // The regression this exists for: the empty state was suppressed during a
    // turn and NOTHING took its place, so the user watched a blank grid.
    expect(emptyCanvasSurface({ ...base, copilotTurnActive: true })).toBe("copilot-planning")
  })

  it("never leaves an empty canvas with nothing on it", () => {
    for (const copilotTurnActive of [false, true]) {
      expect(emptyCanvasSurface({ ...base, copilotTurnActive })).not.toBe("none")
    }
  })

  it("stays out of the way once there is a graph", () => {
    expect(emptyCanvasSurface({ ...base, nodeCount: 1 })).toBe("none")
    expect(emptyCanvasSurface({ ...base, nodeCount: 1, copilotTurnActive: true })).toBe("none")
  })

  it("holds back while the workflow is still loading", () => {
    // Otherwise the initial store clear flashes the empty state before the
    // real nodes arrive.
    expect(emptyCanvasSurface({ ...base, isLoading: true })).toBe("none")
    expect(emptyCanvasSurface({ ...base, isLoading: true, copilotTurnActive: true })).toBe("none")
  })

  it("shows nothing when no workflow is open at all", () => {
    expect(emptyCanvasSurface({ ...base, workflowId: null })).toBe("none")
    expect(emptyCanvasSurface({ ...base, workflowId: undefined })).toBe("none")
  })
})
