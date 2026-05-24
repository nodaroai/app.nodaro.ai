import { describe, it, expect } from "vitest"
import { getListInputForNode, resolveNodeInputs } from "../input-resolver.js"
import { extractSourceNodeOutputAsList, buildNodeOutputFromJobData } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"
import { splitGeneratedItems } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Backend Generate Text (llm-chat) `items` consumption — REQ B parity.
//
// The frontend single-node executor fans the llm-chat `items` handle out over
// the ===NEXT===-split list into a downstream Loop AND Generate Image. The
// backend orchestrator (scheduled / webhook / MCP run_workflow /
// POST /v1/workflows/:id/run) MUST do the same so the SAME workflow yields the
// SAME number of items server-side and in the browser.
//
// The upstream node carries ONLY `generatedText` (no generatedResults) — the
// only way to get the 3 items is splitGeneratedItems on the `items` handle.
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  data?: Record<string, unknown>,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
    data,
  }
}

const THREE = "p1===NEXT===p2===NEXT===p3"

describe("backend: getListInputForNode — llm-chat items fan-out", () => {
  it("items → generate-image fans out over the ===NEXT=== split (3 items)", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    const target = node("g1", "generate-image")
    const allNodes = [llm, target]
    const edges = [edge("llm1", "g1", "items", "prompt")]
    const states: Record<string, NodeExecutionState> = {}

    const items = getListInputForNode(target, edges, states, allNodes)
    expect(items).toEqual(["p1", "p2", "p3"])
  })

  it("items → generate-image reads from completed state.output.items too", () => {
    const llm = node("llm1", "llm-chat")
    const target = node("g1", "generate-image")
    const allNodes = [llm, target]
    const edges = [edge("llm1", "g1", "items", "prompt")]
    const states: Record<string, NodeExecutionState> = {
      llm1: { status: "completed", output: { text: THREE, items: ["p1", "p2", "p3"] } },
    }

    const items = getListInputForNode(target, edges, states, allNodes)
    expect(items).toEqual(["p1", "p2", "p3"])
  })

  it("items → downstream llm-chat consumer fans out (3 items)", () => {
    const upstream = node("llm1", "llm-chat", { generatedText: THREE })
    const target = node("llm2", "llm-chat")
    const allNodes = [upstream, target]
    const edges = [edge("llm1", "llm2", "items", "prompt")]
    const states: Record<string, NodeExecutionState> = {}

    const items = getListInputForNode(target, edges, states, allNodes)
    expect(items).toEqual(["p1", "p2", "p3"])
  })

  it("DAG parity: backend split equals the shared splitGeneratedItems result", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    const target = node("g1", "generate-image")
    const items = getListInputForNode(target, [edge("llm1", "g1", "items", "prompt")], {}, [llm, target])
    expect(items).toEqual(splitGeneratedItems(THREE))
  })

  it("default/text handle does NOT fan out (scalar source)", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    const target = node("g1", "generate-image")
    const allNodes = [llm, target]
    const states: Record<string, NodeExecutionState> = {}

    expect(getListInputForNode(target, [edge("llm1", "g1", "text", "prompt")], states, allNodes)).toBeUndefined()
    expect(getListInputForNode(target, [edge("llm1", "g1", null, "prompt")], states, allNodes)).toBeUndefined()
  })

  it("item/last/item:N modes pick a single value — no fan-out", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    const target = node("g1", "generate-image")
    const allNodes = [llm, target]
    const states: Record<string, NodeExecutionState> = {}

    for (const mode of ["item", "last", "item:1"]) {
      const items = getListInputForNode(
        target,
        [edge("llm1", "g1", "items", "prompt", { outputMode: mode })],
        states,
        allNodes,
      )
      expect(items).toBeUndefined()
    }
  })
})

