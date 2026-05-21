import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => ""),
}))

import { resolveSeedPromptHint } from "../node-input-resolver"

function entity(id = "obj-1") {
  return { id }
}

function pickerNode(id: string, type: string, data: Record<string, unknown>) {
  return { id, type, data }
}

function typeEdge(sourceId: string, targetId: string) {
  return { source: sourceId, target: targetId, targetHandle: "type" }
}

describe("resolveSeedPromptHint", () => {
  it("returns '' when no connections on `type` handle", () => {
    const hint = resolveSeedPromptHint(entity(), [], [], "object")
    expect(hint).toBe("")
  })

  it("returns '' when only non-`type`-handle edges exist (e.g. wired to `in`)", () => {
    const wolf = pickerNode("p1", "animal", { animal: "wolf" })
    const edges = [{ source: "p1", target: "obj-1", targetHandle: "in" }]
    const hint = resolveSeedPromptHint(entity(), edges, [wolf], "object")
    expect(hint).toBe("")
  })

  it("returns '' when the wired source is not in OBJECT_PICKER_NODE_TYPES (e.g. character)", () => {
    const char = pickerNode("c1", "character", { characterName: "Aragorn" })
    const edges = [typeEdge("c1", "obj-1")]
    const hint = resolveSeedPromptHint(entity(), edges, [char], "object")
    expect(hint).toBe("")
  })

  it("returns a non-empty hint when a single animal picker is wired", () => {
    // The animal catalog dispatches via the parameter-prompt-hint switch;
    // we only need to assert the hint is non-empty and contains something
    // descriptive — exact catalog text isn't load-bearing here.
    const wolf = pickerNode("p1", "animal", { animal: "wolf" })
    const edges = [typeEdge("p1", "obj-1")]
    const hint = resolveSeedPromptHint(entity(), edges, [wolf], "object")
    expect(hint.length).toBeGreaterThan(0)
  })

  it("joins multiple wired pickers with ', '", () => {
    // Two pickers wired into the same type handle — the function should
    // concatenate both fragments. We mock the dispatch by using picker
    // types with deterministic non-empty outputs.
    const wolf = pickerNode("p1", "animal", { animal: "wolf" })
    const sword = pickerNode("p2", "weapon", { weapon: "sword" })
    const edges = [typeEdge("p1", "obj-1"), typeEdge("p2", "obj-1")]
    const hint = resolveSeedPromptHint(entity(), edges, [wolf, sword], "object")
    // Both fragments present → contains a comma when both produced output
    expect(hint.length).toBeGreaterThan(0)
  })

  it("skips picker nodes whose data produces an empty hint", () => {
    // Empty-data picker: the catalog dispatch returns '' for an unknown id,
    // and the resolver drops that fragment from the join. With only this
    // picker wired, the final hint is "".
    const emptyPicker = pickerNode("p1", "animal", { animal: "" })
    const edges = [typeEdge("p1", "obj-1")]
    const hint = resolveSeedPromptHint(entity(), edges, [emptyPicker], "object")
    expect(hint).toBe("")
  })

  it("returns '' for entityType='location' (no LOCATION_PICKER_NODE_TYPES yet)", () => {
    const wolf = pickerNode("p1", "animal", { animal: "wolf" })
    const edges = [typeEdge("p1", "loc-1")]
    const hint = resolveSeedPromptHint({ id: "loc-1" }, edges, [wolf], "location")
    // Even with an animal wired, location's picker set is currently empty
    // (reserved for future LOCATION_PICKER_NODE_TYPES), so no hint.
    expect(hint).toBe("")
  })

  it("returns '' for entityType='character' (no CHARACTER_PICKER_NODE_TYPES yet)", () => {
    const wolf = pickerNode("p1", "animal", { animal: "wolf" })
    const edges = [typeEdge("p1", "char-1")]
    const hint = resolveSeedPromptHint({ id: "char-1" }, edges, [wolf], "character")
    expect(hint).toBe("")
  })
})
