/**
 * Fan-out pairs by ROW, and the wire order never decides anything — the
 * in-browser engine's half of backend `fanout-pairing.test.ts`. Same graphs,
 * same expected pairs, so the two engines cannot drift apart on this.
 *
 * `extractNodeOutput` is deliberately NOT mocked: the old fallback ("no value
 * for this row → take the column's first value") is exactly what must not
 * happen for an empty cell.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { planFanOut } from "@nodaro/shared/workflow"

let storeNodes: unknown[] = []
let storeEdges: unknown[] = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ characterDefinitions: [], nodes: storeNodes, edges: storeEdges }),
  },
}))

import {
  getListFanOutForNode,
  getListInputForNode,
  resolveNodeInputs,
  resolveEdgeValuesForTableColumn,
} from "../node-input-resolver"

/* eslint-disable @typescript-eslint/no-explicit-any */
const node = (id: string, type: string, data: Record<string, unknown> = {}): any => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: type, ...data },
})
const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  data?: Record<string, unknown>,
): any => ({ id, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) })

const table = (rows: string[][]) =>
  node("list1", "list", {
    label: "Concepts",
    columns: [
      { id: "a", name: "prompt", handleId: "col_a", type: "text" },
      { id: "b", name: "negative", handleId: "col_b", type: "text" },
    ],
    rows,
  })
const genImage = (data: Record<string, unknown> = {}) =>
  node("gi1", "generate-image", { label: "Generate Image", provider: "gpt-image-2", prompt: "", ...data })

const PROMPT_EDGE = edge("e-p", "list1", "col_a", "gi1", "prompt")
const NEGATIVE_EDGE = edge("e-n", "list1", "col_b", "gi1", "negative")

/** What `handleRunSingleNode` does: plan the fan-out, then resolve each iteration's row. */
function runFanOut(target: any, edges: any[], nodes: any[]) {
  storeNodes = nodes
  storeEdges = edges
  const fanOut = getListFanOutForNode(target, nodes, edges)
  const plan = planFanOut(fanOut, target.type, target.data)
  if (!plan) return { fanOut, plan, iterations: [] as Array<Record<string, unknown>> }
  const iterations = plan.items.map((item, k) => {
    const inputs = resolveNodeInputs(target, nodes, edges, plan.rows[k] ?? k) as unknown as Record<string, unknown>
    return { item, prompt: inputs.prompt, negativePrompt: inputs.negativePrompt }
  })
  return { fanOut, plan, iterations }
}

const pairs = (iterations: Array<Record<string, unknown>>) => iterations.map((i) => [i.prompt, i.negativePrompt])

beforeEach(() => {
  storeNodes = []
  storeEdges = []
})

describe("the wire order never decides what becomes the prompt", () => {
  const rows = [["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["PROMPT-3", "NEG-3"]]

  it("negative wire first: the PROMPT column still drives the fan-out", () => {
    const nodes = [table(rows), genImage()]
    const { fanOut, iterations } = runFanOut(nodes[1], [NEGATIVE_EDGE, PROMPT_EDGE], nodes)
    expect(fanOut?.targetHandle).toBe("prompt")
    expect(fanOut?.items).toEqual(["PROMPT-1", "PROMPT-2", "PROMPT-3"])
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["PROMPT-3", "NEG-3"]])
  })

  it("both orders resolve to deep-equal iterations", () => {
    const nodes = [table(rows), genImage()]
    const a = runFanOut(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], nodes)
    const b = runFanOut(nodes[1], [NEGATIVE_EDGE, PROMPT_EDGE], nodes)
    expect(b.iterations).toEqual(a.iterations)
    expect(b.fanOut).toEqual(a.fanOut)
  })

  it("a list wired to `negative` alone reports that handle, so the executor knows it is not a prompt", () => {
    const nodes = [table(rows), genImage({ prompt: "a red bicycle" })]
    const { fanOut, iterations } = runFanOut(nodes[1], [NEGATIVE_EDGE], nodes)
    expect(fanOut?.targetHandle).toBe("negative")
    expect(iterations.map((i) => i.negativePrompt)).toEqual(["NEG-1", "NEG-2", "NEG-3"])
    for (const i of iterations) expect(i.prompt).toBeUndefined()
  })

  it("wires switched to Each BY HAND read their OWN column (an explicit Each used to read the first column)", () => {
    const each = { outputMode: "each" }
    const nodes = [table(rows), genImage()]
    const wires = [
      edge("e-n", "list1", "col_b", "gi1", "negative", each),
      edge("e-p", "list1", "col_a", "gi1", "prompt", each),
    ]
    expect(pairs(runFanOut(nodes[1], wires, nodes).iterations)).toEqual([
      ["PROMPT-1", "NEG-1"],
      ["PROMPT-2", "NEG-2"],
      ["PROMPT-3", "NEG-3"],
    ])
  })

  it("the legacy wrapper still returns the driving items", () => {
    const nodes = [table(rows), genImage()]
    storeNodes = nodes
    expect(getListInputForNode(nodes[1], nodes, [NEGATIVE_EDGE, PROMPT_EDGE])).toEqual(["PROMPT-1", "PROMPT-2", "PROMPT-3"])
  })
})

