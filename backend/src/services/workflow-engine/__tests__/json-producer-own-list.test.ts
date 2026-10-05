/**
 * Extract Field and JSON Process hold their list themselves (`__listResults`,
 * or Extract Field's JSON value) — a run of either writes no history into
 * `generatedResults` (decided 2026-10-05). Earlier builds' server runs did
 * write one. On a server run that reads such a node's SAVED data (outside a
 * Run from here, a Skip, or no state yet) the engine reads the same list the
 * editor does: its own, never the history — the backend twin of the editor's
 * `json-run-result-stale-history.test.ts`, on the same fixtures.
 */
import { describe, expect, it } from "vitest"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { seededFromSavedData, savedListFor } from "../saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"
import STALE_HISTORY from "./fixtures/json-producer-stale-history.json"

type Data = Record<string, unknown>

const node = (id: string, type: string, data: Data = {}): SimpleNode => ({ id, type, data: { label: type, ...data } })
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string, data?: Data): SimpleEdge =>
  ({ id: `e-${source}-${target}`, source, target, sourceHandle, targetHandle, data })

/** How a run meets a node it does not execute: seeded from its saved data
 *  (outside a Run from here / Skip), or with no state at all. The third value
 *  is what an item pick of Extract Field's text reads: a stateless node gives
 *  no single value (the engine reads saved scalars only through a seed). */
const LANES: ReadonlyArray<readonly [string, (n: SimpleNode) => Record<string, NodeExecutionState>, string | undefined]> = [
  ["seeded from saved data", (n) => ({ [n.id]: seededFromSavedData(extractSavedNodeOutput(n)) }), "Page A"],
  ["with no state", () => ({}), undefined],
]

/** What the editor's result mapping leaves on each node (json-run-result.ts). */
const EF_LIST: Data = { outputType: "list", extractedText: "Page A\nPage B", __listResults: ["Page A", "Page B"], __alignedListResults: ["Page A", "Page B"] }
const EF_URL_LIST: Data = {
  outputType: "list",
  extractedText: "https://site.example.test/a\nhttps://site.example.test/b",
  __listResults: ["https://site.example.test/a", "https://site.example.test/b"],
  __alignedListResults: ["https://site.example.test/a", "https://site.example.test/b"],
}
const EF_TEXT: Data = { outputType: "text", extractedText: "Page A" }
const EF_JSON: Data = { outputType: "json", extractedText: "x", generatedJson: [{ lang: "en" }, { lang: "fr" }] }
const JP: Data = { processedResult: [{ t: 1 }, { t: 2 }], __listResults: ['{"t":1}', '{"t":2}'] }

const withHistory = (data: Data): Data => ({ ...data, generatedResults: STALE_HISTORY })

function fanOutItems(type: string, data: Data, sourceHandle: string, states: (n: SimpleNode) => Record<string, NodeExecutionState>) {
  const src = node("src", type, data)
  const target = node("t", "llm-chat")
  const edges = [edge("src", "t", sourceHandle, "prompt", { outputMode: "each" })]
  return getListFanOutForNode(target, edges, states(src), [src, target])?.items
}

describe.each(LANES)("a json producer met %s", (_lane, states, pickedText) => {
  describe.each([["clean", (d: Data) => d], ["holding an old history", withHistory]] as const)("%s", (_shape, shape) => {
    it("Extract Field (List) fans the next node out once per item of its own list", () => {
      expect(fanOutItems("extract-field", shape(EF_LIST), "text", states)).toEqual(["Page A", "Page B"])
    })

    it("Extract Field (List of URLs) fans the next node out once per link", () => {
      expect(fanOutItems("extract-field", shape(EF_URL_LIST), "text", states)).toEqual(["https://site.example.test/a", "https://site.example.test/b"])
    })

    it("Extract Field (JSON) fans out once per element of its value", () => {
      expect(fanOutItems("extract-field", shape(EF_JSON), "json", states)).toEqual(['{"lang":"en"}', '{"lang":"fr"}'])
    })

    it("Extract Field (Text) fans nothing out", () => {
      expect(fanOutItems("extract-field", shape(EF_TEXT), "text", states)).toBeUndefined()
    })

    it("JSON Process fans out once per element", () => {
      expect(fanOutItems("json-process", shape(JP), "out", states)).toEqual(['{"t":1}', '{"t":2}'])
    })

    it("an item pick on Extract Field (Text) reads the current text, not an old run", () => {
      const ef = node("src", "extract-field", shape(EF_TEXT))
      const target = node("t", "llm-chat")
      const edges = [edge("src", "t", "text", "prompt", { outputMode: "item", itemIndex: "1" })]
      expect(resolveNodeInputs(target, edges, states(ef), [ef, target]).prompt).toBe(pickedText)
    })

    it("a List column fed by Extract Field reads its own list", () => {
      const ef = node("src", "extract-field", shape(EF_LIST))
      const list = node("L", "list", { columns: [{ id: "c1", handleId: "col-1", type: "text" }], rows: [] })
      const target = node("t", "llm-chat")
      const edges = [
        edge("src", "L", "text", "col-1_in"),
        edge("L", "t", "col-1", "prompt", { outputMode: "each" }),
      ]
      expect(getListFanOutForNode(target, edges, states(ef), [ef, list, target])?.items).toEqual(["Page A", "Page B"])
    })
  })
})

describe("the saved list of these two", () => {
  it("is their own list or none — never the history", () => {
    expect(savedListFor(node("a", "extract-field", withHistory(EF_LIST)), undefined)).toEqual(["Page A", "Page B"])
    expect(savedListFor(node("a", "extract-field", withHistory(EF_TEXT)), undefined)).toBeUndefined()
    expect(savedListFor(node("a", "extract-field", withHistory(EF_JSON)), undefined)).toEqual(['{"lang":"en"}', '{"lang":"fr"}'])
    expect(savedListFor(node("a", "json-process", withHistory(JP)), undefined)).toEqual(['{"t":1}', '{"t":2}'])
  })

  it("other nodes still read their results (Generate Text's takes)", () => {
    expect(savedListFor(node("a", "llm-chat", { generatedText: "b", generatedResults: [{ text: "b" }, { text: "a" }] }), undefined)).toEqual(["b", "a"])
  })
})
