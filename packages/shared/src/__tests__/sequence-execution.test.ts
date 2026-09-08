import { describe, expect, it } from "vitest"
import { assertCanvasExecutionAllowed, requiresSequenceExecution, STUDIO_DEPENDENT_FRAMES_CAPABILITY } from "../sequence-execution"

describe("dependency execution boundary", () => {
  it.each([
    { requiredCapabilities: [STUDIO_DEPENDENT_FRAMES_CAPABILITY] },
    { keyframeId: "A" }, { sequenceBinding: { startKeyframeId: "A", endKeyframeId: "B" } },
    { keyframeId: null }, { sequenceBinding: null },
  ])("refuses declared or recognizable dependency nodes: %j", (data) => {
    expect(() => assertCanvasExecutionAllowed([{ id: "linked", data }])).toThrow(expect.objectContaining({
      code: "sequence_execution_required", nodeIds: ["linked"],
    }))
  })
  it("keeps ordinary nodes runnable and reports only the blocked nodes", () => {
    expect(requiresSequenceExecution({ data: { provider: "wan-3", imageUrl: "start", endFrameUrl: "end" } })).toBe(false)
    expect(() => assertCanvasExecutionAllowed([{ id: "ordinary", data: {} }])).not.toThrow()
    expect(() => assertCanvasExecutionAllowed([{ id: "ordinary", data: {} }, { id: "linked", data: { keyframeId: "A" } }]))
      .toThrow(expect.objectContaining({ nodeIds: ["linked"] }))
  })
})