describe("how many times the node runs never depends on the wire order", () => {
  const prompts = node("listP", "list", {
    columns: [{ id: "a", name: "prompt", handleId: "col_a", type: "text" }],
    rows: [["PROMPT-1"], ["PROMPT-2"]],
  })
  const negatives = node("listN", "list", {
    columns: [{ id: "a", name: "negative", handleId: "col_a", type: "text" }],
    rows: [["NEG-1"], ["NEG-2"], ["NEG-3"], ["NEG-4"]],
  })
  const P = edge("e-p", "listP", "col_a", "gi1", "prompt")
  const N = edge("e-n", "listN", "col_a", "gi1", "negative")

  it("the list holding the most values sets the count (the shorter one wraps) — same in both orders, same as the backend", () => {
    const target = genImage()
    const nodes = [prompts, negatives, target]
    const a = runFanOut(target, [P, N], nodes)
    const b = runFanOut(target, [N, P], nodes)
    expect(a.iterations).toHaveLength(4)
    expect(b.iterations).toEqual(a.iterations)
    expect(pairs(a.iterations)).toEqual([
      ["PROMPT-1", "NEG-1"],
      ["PROMPT-2", "NEG-2"],
      ["PROMPT-1", "NEG-3"],
      ["PROMPT-2", "NEG-4"],
    ])
  })
})

