/**
 * Extract Field and JSON Process hold their list themselves (`__listResults`,
 * or Extract Field's JSON value) — a run of either writes no history into
 * `generatedResults` (decided 2026-10-05). Earlier builds' server runs did
 * write one: the run's text, and every link of a list of links. A node saved
 * with such a history reads its own list again, without being run: every
 * reader leaves the history out for these two, and the settings panel never
 * shows it as iterations.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))
vi.mock("@/lib/prompt-builder", () => ({ buildScenePrompt: vi.fn(() => "") }))

import { extractNodeOutputAsList, getListInputForNode, resolveNodeInputs } from "../node-input-resolver"
import { JSON_RUN_RESULT_TYPES, jsonRunResultPatch } from "@/lib/json-run-result"
import { ownsItsList } from "@nodaro/shared"
import { iterationResultsShown } from "@/lib/iteration-results"
import serverOutputs from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/json-producer-run-outputs.json"
import staleHistory from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/json-producer-stale-history.json"

type Data = Record<string, unknown>
const SERVER = serverOutputs as Record<string, Data>

const node = (id: string, type: string, data: Data = {}): any => ({ id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } })

/** What an earlier build's server runs left: two runs' text, and a list of
 *  links. The backend twin (`json-producer-own-list.test.ts`) reads the same. */
const STALE_HISTORY = staleHistory

describe("the history a run never writes is never read", () => {
  it("Extract Field (List) hands on its own list", () => {
    const ef = node("ef", "extract-field", { outputType: "list", extractedText: "Page A\nPage B", __listResults: ["Page A", "Page B"], generatedResults: STALE_HISTORY })
    expect(extractNodeOutputAsList(ef)).toEqual(["Page A", "Page B"])
  })

  it("Extract Field (Text) hands on no list", () => {
    const ef = node("ef", "extract-field", { outputType: "text", extractedText: "Page A\nPage B", generatedResults: STALE_HISTORY })
    expect(extractNodeOutputAsList(ef)).toBeUndefined()
  })

  it("Extract Field (JSON) hands on its value", () => {
    const ef = node("ef", "extract-field", { outputType: "json", extractedText: "x", generatedJson: [{ lang: "en" }, { lang: "fr" }], generatedResults: STALE_HISTORY })
    expect(extractNodeOutputAsList(ef)).toEqual(['{"lang":"en"}', '{"lang":"fr"}'])
  })

  it("JSON Process hands on one item per element", () => {
    const jp = node("jp", "json-process", { processedResult: [{ t: 1 }, { t: 2 }], __listResults: ['{"t":1}', '{"t":2}'], generatedResults: STALE_HISTORY })
    expect(extractNodeOutputAsList(jp)).toEqual(['{"t":1}', '{"t":2}'])
  })

  it("the next node runs once per item of the node's own list", () => {
    const jp = node("jp", "json-process", { processedResult: [{ t: 1 }, { t: 2 }], __listResults: ['{"t":1}', '{"t":2}'], generatedResults: STALE_HISTORY })
    const target = node("t", "llm-chat")
    const edges = [{ id: "e", source: "jp", target: "t", sourceHandle: "out", targetHandle: "prompt", data: { outputMode: "each" } }] as any
    expect(getListInputForNode(target, [jp, target], edges)).toEqual(['{"t":1}', '{"t":2}'])
  })

  it("an item pick on Extract Field (Text) reads the current text, not an old run", () => {
    const ef = node("ef", "extract-field", { outputType: "text", extractedText: "Page A", generatedResults: STALE_HISTORY })
    const target = node("t", "llm-chat")
    const edges = [{ id: "e", source: "ef", target: "t", sourceHandle: "text", targetHandle: "prompt", data: { outputMode: "item", itemIndex: "1" } }] as any
    expect(resolveNodeInputs(target, [ef, target], edges).prompt).toBe("Page A")
  })

  it("other nodes still read their results (Generate Text's takes)", () => {
    const llm = node("l", "llm-chat", { generatedText: "b", generatedResults: [{ text: "b" }, { text: "a" }] })
    expect(extractNodeOutputAsList(llm)).toEqual(["b", "a"])
  })
})

describe("the settings panel's per-item results", () => {
  it("never list Extract Field's or JSON Process's own list as iterations", () => {
    for (const type of ["extract-field", "json-process"]) {
      expect(iterationResultsShown(type, { __listResults: ["Page A", "Page B"], generatedResults: STALE_HISTORY }), type).toBe(false)
    }
  })

  it("still show a node that ran once per item", () => {
    expect(iterationResultsShown("generate-image", { __listResults: ["https://a.png", "https://b.png"], generatedResults: [{ url: "https://a.png" }] })).toBe(true)
    expect(iterationResultsShown("generate-image", { __listResults: ["https://a.png"], generatedResults: [{ url: "https://a.png" }] })).toBe(false)
    expect(iterationResultsShown("generate-image", { __listResults: ["https://a.png", "https://b.png"], generatedResults: [] })).toBe(false)
  })
})

describe("which json producers hold their own list", () => {
  it.each([...JSON_RUN_RESULT_TYPES])("%s: exactly the types whose result mapping writes the list", (type) => {
    const cases = Object.keys(SERVER).filter((k) => k.split(":")[0] === type)
    expect(cases.length, `pin a server output for ${type}`).toBeGreaterThan(0)
    const writesList = cases.some((k) => "__listResults" in (jsonRunResultPatch(type, SERVER[k]) ?? {}))
    expect(ownsItsList(type)).toBe(writesList)
  })
})
