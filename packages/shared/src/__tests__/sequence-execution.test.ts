import { describe, expect, it } from "vitest"
import { assertCanvasExecutionAllowed, isCodecOwnedDocument, requiresSequenceExecution, STUDIO_DEPENDENT_FRAMES_CAPABILITY } from "../sequence-execution"

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

describe("isCodecOwnedDocument — the one predicate the server's routes and the editor ask", () => {
  it("a Studio settings block holding keyframes, sequences or settled jobs, or declaring dependent frames", () => {
    for (const studio of [{ keyframes: [] }, { sequences: [] }, { settledJobIds: [] }, { requiredCapabilities: [STUDIO_DEPENDENT_FRAMES_CAPABILITY] }]) {
      expect(isCodecOwnedDocument([], { studio }), JSON.stringify(studio)).toBe(true)
    }
  })

  it("any node carrying keyframeId, sequenceBinding or the declaration — whatever the settings", () => {
    for (const data of [{ keyframeId: "k" }, { keyframeId: undefined }, { sequenceBinding: {} }, { requiredCapabilities: [STUDIO_DEPENDENT_FRAMES_CAPABILITY] }]) {
      expect(isCodecOwnedDocument([{ id: "a", data: {} }, { id: "b", data }], {}), JSON.stringify(data)).toBe(true)
    }
  })

  it("an ordinary document, a Studio marker alone, and malformed input are not", () => {
    expect(isCodecOwnedDocument([{ id: "a", data: { prompt: "x" } }], {})).toBe(false)
    expect(isCodecOwnedDocument([], { studio: { shots: [] } })).toBe(false)
    expect(isCodecOwnedDocument([{ id: "a", data: { requiredCapabilities: ["other"] } }], null)).toBe(false)
    for (const v of [undefined, null, "x", 3, [null, 7, { data: null }]]) expect(isCodecOwnedDocument(v, v)).toBe(false)
  })
})
