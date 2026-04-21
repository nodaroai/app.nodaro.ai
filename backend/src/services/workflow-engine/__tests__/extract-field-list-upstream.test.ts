import { describe, it, expect } from "vitest"
import { executeExtractField } from "../inline-executor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data, position: { x: 0, y: 0 } } as SimpleNode
}

/**
 * Bug: When Extract Field is connected after Filter List (or any list-producing
 * node like deduplicate / merge-lists / split-text), it used to read only
 * `state.output.text` — which Filter List sets to `filtered[0]`. That meant
 * Extract Field silently operated on just the first filtered item. If upstream
 * order shifted between runs (e.g. a web-scrape with non-deterministic order),
 * Extract Field's output would change dramatically: 2 results one run, 10 the
 * next, even when Filter List kept the same items overall.
 *
 * Fix: Extract Field now iterates `state.output.listResults` when present —
 * same auto-iterate behavior as web-scrape's `output.json: [...]`.
 */
describe("executeExtractField — listResults upstream", () => {
  it("iterates over every filter-list item, not just the first (the user's bug)", () => {
    const filter = makeNode("f", "filter-list", {})
    const extract = makeNode("e", "extract-field", {
      field: "url",
      mode: "dropdown",
      outputType: "list",
    })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "f", target: "e", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    ]
    const items = [
      JSON.stringify({ likesCount: 50000, url: "post-b" }),
      JSON.stringify({ likesCount: 45000, url: "post-d" }),
      JSON.stringify({ likesCount: 30000, url: "post-e" }),
    ]
    const states: Record<string, NodeExecutionState> = {
      f: { status: "completed", output: { text: items[0], listResults: items } },
    }

    const result = executeExtractField(extract, edges, [filter, extract], states)

    expect(result.listResults).toEqual(["post-b", "post-d", "post-e"])
    expect(result.extractedText).toBe("post-b\npost-d\npost-e")
  })

  it("is stable when upstream item order shifts (repro for inconsistent counts)", () => {
    const filter = makeNode("f", "filter-list", {})
    const extract = makeNode("e", "extract-field", { field: "url", mode: "dropdown" })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "f", target: "e", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    ]
    const runA = [
      JSON.stringify({ url: "a" }),
      JSON.stringify({ url: "b" }),
      JSON.stringify({ url: "c" }),
    ]
    const runB = [runA[2], runA[0], runA[1]] // same items, different order

    const stateA: Record<string, NodeExecutionState> = {
      f: { status: "completed", output: { text: runA[0], listResults: runA } },
    }
    const stateB: Record<string, NodeExecutionState> = {
      f: { status: "completed", output: { text: runB[0], listResults: runB } },
    }

    const resA = executeExtractField(extract, edges, [filter, extract], stateA)
    const resB = executeExtractField(extract, edges, [filter, extract], stateB)

    // Order may shift but the set of extracted values is stable — critical for
    // pipelines that feed Extract Field into downstream fan-out.
    expect(new Set((resA.extractedText ?? "").split("\n"))).toEqual(new Set(["a", "b", "c"]))
    expect(new Set((resB.extractedText ?? "").split("\n"))).toEqual(new Set(["a", "b", "c"]))
  })

  it("works for deduplicate upstream (same listResults contract)", () => {
    const dedup = makeNode("d", "deduplicate", {})
    const extract = makeNode("e", "extract-field", {
      field: "name",
      mode: "custom",
      outputType: "list",
    })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "d", target: "e", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    ]
    const items = [
      JSON.stringify({ name: "alice" }),
      JSON.stringify({ name: "bob" }),
    ]
    const states: Record<string, NodeExecutionState> = {
      d: { status: "completed", output: { text: items[0], listResults: items } },
    }

    const result = executeExtractField(extract, edges, [dedup, extract], states)
    expect(result.listResults).toEqual(["alice", "bob"])
  })

  it("works for merge-lists upstream", () => {
    const merge = makeNode("m", "merge-lists", {})
    const extract = makeNode("e", "extract-field", {
      field: "id",
      mode: "custom",
      outputType: "list",
    })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "m", target: "e", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    ]
    const items = [
      JSON.stringify({ id: 1 }),
      JSON.stringify({ id: 2 }),
      JSON.stringify({ id: 3 }),
    ]
    const states: Record<string, NodeExecutionState> = {
      m: { status: "completed", output: { text: items[0], listResults: items } },
    }

    const result = executeExtractField(extract, edges, [merge, extract], states)
    expect(result.listResults).toEqual(["1", "2", "3"])
  })

  it("works for split-text upstream (scalar strings, not JSON objects)", () => {
    const split = makeNode("s", "split-text", {})
    const extract = makeNode("e", "extract-field", {
      field: "",
      mode: "dropdown",
      outputType: "list",
    })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "s", target: "e", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    ]
    const states: Record<string, NodeExecutionState> = {
      s: {
        status: "completed",
        output: { text: "foo", listResults: ["foo", "bar", "baz"], splitResults: ["foo", "bar", "baz"] },
      },
    }

    const result = executeExtractField(extract, edges, [split, extract], states)
    // Empty path + scalar array → each string preserved (whole-item mode)
    expect(result.listResults).toEqual(["foo", "bar", "baz"])
  })

  it("web-scrape upstream (output.json array) still takes precedence over listResults", () => {
    // state.output.json is set — path should use json directly, not re-parse listResults
    const scrape = makeNode("s", "web-scrape", {})
    const extract = makeNode("e", "extract-field", { field: "caption", mode: "custom" })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "s", target: "e", sourceHandle: "json", targetHandle: "in" } as SimpleEdge,
    ]
    const states: Record<string, NodeExecutionState> = {
      s: {
        status: "completed",
        output: {
          json: [{ caption: "a" }, { caption: "b" }],
          // A hypothetical corrupted listResults mustn't override the canonical json field
          listResults: ["stale"],
        },
      },
    }

    const result = executeExtractField(extract, edges, [scrape, extract], states)
    expect(result.extractedText).toBe("a\nb")
  })

  it("empty listResults yields empty output (no crash)", () => {
    const filter = makeNode("f", "filter-list", {})
    const extract = makeNode("e", "extract-field", { field: "url", mode: "custom" })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "f", target: "e", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    ]
    const states: Record<string, NodeExecutionState> = {
      f: { status: "completed", output: { text: "", listResults: [] } },
    }

    // Falls through to the text branch which early-returns on empty input —
    // listResults: [] is the existing contract for "nothing extracted" (see
    // extract-field.test.ts "returns empty output when all items miss the field").
    const result = executeExtractField(extract, edges, [filter, extract], states)
    expect(result.extractedText).toBe("")
    expect(result.text).toBe("")
  })

  /**
   * User-reported bug: a list node with a single row whose value is a JSON
   * array of objects should let extract-field iterate per element, matching
   * what json-process does and what web-scrape `output.json: [...]` already did.
   */
  it("spreads a single JSON-array item from list upstream into per-element extraction", () => {
    const list = makeNode("l", "list", {})
    const extract = makeNode("e", "extract-field", {
      field: "url",
      mode: "dropdown",
      outputType: "list",
    })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "l", target: "e", sourceHandle: null, targetHandle: "in" } as SimpleEdge,
    ]
    const jsonArrayItem = JSON.stringify([
      { url: "one" },
      { url: "two" },
      { url: "three" },
    ])
    const states: Record<string, NodeExecutionState> = {
      l: { status: "completed", output: { text: jsonArrayItem, listResults: [jsonArrayItem] } },
    }

    const result = executeExtractField(extract, edges, [list, extract], states)

    expect(result.listResults).toEqual(["one", "two", "three"])
    expect(result.extractedText).toBe("one\ntwo\nthree")
  })
})
