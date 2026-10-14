/**
 * Fan-out pairs by ROW, and the wire order never decides anything.
 *
 * Three silent failures this pins, all on the real engine functions the
 * orchestrator calls (no re-implementation of the rules in the test):
 *
 *   1. The list that DROVE a fan-out had its item written into the prompt no
 *      matter which handle it was wired to. Connect the `negative` wire before
 *      the `prompt` wire — or wire a list to `negative` alone — and every image
 *      was generated FROM the negative text.
 *   2. An empty cell was dropped and everything below it moved up, so image 3
 *      got the negative of row 5.
 *   3. Repeat xN re-used the expanded iteration number as the row number, so the
 *      second copy of row 1 was paired with row 2's sibling cells.
 */
import { describe, it, expect } from "vitest"
import { planFanOut } from "@nodaro/shared/workflow"
import { getListFanOutForNode, getListInputForNode, resolveNodeInputs } from "../input-resolver.js"
import { executeExtractField } from "../inline-executor.js"
import { resolveFanOutIterationInputs } from "../../../workers/fan-out-inputs.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

type States = Record<string, NodeExecutionState>

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data })
const edge = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  data?: Record<string, unknown>,
): SimpleEdge => ({ id, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) }) as SimpleEdge

const table = (rows: string[][]): SimpleNode =>
  node("list1", "list", {
    label: "Concepts",
    columns: [
      { id: "a", name: "prompt", handleId: "col_a", type: "text" },
      { id: "b", name: "negative", handleId: "col_b", type: "text" },
    ],
    rows,
  })

const genImage = (data: Record<string, unknown> = {}): SimpleNode =>
  node("gi1", "generate-image", { label: "Generate Image", provider: "gpt-image-2", prompt: "", ...data })

const PROMPT_EDGE = edge("e-p", "list1", "col_a", "gi1", "prompt")
const NEGATIVE_EDGE = edge("e-n", "list1", "col_b", "gi1", "negative")

/** Exactly what the orchestrator does for one fan-out node: plan, then resolve each iteration. */
function runFanOut(target: SimpleNode, edges: SimpleEdge[], nodes: SimpleNode[], states: States = {}) {
  const fanOut = getListFanOutForNode(target, edges, states, nodes)
  const plan = planFanOut(fanOut, target.type, target.data)
  if (!plan) return { fanOut, plan, iterations: [] as Array<Record<string, unknown>> }
  const iterations = plan.items.map((_, k) =>
    resolveFanOutIterationInputs(target, plan, k, edges, states, nodes) as unknown as Record<string, unknown>,
  )
  return { fanOut, plan, iterations }
}

const pairs = (iterations: Array<Record<string, unknown>>) =>
  iterations.map((i) => [i.overridePrompt ?? i.prompt, i.negativePrompt])

describe("the wire order never decides what becomes the prompt", () => {
  const rows = [["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["PROMPT-3", "NEG-3"]]
  const nodes = [table(rows), genImage()]

  it("prompt wire first: each image gets its own prompt + negative", () => {
    const { iterations } = runFanOut(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], nodes)
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["PROMPT-3", "NEG-3"]])
  })

  it("negative wire first: IDENTICAL result — the negative text never reaches the prompt", () => {
    const { fanOut, iterations } = runFanOut(nodes[1], [NEGATIVE_EDGE, PROMPT_EDGE], nodes)
    expect(fanOut?.targetHandle).toBe("prompt")
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["PROMPT-3", "NEG-3"]])
    for (const i of iterations) expect(String(i.prompt)).not.toMatch(/^NEG-/)
  })

  it("both orders resolve to deep-equal inputs for every iteration", () => {
    const a = runFanOut(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], nodes).iterations
    const b = runFanOut(nodes[1], [NEGATIVE_EDGE, PROMPT_EDGE], nodes).iterations
    expect(b).toEqual(a)
  })

  it("a list wired to `negative` ALONE fans out the negative and leaves the typed prompt alone", () => {
    const target = genImage({ prompt: "a red bicycle" })
    const { fanOut, iterations } = runFanOut(target, [NEGATIVE_EDGE], [table(rows), target])
    expect(fanOut?.targetHandle).toBe("negative")
    expect(iterations).toHaveLength(3)
    expect(iterations.map((i) => i.negativePrompt)).toEqual(["NEG-1", "NEG-2", "NEG-3"])
    for (const i of iterations) {
      expect(i.overridePrompt).toBeUndefined()
      expect(i.prompt).toBeUndefined()
    }
  })

  it("wires switched to Each BY HAND read their own column too (with the state the orchestrator injects for a List)", () => {
    const each = { outputMode: "each" }
    const wires = [
      edge("e-n", "list1", "col_b", "gi1", "negative", each),
      edge("e-p", "list1", "col_a", "gi1", "prompt", each),
    ]
    // The orchestrator seeds a List source with its first cell only.
    const states: States = { list1: { status: "completed", output: { text: "PROMPT-1" } } }
    const { iterations } = runFanOut(nodes[1], wires, nodes, states)
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["PROMPT-3", "NEG-3"]])
  })

  it("the legacy wrapper still returns the driving items (what every old caller counts)", () => {
    expect(getListInputForNode(nodes[1], [NEGATIVE_EDGE, PROMPT_EDGE], {}, nodes)).toEqual(["PROMPT-1", "PROMPT-2", "PROMPT-3"])
  })
})

