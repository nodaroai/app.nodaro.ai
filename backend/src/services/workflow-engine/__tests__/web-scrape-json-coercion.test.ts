import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../input-resolver.js"
import { executeExtractField } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

describe("web-scrape json → text coercion", () => {
  it("stringifies json output when consumed by a text-prompt-like target", () => {
    const scrape = makeNode("s", "web-scrape", {})
    const target = makeNode("t", "ai-writer", {})
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "t", sourceHandle: "json", targetHandle: undefined } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [{ caption: "hello" }] } },
    }
    const inputs = resolveNodeInputs(target, edges, states, [scrape, target])
    expect(inputs.prompt).toBe('[{"caption":"hello"}]')
  })

  it("extract-field downstream receives raw json (not stringified)", () => {
    const scrape = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "caption" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [{ caption: "hi" }] } },
    }
    // Inline executor reads state.output.json directly — verify via executeExtractField.
    const result = executeExtractField(extract, edges, [scrape, extract], states)
    expect(result.extractedText).toBe("hi")
  })
})