describe("only an Each wire fans out — the same answer in both engines", () => {
  const rows = [["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["PROMPT-3", "NEG-3"]]

  it("a List wire set to Bundle hands over the whole list ONCE; it does not run the node per row", () => {
    const nodes = [table(rows), genImage()]
    storeNodes = nodes
    const bundle = edge("e-p", "list1", "col_a", "gi1", "prompt", { outputMode: "all" })
    expect(getListFanOutForNode(nodes[1], nodes, [bundle])).toBeUndefined()
  })

  it("a Bundle wire beside an Each wire: the Each wire alone sets the rows", () => {
    const nodes = [table(rows), genImage()]
    storeNodes = nodes
    const bundle = edge("e-n", "list1", "col_b", "gi1", "negative", { outputMode: "all" })
    const fanOut = getListFanOutForNode(nodes[1], nodes, [bundle, PROMPT_EDGE])
    expect(fanOut).toEqual({ items: ["PROMPT-1", "PROMPT-2", "PROMPT-3"], rowIndices: [0, 1, 2], targetHandle: "prompt" })
  })
})

describe("an empty cell stays empty in its own row", () => {
  it("a blank negative in row 2 gives image 2 NO negative — not the column's first value, not row 3's", () => {
    const nodes = [table([["PROMPT-1", "NEG-1"], ["PROMPT-2", ""], ["PROMPT-3", "NEG-3"]]), genImage()]
    const { iterations } = runFanOut(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], nodes)
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", undefined], ["PROMPT-3", "NEG-3"]])
  })

  it("a column with NO values at all contributes nothing — it never borrows the first column's values", () => {
    const nodes = [table([["PROMPT-1", ""], ["PROMPT-2", ""], ["PROMPT-3", ""]]), genImage()]
    for (const order of [[PROMPT_EDGE, NEGATIVE_EDGE], [NEGATIVE_EDGE, PROMPT_EDGE]]) {
      expect(pairs(runFanOut(nodes[1], order, nodes).iterations)).toEqual([
        ["PROMPT-1", undefined],
        ["PROMPT-2", undefined],
        ["PROMPT-3", undefined],
      ])
    }
  })

  it("…and the same in a SINGLE run (one row, no fan-out): a blank negative cell is not the prompt", () => {
    const nodes = [table([["PROMPT-1", ""]]), genImage()]
    storeNodes = nodes
    expect(getListFanOutForNode(nodes[1], nodes, [PROMPT_EDGE, NEGATIVE_EDGE])).toBeUndefined()
    const inputs = resolveNodeInputs(nodes[1], nodes, [PROMPT_EDGE, NEGATIVE_EDGE]) as unknown as Record<string, unknown>
    expect(inputs.prompt).toBe("PROMPT-1")
    expect(inputs.negativePrompt).toBeUndefined()
  })

  it("a fully blank row is not a row", () => {
    const nodes = [table([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["", ""]]), genImage()]
    const { iterations } = runFanOut(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], nodes)
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"]])
  })

  it("a row with a negative but NO prompt still runs — nothing overrides its prompt — in either wire order", () => {
    const target = genImage({ prompt: "a red bicycle" })
    const nodes = [table([["PROMPT-1", "NEG-1"], ["", "NEG-2"], ["PROMPT-3", "NEG-3"]]), target]
    for (const order of [[PROMPT_EDGE, NEGATIVE_EDGE], [NEGATIVE_EDGE, PROMPT_EDGE]]) {
      const { fanOut, iterations } = runFanOut(target, order, nodes)
      expect(fanOut?.rowIndices).toEqual([0, 1, 2])
      expect(fanOut?.items).toEqual(["PROMPT-1", "", "PROMPT-3"])
      expect(fanOut?.targetHandle).toBe("prompt")
      expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], [undefined, "NEG-2"], ["PROMPT-3", "NEG-3"]])
    }
  })

  it("a single-column list is unchanged: blanks are skipped, the count does not grow", () => {
    const single = node("list1", "list", {
      columns: [{ id: "a", name: "Items", handleId: "col_a", type: "text" }],
      rows: [["one"], [""], ["two"], [""]],
    })
    const nodes = [single, genImage()]
    storeNodes = nodes
    expect(getListInputForNode(nodes[1], nodes, [PROMPT_EDGE])).toEqual(["one", "two"])
  })
})

describe("an empty entry of ANY list source contributes nothing — it never falls back to the node's whole text", () => {
  const prompts = node("list1", "list", {
    columns: [{ id: "a", name: "prompt", handleId: "col_a", type: "text" }],
    rows: [["PROMPT-1"], ["PROMPT-2"], ["PROMPT-3"]],
  })

  it("a list node that fans out by default (Filter List), with a hole in the middle", () => {
    const filter = node("fl", "filter-list", { label: "Filter", __listResults: ["NEG-1", "", "NEG-3"] })
    const target = genImage()
    const wires = [PROMPT_EDGE, edge("e-n", "fl", "out", "gi1", "negative")]
    expect(pairs(runFanOut(target, wires, [prompts, filter, target]).iterations)).toEqual([
      ["PROMPT-1", "NEG-1"],
      ["PROMPT-2", undefined],
      ["PROMPT-3", "NEG-3"],
    ])
  })
})

