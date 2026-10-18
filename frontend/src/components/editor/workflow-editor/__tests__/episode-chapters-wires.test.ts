/**
 * What a saved Chapters node hands on, on the editor's own engine — the mirror
 * of the server's saved and live reads (output-extractor.ts): its show notes on
 * `text` (and on an edge that names no pip), its chapter list on `json`, and
 * never an episode.
 */
import { describe, expect, it } from "vitest"
import { detectPreviewItemType, extractNodeOutput } from "../execution-graph"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const NOTES = "0:00 Intro\n12:34 Main"
const ROWS = [{ startMs: 0, title: "Intro" }, { startMs: 754_000, title: "Main" }]

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, fieldMappings: {}, ...data } } as unknown as WorkflowNode
}

const chapters = node("CH", "episode-chapters", { executionStatus: "completed", generatedText: NOTES, generatedJson: ROWS })

describe("a saved Chapters node's pips", () => {
  it("text: the show notes; json: the chapter list as it holds it", () => {
    expect(extractNodeOutput(chapters, "text")).toBe(NOTES)
    expect(extractNodeOutput(chapters, "json")).toBe(JSON.stringify(ROWS))
  })

  it("an edge naming no pip reads the show notes", () => {
    expect(extractNodeOutput(chapters)).toBe(NOTES)
  })

  it("nothing held, nothing handed on", () => {
    const empty = node("E", "episode-chapters")
    expect(extractNodeOutput(empty, "text")).toBeUndefined()
    expect(extractNodeOutput(empty, "json")).toBeUndefined()
  })

  it("previews as text and data", () => {
    expect(detectPreviewItemType("episode-chapters", NOTES, "text")).toBe("text")
    expect(detectPreviewItemType("episode-chapters", JSON.stringify(ROWS), "json")).toBe("data")
  })
})

describe("its wires on a run", () => {
  it("text into an LLM's prompt: the show notes, never routed as media", () => {
    const llm = node("LLM", "llm-chat", { userInput: "", systemPrompt: "" })
    const edge = { id: "e", source: "CH", target: "LLM", sourceHandle: "text", targetHandle: "prompt" } as unknown as WorkflowEdge
    const inputs = resolveNodeInputs(llm, [chapters, llm], [edge])
    expect(inputs.prompt).toContain(NOTES)
    expect(inputs.videoUrl).toBeUndefined()
    expect(inputs.audioUrl).toBeUndefined()
  })

  it("an unnamed pip into an LLM's prompt: the show notes too", () => {
    const llm = node("LLM", "llm-chat", { userInput: "", systemPrompt: "" })
    const edge = { id: "e", source: "CH", target: "LLM", targetHandle: "prompt" } as unknown as WorkflowEdge
    expect(resolveNodeInputs(llm, [chapters, llm], [edge]).prompt).toContain(NOTES)
  })
})
