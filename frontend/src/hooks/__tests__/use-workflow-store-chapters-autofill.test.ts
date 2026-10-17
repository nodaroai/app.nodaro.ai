/**
 * Wiring Chapters' show notes into a prompt offers the `{Chapters}` auto-fill
 * (the store's onConnect), as every text source does — and the label it
 * writes resolves to the show notes (an unnamed read of Chapters is its text).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))

import { useWorkflowStore } from "../use-workflow-store"
import { TEXT_PRODUCING_SOURCE_TYPES } from "@/lib/main-text-handle"

beforeEach(() => {
  useWorkflowStore.setState({
    isReadOnly: false,
    nodes: [
      { id: "ch", type: "episode-chapters", position: { x: 0, y: 0 }, data: { label: "Chapters", fieldMappings: {}, generatedText: "0:00 Intro" } },
      { id: "llm", type: "llm-chat", position: { x: 300, y: 0 }, data: { label: "Writer", userInput: "", systemPrompt: "", fieldMappings: {} } },
    ],
    edges: [],
  } as never)
})

describe("Chapters → a prompt", () => {
  it("is a text-producing source", () => {
    expect(TEXT_PRODUCING_SOURCE_TYPES.has("episode-chapters")).toBe(true)
  })

  it("its text wired into an empty prompt fills in {Chapters}", () => {
    useWorkflowStore.getState().onConnect({ source: "ch", target: "llm", sourceHandle: "text", targetHandle: "prompt" })
    const llm = useWorkflowStore.getState().nodes.find((n) => n.id === "llm")!
    expect((llm.data as { userInput: string }).userInput).toBe("{Chapters}")
  })
})