describe("how many times the node runs never depends on the wire order", () => {
  // Two separate lists of different lengths: 2 prompts, 4 negatives.
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

  it("the list holding the most values sets the count (the shorter one wraps) — same in both orders", () => {
    const target = genImage()
    const nodes = [prompts, negatives, target]
    const a = runFanOut(target, [P, N], nodes)
    const b = runFanOut(target, [N, P], nodes)
    expect(a.iterations).toHaveLength(4)
    expect(b.iterations).toEqual(a.iterations)
    expect(a.iterations.map((i) => i.negativePrompt)).toEqual(["NEG-1", "NEG-2", "NEG-3", "NEG-4"])
    // The shorter prompt list wraps around; it arrives as the WIRED prompt.
    expect(a.iterations.map((i) => i.prompt)).toEqual(["PROMPT-1", "PROMPT-2", "PROMPT-1", "PROMPT-2"])
  })
})

describe("only an Each wire fans out — the same answer in both engines", () => {
  const rows = [["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["PROMPT-3", "NEG-3"]]

  it("a List wire set to Bundle hands over the whole list ONCE; it does not run the node per row", () => {
    const nodes = [table(rows), genImage()]
    const bundle = edge("e-p", "list1", "col_a", "gi1", "prompt", { outputMode: "all" })
    expect(getListFanOutForNode(nodes[1], [bundle], {}, nodes)).toBeUndefined()
  })

  it("a Bundle wire beside an Each wire: the Each wire alone sets the rows", () => {
    const nodes = [table(rows), genImage()]
    const bundle = edge("e-n", "list1", "col_b", "gi1", "negative", { outputMode: "all" })
    const fanOut = getListFanOutForNode(nodes[1], [bundle, PROMPT_EDGE], {}, nodes)
    expect(fanOut).toEqual({ items: ["PROMPT-1", "PROMPT-2", "PROMPT-3"], rowIndices: [0, 1, 2], targetHandle: "prompt" })
  })
})

describe("an empty cell stays empty in its own row", () => {
  it("a blank negative in row 2 gives image 2 NO negative — and image 3 still gets NEG-3", () => {
    const nodes = [table([["PROMPT-1", "NEG-1"], ["PROMPT-2", ""], ["PROMPT-3", "NEG-3"]]), genImage()]
    const { iterations } = runFanOut(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], nodes)
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", undefined], ["PROMPT-3", "NEG-3"]])
  })

  it("a column with NO values at all contributes nothing — it never borrows the first column's values", () => {
    const nodes = [table([["PROMPT-1", ""], ["PROMPT-2", ""], ["PROMPT-3", ""]]), genImage()]
    for (const order of [[PROMPT_EDGE, NEGATIVE_EDGE], [NEGATIVE_EDGE, PROMPT_EDGE]]) {
      const { iterations } = runFanOut(nodes[1], order, nodes)
      expect(pairs(iterations)).toEqual([["PROMPT-1", undefined], ["PROMPT-2", undefined], ["PROMPT-3", undefined]])
    }
  })

  it("…and the same in a SINGLE run (one row, no fan-out): a blank negative cell is not the prompt", () => {
    const nodes = [table([["PROMPT-1", ""]]), genImage()]
    expect(getListFanOutForNode(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], {}, nodes)).toBeUndefined()
    // The orchestrator seeds a List source with its first cell.
    const states: States = { list1: { status: "completed", output: { text: "PROMPT-1" } } }
    const inputs = resolveNodeInputs(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], states, nodes) as unknown as Record<string, unknown>
    expect(inputs.prompt).toBe("PROMPT-1")
    expect(inputs.negativePrompt).toBeUndefined()
  })

  it("a fully blank row (the editor's trailing empty row) is not a row", () => {
    const nodes = [table([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"], ["", ""]]), genImage()]
    const { iterations } = runFanOut(nodes[1], [PROMPT_EDGE, NEGATIVE_EDGE], nodes)
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", "NEG-2"]])
  })

  it("a row with a negative but NO prompt still runs — the typed prompt stands for it — in either wire order", () => {
    const target = genImage({ prompt: "a red bicycle" })
    const nodes = [table([["PROMPT-1", "NEG-1"], ["", "NEG-2"], ["PROMPT-3", "NEG-3"]]), target]
    for (const order of [[PROMPT_EDGE, NEGATIVE_EDGE], [NEGATIVE_EDGE, PROMPT_EDGE]]) {
      const { fanOut, iterations } = runFanOut(target, order, nodes)
      expect(fanOut?.rowIndices).toEqual([0, 1, 2])
      expect(fanOut?.targetHandle).toBe("prompt")
      expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], [undefined, "NEG-2"], ["PROMPT-3", "NEG-3"]])
      // Nothing overrides row 2's prompt, so computeNodePrompt falls to the typed one.
      expect(iterations[1].overridePrompt).toBeUndefined()
    }
  })

  it("a single-column list is unchanged: blanks are skipped, the count does not grow", () => {
    const single = node("list1", "list", {
      columns: [{ id: "a", name: "Items", handleId: "col_a", type: "text" }],
      rows: [["one"], [""], ["two"], [""]],
    })
    const nodes = [single, genImage()]
    expect(getListInputForNode(nodes[1], [PROMPT_EDGE], {}, nodes)).toEqual(["one", "two"])
  })
})

