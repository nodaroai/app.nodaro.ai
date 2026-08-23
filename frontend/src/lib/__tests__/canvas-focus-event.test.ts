/**
 * Pointing the user at something must never write anything.
 *
 * `<ReactFlow>` is controlled, so handing it replacement node objects reaches
 * the workflow store as a CONTENT change and marks the workflow dirty — which
 * both triggers a silent autosave and blocks the Copilot's own canvas catch-up
 * (`ensureCanvasVersion` refuses to adopt a remote graph over local edits).
 * These tests pin the shape of the payload so that cannot come back.
 */
import { describe, expect, it } from "vitest"
import { FOCUS_NODES_MAX, focusNodesChanges, parseFocusNodesDetail } from "../canvas-focus-event"

describe("focusNodesChanges", () => {
  it("emits nothing but select changes", () => {
    const changes = focusNodesChanges(["a", "b", "c"], ["b"])
    expect(changes.every((c) => c.type === "select")).toBe(true)
  })

  it("selects the wanted nodes and deselects the rest", () => {
    expect(focusNodesChanges(["a", "b", "c"], ["a", "c"])).toEqual([
      { type: "select", id: "a", selected: true },
      { type: "select", id: "b", selected: false },
      { type: "select", id: "c", selected: true },
    ])
  })

  it("ignores ids that are not on the canvas", () => {
    expect(focusNodesChanges(["a"], ["ghost"])).toEqual([{ type: "select", id: "a", selected: false }])
  })

  it("carries no node data — there is nothing here that could be written back", () => {
    for (const change of focusNodesChanges(["a"], ["a"])) {
      expect(Object.keys(change).sort()).toEqual(["id", "selected", "type"])
    }
  })
})

describe("parseFocusNodesDetail", () => {
  it("reads the ids of a well-formed detail", () => {
    expect(parseFocusNodesDetail({ nodeIds: ["a", "b"] })).toEqual(["a", "b"])
  })

  it.each([undefined, null, {}, { nodeIds: "a" }, { nodeIds: 7 }])("returns nothing for %s", (detail) => {
    expect(parseFocusNodesDetail(detail)).toEqual([])
  })

  it("drops non-string entries any page script could have mixed in", () => {
    expect(parseFocusNodesDetail({ nodeIds: ["a", 1, null, "b", { id: "c" }] })).toEqual(["a", "b"])
  })

  it("caps the list so a huge detail cannot wedge the viewport call", () => {
    const huge = Array.from({ length: FOCUS_NODES_MAX + 50 }, (_, i) => `n${i}`)
    expect(parseFocusNodesDetail({ nodeIds: huge })).toHaveLength(FOCUS_NODES_MAX)
  })
})
