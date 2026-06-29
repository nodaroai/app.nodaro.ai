import { describe, it, expect } from "vitest"
import { resolveFieldMappings } from "../resolve-field-mappings.js"
import type { NodeExecutionState, SimpleNode, SimpleEdge } from "../types.js"

describe("BE resolveFieldMappings — field-<key> edge", () => {
  it("routes an edge into field-style to data.style", () => {
    const nodeStates: Record<string, NodeExecutionState> = {
      src: { nodeType: "text-prompt", output: { text: "WIRED STYLE" } } as unknown as NodeExecutionState,
    }
    const allNodes: SimpleNode[] = [
      { id: "src", type: "text-prompt", data: { text: "WIRED STYLE" } } as unknown as SimpleNode,
      { id: "suno", type: "suno-generate", data: {} } as unknown as SimpleNode,
    ]
    const edges: SimpleEdge[] = [
      { source: "src", target: "suno", sourceHandle: "out", targetHandle: "field-style" } as unknown as SimpleEdge,
    ]
    const out = resolveFieldMappings({}, nodeStates, allNodes, undefined, ["style"], "suno", edges)
    expect(out.style).toBe("WIRED STYLE")
  })
})
