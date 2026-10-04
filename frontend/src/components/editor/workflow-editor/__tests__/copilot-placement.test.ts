/**
 * Where the canvas puts the Copilot — the decisions that have to be right
 * without rendering a canvas.
 */
import { describe, expect, it } from "vitest"
import { copilotTabTarget, placeCopilot, railExitTarget, type CanvasSnapshot, type PlacementContext } from "../copilot-placement"

const loaded = (over: Partial<CanvasSnapshot> = {}): CanvasSnapshot => ({
  workflowId: "wf-1",
  isLoading: false,
  nodeCount: 0,
  messageCount: 0,
  conversationKnown: true,
  conversing: false,
  ...over,
})

const ctx = (over: Partial<PlacementContext> = {}): PlacementContext => ({
  mode: "min",
  dock: "min",
  centerAllowed: true,
  returnToCenterWhenEmpty: true,
  ...over,
})

describe("placeCopilot — opening a workflow", () => {
  it("an empty workflow starts with the Copilot in the middle", () => {
    expect(placeCopilot(null, loaded(), ctx())).toBe("center")
  })

  it("…even before its history arrives (the rail takes it if there turns out to be a conversation)", () => {
    expect(placeCopilot(null, loaded({ conversationKnown: false }), ctx())).toBe("center")
  })

  it("a workflow with nodes leaves the Copilot where the person docked it", () => {
    expect(placeCopilot(null, loaded({ nodeCount: 3 }), ctx({ mode: "hidden", dock: "hidden" }))).toBe("hidden")
    expect(placeCopilot(null, loaded({ nodeCount: 3 }), ctx({ mode: "center", dock: "min" }))).toBe("min")
  })

  it("an open rail stays open — the hop from the home page opens it before the canvas loads", () => {
    expect(placeCopilot(null, loaded(), ctx({ mode: "panel", dock: "panel" }))).toBe("panel")
  })

  it("decides nothing while the workflow is loading — the load clears the canvas, then refills it", () => {
    const loading = loaded({ isLoading: true })
    expect(placeCopilot(null, loading, ctx())).toBe("min")
    expect(placeCopilot(loading, loaded({ nodeCount: 4 }), ctx())).toBe("min")
  })

  it("switching to another workflow decides again", () => {
    const first = loaded({ nodeCount: 2 })
    expect(placeCopilot(first, loaded({ workflowId: "wf-2" }), ctx())).toBe("center")
  })
})

describe("placeCopilot — while the Copilot sits in the middle", () => {
  it("moves to the rail when the first node appears, by any route", () => {
    expect(placeCopilot(loaded(), loaded({ nodeCount: 1 }), ctx({ mode: "center" }))).toBe("panel")
  })

  it("moves to the rail when there turns out to be a conversation", () => {
    const pending = loaded({ conversationKnown: false })
    expect(placeCopilot(pending, loaded({ messageCount: 2 }), ctx({ mode: "center" }))).toBe("panel")
  })

  it("stays while the canvas stays empty and nothing is said", () => {
    expect(placeCopilot(loaded(), loaded(), ctx({ mode: "center" }))).toBe("center")
  })
})

describe("placeCopilot — returning to the middle", () => {
  it("returns when the last node goes and nothing was said", () => {
    expect(placeCopilot(loaded({ nodeCount: 1 }), loaded(), ctx({ mode: "panel" }))).toBe("center")
  })

  it("does not return while there is a conversation", () => {
    expect(placeCopilot(loaded({ nodeCount: 1, messageCount: 3 }), loaded({ messageCount: 3 }), ctx({ mode: "panel" }))).toBe("panel")
  })

  it("does not return when the person switched it off", () => {
    expect(placeCopilot(loaded({ nodeCount: 1 }), loaded(), ctx({ mode: "min", returnToCenterWhenEmpty: false }))).toBe("min")
  })

  it("does not return before the history says there is nothing", () => {
    expect(placeCopilot(loaded({ nodeCount: 1 }), loaded({ conversationKnown: false }), ctx({ mode: "panel" }))).toBe("panel")
  })

  it("does not return while a message is on its way or being answered, before the history has it", () => {
    expect(placeCopilot(loaded({ nodeCount: 1 }), loaded({ conversing: true }), ctx({ mode: "panel" }))).toBe("panel")
  })
})

describe("railExitTarget — folding or closing the rail", () => {
  const exit = (over: Partial<Parameters<typeof railExitTarget>[0]>) =>
    railExitTarget({ target: "hidden", hasContent: true, centerAllowed: true, returnToCenterWhenEmpty: true, ...over })

  it("folds or closes it as asked while there is something on the canvas or said", () => {
    expect(exit({ target: "min" })).toBe("min")
    expect(exit({ target: "hidden" })).toBe("hidden")
  })

  it("over an empty canvas with nothing said, takes the Copilot back to the middle instead of leaving a bare canvas", () => {
    expect(exit({ target: "min", hasContent: false })).toBe("center")
    expect(exit({ target: "hidden", hasContent: false })).toBe("center")
  })

  it("does as asked when the person switched returning off, or where the middle is not available", () => {
    expect(exit({ hasContent: false, returnToCenterWhenEmpty: false })).toBe("hidden")
    expect(exit({ hasContent: false, centerAllowed: false })).toBe("hidden")
  })
})

describe("placeCopilot — where the middle is not available", () => {
  it("never puts the Copilot in the middle, and takes it out if it was there", () => {
    expect(placeCopilot(null, loaded(), ctx({ centerAllowed: false }))).toBe("min")
    expect(placeCopilot(loaded(), loaded(), ctx({ mode: "center", dock: "panel", centerAllowed: false }))).toBe("panel")
  })
})

describe("copilotTabTarget — the top-bar tab", () => {
  const tab = (over: Partial<Parameters<typeof copilotTabTarget>[0]>) =>
    copilotTabTarget({ mode: "min", isMobile: false, hasContent: true, centerAllowed: true, returnToCenterWhenEmpty: true, ...over })

  it("folds an open rail", () => {
    expect(tab({ mode: "panel" })).toBe("min")
  })

  it("takes an open rail back to the middle of an empty canvas with nothing said", () => {
    expect(tab({ mode: "panel", hasContent: false })).toBe("center")
    expect(tab({ mode: "panel", hasContent: false, returnToCenterWhenEmpty: false })).toBe("min")
  })

  it("unfolds a folded or hidden rail when there is something on the canvas or said", () => {
    expect(tab({ mode: "min" })).toBe("panel")
    expect(tab({ mode: "hidden" })).toBe("panel")
  })

  it("puts the Copilot in the middle of an empty canvas with nothing said", () => {
    expect(tab({ mode: "hidden", hasContent: false })).toBe("center")
  })

  it("leaves the Copilot in the middle when it is already there", () => {
    expect(tab({ mode: "center", hasContent: false })).toBe("center")
  })

  it("opens the rail where the middle is not available", () => {
    expect(tab({ mode: "hidden", hasContent: false, centerAllowed: false })).toBe("panel")
  })

  it("opens and closes the sheet on a phone", () => {
    expect(tab({ isMobile: true, mode: "min" })).toBe("panel")
    expect(tab({ isMobile: true, mode: "panel" })).toBe("hidden")
  })
})