describe("a SHORTER list starts over from its first row — the same answer as the backend", () => {
  it("3 prompts x a 2-row negative list whose second entry is blank", () => {
    const prompts = node("list1", "list", {
      columns: [{ id: "a", name: "prompt", handleId: "col_a", type: "text" }],
      rows: [["PROMPT-1"], ["PROMPT-2"], ["PROMPT-3"]],
    })
    const extract = node("exN", "extract-field", {
      label: "negative", field: "negative", outputType: "list",
      extractedText: "NEG-1\n",
      __listResults: ["NEG-1", ""],
      __alignedListResults: ["NEG-1", ""],
    })
    const target = genImage()
    const wires = [PROMPT_EDGE, edge("e-n", "exN", "text", "gi1", "negative", { outputMode: "each" })]
    expect(pairs(runFanOut(target, wires, [prompts, extract, target]).iterations)).toEqual([
      ["PROMPT-1", "NEG-1"],
      ["PROMPT-2", undefined],
      ["PROMPT-3", "NEG-1"],
    ])
  })
})

describe("the table on the canvas shows what will run", () => {
  // A two-column table whose first column has a hole in row 2.
  const upstream = node("listA", "list", {
    columns: [
      { id: "a", name: "word", handleId: "col_a", type: "text" },
      { id: "b", name: "n", handleId: "col_b", type: "text" },
    ],
    rows: [["x", "1"], ["", "2"], ["y", "3"]],
  })
  const columns = [{ id: "c", name: "word", handleId: "col_c", type: "text" }]
  const preview = (data?: Record<string, unknown>) =>
    resolveEdgeValuesForTableColumn(edge("e", "listA", "col_a", "listB", "col_c_in", data), upstream, [], [upstream], columns)

  it("an Each / Bundle column shows its rows, the empty cell in ITS row", () => {
    expect(preview()).toEqual(["x", "", "y"])
    expect(preview({ outputMode: "all" })).toEqual(["x", "", "y"])
  })

  it("an Item column shows the value the run will pick — Item 2 is the 2nd VALUE, not the hole", () => {
    expect(preview({ outputMode: "item", itemIndex: "2" })).toEqual(["y"])
  })

  it("an Extract Field column shows the row-aligned list", () => {
    const extract = node("exN", "extract-field", {
      outputType: "list",
      __listResults: ["NEG-1", "NEG-3"],
      __alignedListResults: ["NEG-1", "", "NEG-3"],
    })
    const wire = edge("e", "exN", "text", "listB", "col_c_in")
    expect(resolveEdgeValuesForTableColumn(wire, extract, [], [extract], columns)).toEqual(["NEG-1", "", "NEG-3"])
    const item = edge("e", "exN", "text", "listB", "col_c_in", { outputMode: "item", itemIndex: "2" })
    expect(resolveEdgeValuesForTableColumn(item, extract, [], [extract], columns)).toEqual(["NEG-3"])
  })
})

