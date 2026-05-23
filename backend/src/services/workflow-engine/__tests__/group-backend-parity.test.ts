/**
 * Task J2: Backend parity test
 *
 * Verifies that the backend output-extractor produces the same buckets as the
 * frontend's extractNodeOutputAsList (J1) for equivalent group/collect graphs.
 * This is the parity guarantee that lets the orchestrator-worker (published
 * apps, scheduled triggers, webhook triggers) honor Group/Collect semantics
 * without re-running a browser.
 *
 * Signature note (verified against output-extractor.ts:360):
 *   extractSourceNodeOutputAsList(node, triggerData?, sourceHandle?, context?)
 */

import { describe, expect, it } from "vitest"
import { extractSourceNodeOutputAsList, extractSourceNodeOutput } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

describe("Backend parity — group/collect", () => {
  it("group out-text returns string[] of all member text values", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      { id: "t1", type: "text-prompt", data: { text: "hello" }, parentId: "g" },
      { id: "t2", type: "text-prompt", data: { text: "world" }, parentId: "g" },
    ]
    const result = extractSourceNodeOutputAsList(nodes[0], undefined, "out-text", { nodes, edges: [] })
    expect(result).toEqual(["hello", "world"])
  })

  it("collect out-text respects data.order", () => {
    const nodes: SimpleNode[] = [
      { id: "c", type: "collect", data: { order: ["t2", "t1"] } },
      { id: "t1", type: "text-prompt", data: { text: "first" } },
      { id: "t2", type: "text-prompt", data: { text: "second" } },
    ]
    const edges: SimpleEdge[] = [
      { id: "e1", source: "t1", target: "c", targetHandle: "in" },
      { id: "e2", source: "t2", target: "c", targetHandle: "in" },
    ]
    const result = extractSourceNodeOutputAsList(nodes[0], undefined, "out-text", { nodes, edges })
    expect(result).toEqual(["second", "first"])
  })

  it("extractSourceNodeOutput returns first text item as NodeOutput.text", () => {
    const nodes: SimpleNode[] = [
      { id: "g", type: "group", data: {} },
      { id: "t1", type: "text-prompt", data: { text: "first" }, parentId: "g" },
    ]
    const result = extractSourceNodeOutput(nodes[0], undefined, "out-text", { nodes, edges: [] })
    expect(result).toEqual({ text: "first" })
  })
})
