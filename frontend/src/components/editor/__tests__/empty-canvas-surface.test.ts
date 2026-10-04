/**
 * The rule the blank-canvas bug broke: an empty canvas is never silent —
 * except where the Copilot owns it and the person folded or closed it.
 */
import { describe, expect, it } from "vitest"
import { emptyCanvasSurface } from "../empty-canvas-surface"

const base = {
  workflowId: "wf-1",
  nodeCount: 0,
  isLoading: false,
  copilotTurnActive: false,
  copilotCentered: false,
  copilotPanelOpen: false,
  copilotOwnsEmptyCanvas: false,
}

describe("emptyCanvasSurface", () => {
  it("offers the first-node help on an empty workflow", () => {
    expect(emptyCanvasSurface(base)).toBe("empty-state")
  })

  it("says what the Copilot is doing instead, while it is doing it", () => {
    // The regression this exists for: the empty state was suppressed during a
    // turn and NOTHING took its place, so the user watched a blank grid.
    expect(emptyCanvasSurface({ ...base, copilotTurnActive: true })).toBe("copilot-planning")
  })

  it("puts the Copilot in the middle of an empty canvas while it sits there", () => {
    expect(emptyCanvasSurface({ ...base, copilotCentered: true })).toBe("copilot-center")
  })

  it("a turn in progress still says what it is doing, wherever the Copilot sits", () => {
    expect(emptyCanvasSurface({ ...base, copilotCentered: true, copilotTurnActive: true })).toBe("copilot-planning")
  })

  it("gives the open rail the stage: no first-node help beside a conversation", () => {
    // Between "Build" in the middle and the turn starting, the rail is open and
    // the message is on its way — the old first-run cards must not flash in.
    expect(emptyCanvasSurface({ ...base, copilotPanelOpen: true })).toBe("none")
    expect(emptyCanvasSurface({ ...base, copilotPanelOpen: true, copilotTurnActive: true })).toBe("copilot-planning")
  })

  it("leaves the canvas bare where the Copilot owns it and was folded or closed", () => {
    // Cloud desktop: the strip or the top-bar tab brings it back; the old
    // first-run cards are not what the design shows there.
    expect(emptyCanvasSurface({ ...base, copilotOwnsEmptyCanvas: true })).toBe("none")
    expect(emptyCanvasSurface({ ...base, copilotOwnsEmptyCanvas: true, copilotCentered: true })).toBe("copilot-center")
    expect(emptyCanvasSurface({ ...base, copilotOwnsEmptyCanvas: true, copilotTurnActive: true })).toBe("copilot-planning")
  })

  it("never leaves an empty canvas with nothing on it, unless the open rail is on screen", () => {
    for (const copilotTurnActive of [false, true]) {
      for (const copilotCentered of [false, true]) {
        expect(emptyCanvasSurface({ ...base, copilotTurnActive, copilotCentered })).not.toBe("none")
      }
    }
  })

  it("stays out of the way once there is a graph", () => {
    expect(emptyCanvasSurface({ ...base, nodeCount: 1 })).toBe("none")
    expect(emptyCanvasSurface({ ...base, nodeCount: 1, copilotTurnActive: true })).toBe("none")
    expect(emptyCanvasSurface({ ...base, nodeCount: 1, copilotCentered: true })).toBe("none")
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