describe("backend: getListInputForNode — llm-chat items → Loop", () => {
  it("items → loop connected column fans out over the 3 split items", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    const loop = node("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_a", type: "text" }],
      rows: [],
    })
    // Loop is the fan-out node itself; its column is fed from the llm items.
    const allNodes = [llm, loop]
    const edges = [
      edge("llm1", "loop1", "items", "col_a_in", { outputMode: "each" }),
    ]
    const states: Record<string, NodeExecutionState> = {}

    const items = getListInputForNode(loop, edges, states, allNodes)
    expect(items).toEqual(["p1", "p2", "p3"])
  })

  it("items → loop legacy global 'in' handle fans out over the 3 split items", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    const loop = node("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_a", type: "text" }],
      rows: [],
    })
    const allNodes = [llm, loop]
    const edges = [
      edge("llm1", "loop1", "items", "in", { outputMode: "each" }),
    ]
    const states: Record<string, NodeExecutionState> = {}

    const items = getListInputForNode(loop, edges, states, allNodes)
    expect(items).toEqual(["p1", "p2", "p3"])
  })

  it("already-structured guard: items blocks are NOT re-split by the column delimiter", () => {
    // Each ===NEXT=== block may itself contain commas/newlines. The items split
    // is already structured — the loop column's own delimiter must NOT chop it
    // further (mirrors the split-text already-structured contract + frontend).
    const llm = node("llm1", "llm-chat", { generatedText: "a, b, c===NEXT===d, e===NEXT===f" })
    const loop = node("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_a", type: "text", splitDelimiter: "," }],
      rows: [],
    })
    const allNodes = [llm, loop]
    const edges = [
      edge("llm1", "loop1", "items", "col_a_in", { outputMode: "each" }),
    ]
    const states: Record<string, NodeExecutionState> = {}

    const items = getListInputForNode(loop, edges, states, allNodes)
    expect(items).toEqual(["a, b, c", "d, e", "f"])
  })

  it("already-structured guard: newline-containing blocks survive (no newline re-chop)", () => {
    const llm = node("llm1", "llm-chat", { generatedText: "line1\nline2===NEXT===line3\nline4" })
    const loop = node("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_a", type: "text" }],
      rows: [],
    })
    const allNodes = [llm, loop]
    const edges = [
      edge("llm1", "loop1", "items", "col_a_in", { outputMode: "each" }),
    ]
    const states: Record<string, NodeExecutionState> = {}

    const items = getListInputForNode(loop, edges, states, allNodes)
    expect(items).toEqual(["line1\nline2", "line3\nline4"])
  })
})

describe("backend: resolveNodeInputs — llm-chat items per-iteration value", () => {
  it("items → loop column per-iteration value picks the i-th split item", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    const loop = node("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_a", type: "text" }],
      rows: [],
    })
    const target = node("g1", "generate-image")
    const allNodes = [llm, loop, target]
    const edges = [
      edge("llm1", "loop1", "items", "col_a_in", { outputMode: "each" }),
      edge("loop1", "g1", "col_a", "prompt", { outputMode: "each" }),
    ]
    const states: Record<string, NodeExecutionState> = {}

    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 0).prompt).toBe("p1")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 1).prompt).toBe("p2")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 2).prompt).toBe("p3")
  })

  it("items → direct generate-image consumer per-iteration value picks the i-th split item", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    const target = node("g1", "generate-image")
    const allNodes = [llm, target]
    const edges = [edge("llm1", "g1", "items", "prompt", { outputMode: "each" })]
    const states: Record<string, NodeExecutionState> = {}

    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 0).prompt).toBe("p1")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 1).prompt).toBe("p2")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 2).prompt).toBe("p3")
  })

  it("items → direct llm-chat consumer per-iteration value picks the i-th split item", () => {
    const upstream = node("llm1", "llm-chat", { generatedText: THREE })
    const target = node("llm2", "llm-chat")
    const allNodes = [upstream, target]
    const edges = [edge("llm1", "llm2", "items", "prompt", { outputMode: "each" })]
    const states: Record<string, NodeExecutionState> = {}

    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 0).prompt).toBe("p1")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 1).prompt).toBe("p2")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 2).prompt).toBe("p3")
  })

  it("non-iteration context: default-mode items edge leaves the full text scalar (no per-item split)", () => {
    // listIterationIndex undefined + no item/last mode → falls through to the
    // scalar prompt value (full generatedText with delimiters intact), matching
    // the frontend's scalar-honest fallback. The upstream has completed state
    // (as it would mid-orchestration) so the scalar accessor returns the text.
    const upstream = node("llm1", "llm-chat", { generatedText: THREE })
    const target = node("llm2", "llm-chat")
    const allNodes = [upstream, target]
    const edges = [edge("llm1", "llm2", "items", "prompt")]
    const states: Record<string, NodeExecutionState> = {
      llm1: { status: "completed", output: { text: THREE, items: ["p1", "p2", "p3"] } },
    }

    expect(resolveNodeInputs(target, edges, states, allNodes).prompt).toBe(THREE)
  })
})