describe("an empty entry of ANY list source contributes nothing — it never falls back to the node's whole text", () => {
  const prompts = node("list1", "list", {
    columns: [{ id: "a", name: "prompt", handleId: "col_a", type: "text" }],
    rows: [["PROMPT-1"], ["PROMPT-2"], ["PROMPT-3"]],
  })

  it("a list node that fans out by default (Filter List), with a hole in the middle", () => {
    const filter = node("fl", "filter-list", { label: "Filter" })
    const states: States = {
      fl: { status: "completed", output: { text: "NEG-1", listResults: ["NEG-1", "", "NEG-3"] } },
    }
    const target = genImage()
    const wires = [PROMPT_EDGE, edge("e-n", "fl", "out", "gi1", "negative")]
    const { iterations } = runFanOut(target, wires, [prompts, filter, target], states)
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", undefined], ["PROMPT-3", "NEG-3"]])
  })

  it("a SHORTER list starts over from its first row (same as a List column, same as the in-browser engine) — and its blank entry stays blank", () => {
    // Produced by the REAL executor, so the state carries everything a run does
    // (the scalar fallback reads `extractedText` — a hand-made state without it
    // would hide exactly the fallback this test is about).
    const scrape = node("s", "web-scrape", {})
    const extract = node("exN", "extract-field", { label: "negative", mode: "custom", field: "negative", outputType: "list" })
    const target = genImage()
    const all = [prompts, scrape, extract, target]
    const wires = [
      edge("e-s", "s", "json", "exN", "in"),
      PROMPT_EDGE,
      edge("e-n", "exN", "text", "gi1", "negative", { outputMode: "each" }),
    ]
    const states: States = { s: { status: "completed", output: { json: [{ negative: "NEG-1" }, { negative: "" }] } } }
    states.exN = { status: "completed", output: executeExtractField(extract, wires, all, states) }
    const { iterations } = runFanOut(target, wires, all, states)
    // rows 0,1,2 of the 3 prompts read rows 0,1,0 of the 2-row negative list.
    expect(pairs(iterations)).toEqual([["PROMPT-1", "NEG-1"], ["PROMPT-2", undefined], ["PROMPT-3", "NEG-1"]])
  })

  it("an upstream fan-out that lost an iteration: nothing runs for the missing result, and nothing re-uses another one", () => {
    // A fanned-out node fills "" for a failed iteration.
    const upstream = node("gen", "generate-image", { label: "Upstream" })
    const states: States = {
      gen: { status: "completed", output: { imageUrl: "https://cdn/u1.png", listResults: ["https://cdn/u1.png", "", "https://cdn/u3.png"] } },
    }
    const target = node("i2v", "image-to-video", { label: "I2V", prompt: "slow push in" })
    const wires = [edge("e-i", "gen", "image", "i2v", "image", { outputMode: "each" })]
    const fanOut = getListFanOutForNode(target, wires, states, [upstream, target])
    expect(fanOut).toEqual({ items: ["https://cdn/u1.png", "https://cdn/u3.png"], rowIndices: [0, 2], targetHandle: "image" })
    const plan = planFanOut(fanOut, target.type, target.data)!
    const urls = plan.items.map((_, k) =>
      (resolveFanOutIterationInputs(target, plan, k, wires, states, [upstream, target]) as unknown as Record<string, unknown>).imageUrl,
    )
    expect(urls).toEqual(["https://cdn/u1.png", "https://cdn/u3.png"])
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

describe("LLM JSON -> 2x Extract Field -> one Generate Image", () => {
  const concepts = [
    { concept_index: "1", prompt: "PROMPT-1, wide shot,\nsecond line", negative: "NEG-1" },
    { concept_index: "2", prompt: "PROMPT-2", negative: "" },
    { concept_index: "3", prompt: "PROMPT-3", negative: "NEG-3" },
    { concept_index: "4", prompt: "PROMPT-4" },
    { concept_index: "5", prompt: "PROMPT-5", negative: "NEG-5" },
  ]
  const llm = node("llm", "llm-chat", { label: "FOOH PROMPT NORMALIZER LLM" })
  const exP = node("exP", "extract-field", { label: "prompt", mode: "custom", field: "prompt", outputType: "list" })
  const exN = node("exN", "extract-field", { label: "negative", mode: "custom", field: "negative", outputType: "list" })
  const llmEdges = [edge("e1", "llm", "items", "exP", "in"), edge("e2", "llm", "items", "exN", "in")]

  function extracted(): States {
    const text = JSON.stringify(concepts)
    const states: States = { llm: { status: "completed", output: { text, items: [text] } } }
    const all = [llm, exP, exN]
    states.exP = { status: "completed", output: executeExtractField(exP, llmEdges, all, states) }
    states.exN = { status: "completed", output: executeExtractField(exN, llmEdges, all, states) }
    return states
  }

  const EXPECTED = [
    ["PROMPT-1, wide shot,\nsecond line", "NEG-1"],
    ["PROMPT-2", undefined],
    ["PROMPT-3", "NEG-3"],
    ["PROMPT-4", undefined],
    ["PROMPT-5", "NEG-5"],
  ]

  it("Extract Field (List) publishes a row-aligned twin — and leaves its public list exactly as it was", () => {
    const states = extracted()
    // One entry per object: a missing or empty value is an empty entry.
    expect(states.exN.output?.alignedListResults).toEqual(["NEG-1", "", "NEG-3", "", "NEG-5"])
    expect(states.exP.output?.alignedListResults).toHaveLength(5)
    // The PUBLIC list is untouched (a missing key is skipped, as always) — it is
    // what item / item:N / range / Bundle and every list node index.
    expect(states.exN.output?.listResults).toEqual(["NEG-1", "", "NEG-3", "NEG-5"])
    expect(states.exN.output?.text).toBe(states.exN.output?.listResults?.join(String.fromCharCode(10)))
  })

  it("addressing by position still indexes the values that exist: Item 'last' of a sparse field is its last VALUE", () => {
    const posts = [{ videoUrl: "https://cdn/x1.mp4" }, { videoUrl: "https://cdn/x2.mp4" }, {}]
    const scrape = node("s", "web-scrape", {})
    const exV = node("exV", "extract-field", { mode: "custom", field: "videoUrl", outputType: "list" })
    const target = node("v2v", "video-to-video", { prompt: "make it snow" })
    const wires = [
      edge("e1", "s", "json", "exV", "in"),
      edge("e2", "exV", "text", "v2v", "video", { outputMode: "item", itemIndex: "last" }),
    ]
    const all = [scrape, exV, target]
    const states: States = { s: { status: "completed", output: { json: posts } } }
    states.exV = { status: "completed", output: executeExtractField(exV, wires, all, states) }
    const inputs = resolveNodeInputs(target, wires, states, all) as unknown as Record<string, unknown>
    // Not "" (the hole), and not the whole newline-joined list the scalar fallback returns.
    expect(inputs.videoUrl).toBe("https://cdn/x2.mp4")
  })

  it("through a List with two connected columns: 5 images, each with ITS OWN negative", () => {
    const list = node("list1", "list", {
      columns: [
        { id: "a", name: "prompt", handleId: "col_a", type: "text", connectedSourceId: "exP", connectedSourceHandle: "text" },
        { id: "b", name: "negative", handleId: "col_b", type: "text", connectedSourceId: "exN", connectedSourceHandle: "text" },
      ],
      rows: [],
    })
    const target = genImage()
    const nodes = [llm, exP, exN, list, target]
    const wires = [
      ...llmEdges,
      edge("e3", "exP", "text", "list1", "col_a_in"),
      edge("e4", "exN", "text", "list1", "col_b_in"),
    ]
    for (const order of [[PROMPT_EDGE, NEGATIVE_EDGE], [NEGATIVE_EDGE, PROMPT_EDGE]]) {
      const { iterations } = runFanOut(target, [...wires, ...order], nodes, extracted())
      expect(pairs(iterations)).toEqual(EXPECTED)
    }
  })

  it("wired straight into Generate Image with both wires on Each: same pairing, no fallback to the joined text", () => {
    const target = genImage()
    const nodes = [llm, exP, exN, target]
    const direct = [
      edge("e6", "exN", "text", "gi1", "negative", { outputMode: "each" }),
      edge("e5", "exP", "text", "gi1", "prompt", { outputMode: "each" }),
    ]
    const { iterations } = runFanOut(target, [...llmEdges, ...direct], nodes, extracted())
    expect(pairs(iterations)).toEqual(EXPECTED)
  })

  it("the PROMPT list still drives when IT is the one with a hole (its row-aligned twin keeps it in the negatives' row space)", () => {
    const holed = [
      { prompt: "PROMPT-1", negative: "NEG-1" },
      { negative: "NEG-2" },
      { prompt: "PROMPT-3", negative: "NEG-3" },
    ]
    const text = JSON.stringify(holed)
    const states: States = { llm: { status: "completed", output: { text, items: [text] } } }
    const all = [llm, exP, exN]
    states.exP = { status: "completed", output: executeExtractField(exP, llmEdges, all, states) }
    states.exN = { status: "completed", output: executeExtractField(exN, llmEdges, all, states) }
    const target = genImage({ prompt: "typed fallback" })
    const direct = [
      edge("e6", "exN", "text", "gi1", "negative", { outputMode: "each" }),
      edge("e5", "exP", "text", "gi1", "prompt", { outputMode: "each" }),
    ]
    const { fanOut, iterations } = runFanOut(target, [...llmEdges, ...direct], [llm, exP, exN, target], states)
    // Read through its compact list the prompt list would have 2 rows, fall out of
    // the negatives' 3-row space, and the NEGATIVE list would drive the fan-out.
    expect(fanOut).toEqual({ items: ["PROMPT-1", "", "PROMPT-3"], rowIndices: [0, 1, 2], targetHandle: "prompt" })
    expect(iterations.map((i) => i.overridePrompt)).toEqual(["PROMPT-1", undefined, "PROMPT-3"])
    expect(iterations.map((i) => i.negativePrompt)).toEqual(["NEG-1", "NEG-2", "NEG-3"])
  })

  it("a sparse field used ALONE still fans out only over the values that exist", () => {
    const posts = [{ videoUrl: "https://cdn/x1.mp4" }, {}, { videoUrl: "https://cdn/x3.mp4" }]
    const scrape = node("s", "web-scrape", {})
    const exV = node("exV", "extract-field", { mode: "custom", field: "videoUrl", outputType: "list" })
    const target = node("v2v", "video-to-video", { prompt: "make it snow" })
    const wires = [edge("e1", "s", "json", "exV", "in"), edge("e2", "exV", "text", "v2v", "video", { outputMode: "each" })]
    const states: States = { s: { status: "completed", output: { json: posts } } }
    states.exV = { status: "completed", output: executeExtractField(exV, wires, [scrape, exV, target], states) }
    expect(getListInputForNode(target, wires, states, [scrape, exV, target])).toEqual([
      "https://cdn/x1.mp4",
      "https://cdn/x3.mp4",
    ])
  })
})
