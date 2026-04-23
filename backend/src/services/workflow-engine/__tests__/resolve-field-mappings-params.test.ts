import { describe, it, expect } from "vitest"
import { resolveFieldMappings } from "../resolve-field-mappings.js"
import type { NodeExecutionState, SimpleNode } from "../types.js"

describe("resolveFieldMappings — parameter node sources", () => {
  it("preserves existing text-field behavior (prompt via state.output)", () => {
    const promptNode: SimpleNode = {
      id: "p-1",
      type: "text-prompt",
      data: { text: "a dog", label: "Prompt" },
    }
    const nodeStates = {
      "p-1": { nodeType: "text-prompt", output: { text: "a dog" } } as NodeExecutionState,
    }
    const resolved = resolveFieldMappings(
      { fieldMappings: { prompt: { sourceNodeId: "p-1" } } },
      nodeStates,
      [promptNode],
      undefined,
      ["prompt"],
    )
    expect(resolved.prompt).toBe("a dog")
  })
})
