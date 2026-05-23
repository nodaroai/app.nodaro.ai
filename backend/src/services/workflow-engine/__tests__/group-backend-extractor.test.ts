/**
 * Task F1: Backend output-extractor support for group/collect nodes.
 *
 * The orchestrator-worker path (published-app runs, scheduled runs, webhook
 * triggers) resolves group/collect outputs by calling extractSourceNodeOutput
 * / extractSourceNodeOutputAsList with a context payload `{ nodes, edges }`.
 * Without a context, group/collect return undefined — graceful no-op for
 * legacy callers that don't have graph access.
 */

import { describe, expect, it } from "vitest"
import {
  extractSourceNodeOutput,
  extractSourceNodeOutputAsList,
  getPrimaryOutput,
} from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeOutput } from "../types.js"

describe("Backend extractor — group", () => {
  it("returns NodeOutput[] for group out-text with 2 text members", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      { id: "t1", type: "text-prompt", data: { text: "hello" }, parentId: "g" },
      { id: "t2", type: "text-prompt", data: { text: "world" }, parentId: "g" },
    ]
    const edges: SimpleEdge[] = []
    const result = extractSourceNodeOutputAsList(nodes[0], undefined, "out-text", { nodes, edges })
    expect(result).toEqual(["hello", "world"])
  })

  it("returns scalar NodeOutput { text } for first item via extractSourceNodeOutput", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      { id: "t1", type: "text-prompt", data: { text: "hello" }, parentId: "g" },
    ]
    const result = extractSourceNodeOutput(nodes[0], undefined, "out-text", { nodes, edges: [] })
    expect(result).toEqual({ text: "hello" })
  })

  it("returns undefined when no context", () => {
    const node: SimpleNode = { id: "g", type: "group", data: {} }
    expect(extractSourceNodeOutput(node, undefined, "out-text")).toBeUndefined()
    expect(extractSourceNodeOutputAsList(node, undefined, "out-text")).toBeUndefined()
  })

  it("returns undefined when sourceHandle is missing", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      { id: "t1", type: "text-prompt", data: { text: "hello" }, parentId: "g" },
    ]
    expect(extractSourceNodeOutput(nodes[0], undefined, undefined, { nodes, edges: [] })).toBeUndefined()
  })

  it("returns undefined when bucket is empty for requested type", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      { id: "t1", type: "text-prompt", data: { text: "hello" }, parentId: "g" },
    ]
    // Group has only text members; out-image returns nothing.
    expect(extractSourceNodeOutput(nodes[0], undefined, "out-image", { nodes, edges: [] })).toBeUndefined()
  })

  it("getPrimaryOutput on a group NodeOutput routes by sourceHandle", () => {
    // When the orchestrator stores a group's resolved output in nodeStates,
    // it's a scalar NodeOutput like { text: "hello" }. getPrimaryOutput must
    // return the corresponding field based on the consumer's sourceHandle.
    const out: NodeOutput = { text: "hello" }
    expect(getPrimaryOutput(out, "group", "out-text")).toBe("hello")
    expect(getPrimaryOutput(out, "group", "out-image")).toBeUndefined()
    expect(getPrimaryOutput(out, "group", null)).toBe("hello")
  })

  it("skips data-typed children (e.g. parameter pickers)", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      // mood is a parameter picker → getOutputType returns "data" → skipped.
      { id: "p1", type: "mood", data: { mood: "happy" }, parentId: "g" },
      { id: "t1", type: "text-prompt", data: { text: "hello" }, parentId: "g" },
    ]
    const result = extractSourceNodeOutputAsList(nodes[0], undefined, "out-text", { nodes, edges: [] })
    expect(result).toBeUndefined() // single item — list semantics require >1
    const scalar = extractSourceNodeOutput(nodes[0], undefined, "out-text", { nodes, edges: [] })
    expect(scalar).toEqual({ text: "hello" })
  })
})

describe("Backend extractor — collect", () => {
  it("returns NodeOutput[] for collect out-text with 2 upstream text-prompts", () => {
    const nodes: SimpleNode[] = [
      { id: "c", type: "collect", data: { order: ["t1", "t2"] } },
      { id: "t1", type: "text-prompt", data: { text: "one" } },
      { id: "t2", type: "text-prompt", data: { text: "two" } },
    ]
    const edges: SimpleEdge[] = [
      { id: "e1", source: "t1", target: "c", targetHandle: "in" },
      { id: "e2", source: "t2", target: "c", targetHandle: "in" },
    ]
    const result = extractSourceNodeOutputAsList(nodes[0], undefined, "out-text", { nodes, edges })
    expect(result).toEqual(["one", "two"])
  })

  it("respects data.order for collect", () => {
    const nodes: SimpleNode[] = [
      // order says t2 first, then t1
      { id: "c", type: "collect", data: { order: ["t2", "t1"] } },
      { id: "t1", type: "text-prompt", data: { text: "one" } },
      { id: "t2", type: "text-prompt", data: { text: "two" } },
    ]
    const edges: SimpleEdge[] = [
      { id: "e1", source: "t1", target: "c", targetHandle: "in" },
      { id: "e2", source: "t2", target: "c", targetHandle: "in" },
    ]
    const result = extractSourceNodeOutputAsList(nodes[0], undefined, "out-text", { nodes, edges })
    expect(result).toEqual(["two", "one"])
  })

  it("returns scalar { text } for collect first item via extractSourceNodeOutput", () => {
    const nodes: SimpleNode[] = [
      { id: "c", type: "collect", data: { order: ["t1"] } },
      { id: "t1", type: "text-prompt", data: { text: "hello" } },
    ]
    const edges: SimpleEdge[] = [
      { id: "e1", source: "t1", target: "c", targetHandle: "in" },
    ]
    const result = extractSourceNodeOutput(nodes[0], undefined, "out-text", { nodes, edges })
    expect(result).toEqual({ text: "hello" })
  })

  it("returns undefined when no context for collect", () => {
    const node: SimpleNode = { id: "c", type: "collect", data: {} }
    expect(extractSourceNodeOutput(node, undefined, "out-text")).toBeUndefined()
    expect(extractSourceNodeOutputAsList(node, undefined, "out-text")).toBeUndefined()
  })

  it("ignores edges to non-in handles", () => {
    const nodes: SimpleNode[] = [
      { id: "c", type: "collect", data: {} },
      { id: "t1", type: "text-prompt", data: { text: "hello" } },
    ]
    // Edge targeting a non-"in" handle should be ignored.
    const edges: SimpleEdge[] = [
      { id: "e1", source: "t1", target: "c", targetHandle: "config" },
    ]
    expect(extractSourceNodeOutput(nodes[0], undefined, "out-text", { nodes, edges })).toBeUndefined()
  })

  it("getPrimaryOutput on a collect NodeOutput routes by sourceHandle", () => {
    const out: NodeOutput = { imageUrl: "https://example.com/a.png" }
    expect(getPrimaryOutput(out, "collect", "out-image")).toBe("https://example.com/a.png")
    expect(getPrimaryOutput(out, "collect", "out-text")).toBeUndefined()
  })
})
