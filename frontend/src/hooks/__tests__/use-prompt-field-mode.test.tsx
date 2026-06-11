import { describe, it, expect, beforeEach, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

// use-workflow-store imports @xyflow/react; mock the change-appliers it uses
// (mirror use-missing-prompt-refs.test). updateNodeData itself doesn't call
// these, but the store module pulls them in at import time.
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: (_c: unknown, n: unknown) => n,
  applyEdgeChanges: (_c: unknown, e: unknown) => e,
  addEdge: (c: Record<string, unknown>, e: unknown[]) => [...e, { ...c, id: "e1" }],
}))
vi.mock("@/components/editor/workflow-editor/execution-graph", () => ({
  extractNodeOutput: () => "",
}))
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  extractNodeOutputAsList: () => [],
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  usePromptFieldMode,
  isFieldFinal,
  toggleFinalView,
} from "../use-prompt-field-mode"

// --- Pure helpers (carry the logic coverage) -------------------------------

describe("isFieldFinal", () => {
  it("false when the list is absent (edit is the default)", () => {
    expect(isFieldFinal({}, "prompt")).toBe(false)
    expect(isFieldFinal({ __promptFinalView: undefined }, "prompt")).toBe(false)
  })

  it("false when the list is empty", () => {
    expect(isFieldFinal({ __promptFinalView: [] }, "prompt")).toBe(false)
  })

  it("true only for keys present in the list", () => {
    const data = { __promptFinalView: ["prompt"] }
    expect(isFieldFinal(data, "prompt")).toBe(true)
    expect(isFieldFinal(data, "negativePrompt")).toBe(false)
  })

  it("tolerates a non-array value (defensive — treats as edit)", () => {
    expect(isFieldFinal({ __promptFinalView: "prompt" as never }, "prompt")).toBe(false)
  })
})

describe("toggleFinalView", () => {
  it("adds the field when absent (from undefined)", () => {
    expect(toggleFinalView(undefined, "prompt")).toEqual(["prompt"])
  })

  it("adds the field when absent (from a non-empty list), no duplicates", () => {
    expect(toggleFinalView(["prompt"], "negativePrompt")).toEqual(["prompt", "negativePrompt"])
    // already present → toggling removes, never duplicates
    expect(toggleFinalView(["prompt"], "prompt")).toBeUndefined()
  })

  it("removes the field when present, returning undefined when the result is empty", () => {
    // sole entry removed → undefined (so the key is dropped from data, not left as [])
    expect(toggleFinalView(["prompt"], "prompt")).toBeUndefined()
  })

  it("removes one field but keeps the rest when more remain", () => {
    expect(toggleFinalView(["prompt", "negativePrompt"], "prompt")).toEqual(["negativePrompt"])
  })

  it("does not mutate its input", () => {
    const input = ["prompt"]
    toggleFinalView(input, "negativePrompt")
    expect(input).toEqual(["prompt"])
  })
})

// --- Store-backed hook ------------------------------------------------------

describe("usePromptFieldMode", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [
        { id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: { prompt: "hi" } },
      ],
      edges: [],
      isReadOnly: false,
    } as never)
  })

  const dataOf = (id: string) =>
    useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data as
      | Record<string, unknown>
      | undefined

  it("defaults to edit when the key is absent", () => {
    const { result } = renderHook(() => usePromptFieldMode("img", "prompt"))
    expect(result.current.mode).toBe("edit")
  })

  it("toggle flips one field to final and back, round-tripping through node data", () => {
    const { result } = renderHook(() => usePromptFieldMode("img", "prompt"))

    act(() => result.current.toggle())
    expect(result.current.mode).toBe("final")
    expect(dataOf("img")?.__promptFinalView).toEqual(["prompt"])

    // toggling back removes the field entirely (no empty array left behind)
    act(() => result.current.toggle())
    expect(result.current.mode).toBe("edit")
    expect(dataOf("img")?.__promptFinalView).toBeUndefined()
  })

  it("two fields are independent", () => {
    const prompt = renderHook(() => usePromptFieldMode("img", "prompt"))
    const negative = renderHook(() => usePromptFieldMode("img", "negativePrompt"))

    act(() => prompt.result.current.toggle())
    expect(prompt.result.current.mode).toBe("final")
    expect(negative.result.current.mode).toBe("edit")
    expect(dataOf("img")?.__promptFinalView).toEqual(["prompt"])

    act(() => negative.result.current.toggle())
    expect(prompt.result.current.mode).toBe("final")
    expect(negative.result.current.mode).toBe("final")
    expect(dataOf("img")?.__promptFinalView).toEqual(["prompt", "negativePrompt"])

    // turn prompt off again — negative stays final, no duplicate
    act(() => prompt.result.current.toggle())
    expect(prompt.result.current.mode).toBe("edit")
    expect(negative.result.current.mode).toBe("final")
    expect(dataOf("img")?.__promptFinalView).toEqual(["negativePrompt"])
  })

  it("survives a simulated store reload (state lives in node data)", () => {
    const first = renderHook(() => usePromptFieldMode("img", "prompt"))
    act(() => first.result.current.toggle())
    expect(dataOf("img")?.__promptFinalView).toEqual(["prompt"])

    // Simulate a workflow reload: rebuild the store from the persisted data.
    const persisted = dataOf("img")
    useWorkflowStore.setState({
      nodes: [{ id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: persisted }],
      edges: [],
      isReadOnly: false,
    } as never)

    const after = renderHook(() => usePromptFieldMode("img", "prompt"))
    expect(after.result.current.mode).toBe("final")
  })
})