describe("backend: extractSourceNodeOutputAsList — llm-chat items", () => {
  it("returns the ===NEXT=== split for the items handle", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    expect(extractSourceNodeOutputAsList(llm, undefined, "items")).toEqual(["p1", "p2", "p3"])
  })

  it("returns undefined for the default/text handle (scalar source)", () => {
    const llm = node("llm1", "llm-chat", { generatedText: THREE })
    expect(extractSourceNodeOutputAsList(llm, undefined, "text")).toBeUndefined()
    expect(extractSourceNodeOutputAsList(llm, undefined, null)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// LIVE ORCHESTRATION SHAPE — the real path the orchestrator takes.
//
// node-executor.ts::pollJobToCompletion reads the completed job's
// `output_data` and runs it through `buildNodeOutputFromJobData(outputData,
// "llm-chat")` to produce `state.output`. The llm-chat route stores
// `output_data: { generatedText, model, usage }` (NO items). The orchestrator
// never syncs output back into `node.data`, so the upstream node's `data`
// stays EMPTY at consume time. These tests drive that exact shape — they would
// silently pass with pre-populated `output: { items }` or `data: { generatedText }`
// (the artificial state the older tests used), masking the dead fan-out.
// ---------------------------------------------------------------------------

/** Reproduce the orchestrator's completed-node state from the real job.output_data. */
function liveLlmState(generatedText: string): NodeExecutionState {
  const output = buildNodeOutputFromJobData(
    { generatedText, model: "x", usage: {} },
    "llm-chat",
  )
  return { status: "completed", output }
}

describe("backend: LIVE orchestration shape — buildNodeOutputFromJobData drives items", () => {
  it("fix #1: emits items[] for a completed llm-chat job (the real output_data shape)", () => {
    const output = buildNodeOutputFromJobData(
      { generatedText: THREE, model: "x", usage: {} },
      "llm-chat",
    )
    expect(output.text).toBe(THREE)
    expect(output.items).toEqual(["p1", "p2", "p3"])
  })

  it("fix #1: does NOT add items for non-llm-chat text nodes (e.g. ai-writer)", () => {
    const output = buildNodeOutputFromJobData(
      { generatedText: THREE, model: "x", usage: {} },
      "ai-writer",
    )
    expect(output.text).toBe(THREE)
    expect(output.items).toBeUndefined()
  })

  it("fix #1: llm-chat with no text produces no items (empty job output_data)", () => {
    const output = buildNodeOutputFromJobData({ model: "x", usage: {} }, "llm-chat")
    expect(output.text).toBeUndefined()
    expect(output.items).toBeUndefined()
  })

  it("fix #1: getListInputForNode fans out over a REAL completed llm-chat job (data EMPTY)", () => {
    // The source node's data is EMPTY — exactly as the orchestrator leaves it.
    // The ONLY source of items is state.output, built from job.output_data.
    const llm = node("llm1", "llm-chat") // no generatedText / generatedResults
    const target = node("g1", "generate-image")
    const allNodes = [llm, target]
    const edges = [edge("llm1", "g1", "items", "prompt")]
    const states: Record<string, NodeExecutionState> = { llm1: liveLlmState(THREE) }

    const items = getListInputForNode(target, edges, states, allNodes)
    expect(items).toEqual(["p1", "p2", "p3"])
  })

  it("fix #1: resolveNodeInputs per-iteration over a REAL completed llm-chat job (data EMPTY)", () => {
    const llm = node("llm1", "llm-chat") // no generatedText / generatedResults
    const target = node("g1", "generate-image")
    const allNodes = [llm, target]
    const edges = [edge("llm1", "g1", "items", "prompt", { outputMode: "each" })]
    const states: Record<string, NodeExecutionState> = { llm1: liveLlmState(THREE) }

    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 0).prompt).toBe("p1")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 1).prompt).toBe("p2")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 2).prompt).toBe("p3")
  })

  it("fix #1: items → loop fan-out over a REAL completed llm-chat job (data EMPTY)", () => {
    const llm = node("llm1", "llm-chat")
    const loop = node("loop1", "loop", {
      columns: [{ id: "c1", handleId: "col_a", type: "text" }],
      rows: [],
    })
    const allNodes = [llm, loop]
    const edges = [edge("llm1", "loop1", "items", "col_a_in", { outputMode: "each" })]
    const states: Record<string, NodeExecutionState> = { llm1: liveLlmState(THREE) }

    const items = getListInputForNode(loop, edges, states, allNodes)
    expect(items).toEqual(["p1", "p2", "p3"])
  })
})

describe("backend: items handle PRECEDENCE over stale generatedResults (fix #2)", () => {
  it("fix #2: items edge fans out over the CURRENT split, NOT stale data.generatedResults", () => {
    // The upstream llm-chat carries BOTH (a) stale generatedResults persisted
    // from a prior browser run AND (b) the current run's state.output (built
    // from job.output_data via buildNodeOutputFromJobData). The frontend's
    // `items` handle ALWAYS splits the CURRENT text — the backend must match.
    // Without the precedence fix, `effectiveListResults` (= the stale
    // generatedResults) intercepts the each-mode edge and yields old1/old2.
    const llm = node("llm1", "llm-chat", {
      generatedResults: [{ text: "old1" }, { text: "old2" }],
    })
    const target = node("g1", "generate-image")
    const allNodes = [llm, target]
    const edges = [edge("llm1", "g1", "items", "prompt", { outputMode: "each" })]
    const states: Record<string, NodeExecutionState> = {
      llm1: liveLlmState("n1===NEXT===n2===NEXT===n3"),
    }

    // getListInputForNode (fan-out detector) must report the CURRENT 3 items.
    expect(getListInputForNode(target, edges, states, allNodes)).toEqual(["n1", "n2", "n3"])

    // resolveNodeInputs per-iteration must yield the CURRENT items, never old1/old2.
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 0).prompt).toBe("n1")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 1).prompt).toBe("n2")
    expect(resolveNodeInputs(target, edges, states, allNodes, undefined, 2).prompt).toBe("n3")
  })
})
