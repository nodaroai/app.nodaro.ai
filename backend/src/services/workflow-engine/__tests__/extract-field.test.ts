import { describe, it, expect } from "vitest"
import { executeExtractField } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

describe("executeExtractField", () => {
  it("extracts scalar field from top-level array (auto-iterate)", () => {
    const scrapeNode = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "caption", mode: "dropdown" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [{ caption: "a" }, { caption: "b" }, { caption: "c" }] } },
    }
    const result = executeExtractField(extract, edges, [scrapeNode, extract], states)
    expect(result.extractedText).toBe("a\nb\nc")
    expect(result.text).toBe("a\nb\nc")
    expect(result.listResults).toEqual(["a", "b", "c"])
  })

  it("extracts nested path on custom mode", () => {
    const scrapeNode = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "authorMeta.name", mode: "custom" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [{ authorMeta: { name: "bob" } }, { authorMeta: { name: "sue" } }] } },
    }
    const result = executeExtractField(extract, edges, [scrapeNode, extract], states)
    expect(result.extractedText).toBe("bob\nsue")
  })

  it("parses text input as JSON", () => {
    const src = makeNode("s", "text-prompt", {})
    const extract = makeNode("e", "extract-field", { field: "name", mode: "custom" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: undefined, targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { text: '[{"name":"alice"},{"name":"bob"}]' } },
    }
    const result = executeExtractField(extract, edges, [src, extract], states)
    expect(result.extractedText).toBe("alice\nbob")
  })

  it("errors on invalid JSON text input", () => {
    const src = makeNode("s", "text-prompt", {})
    const extract = makeNode("e", "extract-field", { field: "name", mode: "custom" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: undefined, targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { text: "not json at all" } },
    }
    expect(() => executeExtractField(extract, edges, [src, extract], states)).toThrow(/Input is not valid JSON/)
  })

  it("skips null/undefined values", () => {
    const scrapeNode = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "caption", mode: "dropdown" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [{ caption: "a" }, { caption: null }, {}, { caption: "b" }] } },
    }
    const result = executeExtractField(extract, edges, [scrapeNode, extract], states)
    expect(result.extractedText).toBe("a\nb")
  })

  it("coerces numbers and booleans", () => {
    const scrapeNode = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "likesCount", mode: "dropdown" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [{ likesCount: 42 }, { likesCount: 0 }, { likesCount: true }] } },
    }
    const result = executeExtractField(extract, edges, [scrapeNode, extract], states)
    expect(result.extractedText).toBe("42\n0\ntrue")
  })

  it("stringifies objects at leaf", () => {
    const scrapeNode = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "meta", mode: "custom" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [{ meta: { a: 1 } }, { meta: { b: 2 } }] } },
    }
    const result = executeExtractField(extract, edges, [scrapeNode, extract], states)
    expect(result.extractedText).toBe('{"a":1}\n{"b":2}')
  })

  it("returns empty output when all items miss the field", () => {
    const scrapeNode = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "missing", mode: "custom" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [{ a: 1 }, { b: 2 }] } },
    }
    const result = executeExtractField(extract, edges, [scrapeNode, extract], states)
    expect(result.extractedText).toBe("")
    expect(result.listResults).toEqual([])
  })

  it("handles single-object input (no auto-iterate)", () => {
    const src = makeNode("s", "text-prompt", {})
    const extract = makeNode("e", "extract-field", { field: "name", mode: "custom" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: undefined, targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { text: '{"name":"alice","age":30}' } },
    }
    const result = executeExtractField(extract, edges, [src, extract], states)
    expect(result.extractedText).toBe("alice")
  })

  it("empty path on a scalar array returns each element (whole-item mode)", () => {
    const scrapeNode = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "", mode: "dropdown" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: ["alpha", "beta", "gamma"] } },
    }
    const result = executeExtractField(extract, edges, [scrapeNode, extract], states)
    expect(result.extractedText).toBe("alpha\nbeta\ngamma")
    expect(result.listResults).toEqual(["alpha", "beta", "gamma"])
  })

  it("empty path on a numeric scalar array coerces via String()", () => {
    const scrapeNode = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "", mode: "dropdown" })
    const edges: SimpleEdge[] = [{ id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge]
    const states: Record<string, NodeExecutionState> = {
      s: { status: "completed", output: { json: [1, 2, 3] } },
    }
    const result = executeExtractField(extract, edges, [scrapeNode, extract], states)
    expect(result.extractedText).toBe("1\n2\n3")
  })
})