describe("repeat xN keeps every copy on its own row", () => {
  it("2 rows x repeat 2 -> [row1, row1, row2, row2], negatives included", () => {
    const target = genImage({ repeatCount: 2 })
    const nodes = [table([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"]]), target]
    const { iterations } = runFanOut(target, [PROMPT_EDGE, NEGATIVE_EDGE], nodes)
    expect(pairs(iterations)).toEqual([
      ["PROMPT-1", "NEG-1"],
      ["PROMPT-1", "NEG-1"],
      ["PROMPT-2", "NEG-2"],
      ["PROMPT-2", "NEG-2"],
    ])
  })
})

describe("Extract Field (List) lists wired into Generate Image", () => {
  // What the in-browser Extract Field leaves on the node after it ran (List mode):
  // its public list (the values that exist) and the row-aligned twin — one entry
  // per JSON object, empty where the object had no value.
  const exP = node("exP", "extract-field", {
    label: "prompt", field: "prompt", outputType: "list",
    extractedText: "PROMPT-1\nPROMPT-2\nPROMPT-3\nPROMPT-4\nPROMPT-5",
    __listResults: ["PROMPT-1", "PROMPT-2", "PROMPT-3", "PROMPT-4", "PROMPT-5"],
    __alignedListResults: ["PROMPT-1", "PROMPT-2", "PROMPT-3", "PROMPT-4", "PROMPT-5"],
  })
  const exN = node("exN", "extract-field", {
    label: "negative", field: "negative", outputType: "list",
    extractedText: "NEG-1\nNEG-3\nNEG-5",
    __listResults: ["NEG-1", "NEG-3", "NEG-5"],
    __alignedListResults: ["NEG-1", "", "NEG-3", "", "NEG-5"],
  })
  const EXPECTED = [
    ["PROMPT-1", "NEG-1"],
    ["PROMPT-2", undefined],
    ["PROMPT-3", "NEG-3"],
    ["PROMPT-4", undefined],
    ["PROMPT-5", "NEG-5"],
  ]

  it("through a List with two connected columns, in either wire order", () => {
    const list = node("list1", "list", {
      columns: [
        { id: "a", name: "prompt", handleId: "col_a", type: "text", connectedSourceId: "exP" },
        { id: "b", name: "negative", handleId: "col_b", type: "text", connectedSourceId: "exN" },
      ],
      rows: [],
    })
    const target = genImage()
    const nodes = [exP, exN, list, target]
    const wires = [edge("e3", "exP", "text", "list1", "col_a_in"), edge("e4", "exN", "text", "list1", "col_b_in")]
    for (const order of [[PROMPT_EDGE, NEGATIVE_EDGE], [NEGATIVE_EDGE, PROMPT_EDGE]]) {
      expect(pairs(runFanOut(target, [...wires, ...order], nodes).iterations)).toEqual(EXPECTED)
    }
  })

  it("addressing by position still indexes the values that exist: Item 'last' is the last VALUE, not a hole", () => {
    const target = genImage({ prompt: "typed" })
    const nodes = [exN, target]
    storeNodes = nodes
    const wires = [edge("e6", "exN", "text", "gi1", "negative", { outputMode: "item", itemIndex: "last" })]
    const inputs = resolveNodeInputs(target, nodes, wires) as unknown as Record<string, unknown>
    expect(inputs.negativePrompt).toBe("NEG-5")
  })

  it("the PROMPT list still drives when IT is the one with a hole (its row-aligned twin keeps it in the negatives' row space)", () => {
    const holedPrompts = node("exP", "extract-field", {
      label: "prompt", field: "prompt", outputType: "list",
      extractedText: "PROMPT-1\nPROMPT-3",
      __listResults: ["PROMPT-1", "PROMPT-3"],
      __alignedListResults: ["PROMPT-1", "", "PROMPT-3"],
    })
    const negatives = node("exN", "extract-field", {
      label: "negative", field: "negative", outputType: "list",
      extractedText: "NEG-1\nNEG-2\nNEG-3",
      __listResults: ["NEG-1", "NEG-2", "NEG-3"],
      __alignedListResults: ["NEG-1", "NEG-2", "NEG-3"],
    })
    const target = genImage({ prompt: "typed fallback" })
    const direct = [
      edge("e6", "exN", "text", "gi1", "negative", { outputMode: "each" }),
      edge("e5", "exP", "text", "gi1", "prompt", { outputMode: "each" }),
    ]
    const { fanOut, iterations } = runFanOut(target, direct, [holedPrompts, negatives, target])
    expect(fanOut).toEqual({ items: ["PROMPT-1", "", "PROMPT-3"], rowIndices: [0, 1, 2], targetHandle: "prompt" })
    expect(iterations.map((i) => i.negativePrompt)).toEqual(["NEG-1", "NEG-2", "NEG-3"])
  })

  it("wired straight in with both wires on Each", () => {
    const target = genImage()
    const nodes = [exP, exN, target]
    const direct = [
      edge("e6", "exN", "text", "gi1", "negative", { outputMode: "each" }),
      edge("e5", "exP", "text", "gi1", "prompt", { outputMode: "each" }),
    ]
    expect(pairs(runFanOut(target, direct, nodes).iterations)).toEqual(EXPECTED)
  })
})
