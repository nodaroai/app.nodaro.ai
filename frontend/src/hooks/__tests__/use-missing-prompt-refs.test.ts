import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook } from "@testing-library/react"

// use-workflow-store imports @xyflow/react; mock the change-appliers it uses.
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
import { useMissingPromptRefs } from "../use-missing-prompt-refs"

describe("useMissingPromptRefs", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [
        { id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: { prompt: "{Hero}" } },
      ],
      edges: [],
    } as never)
  })

  it("returns the missing refs for the node", () => {
    const { result } = renderHook(() => useMissingPromptRefs("img"))
    expect(result.current).toEqual([{ kind: "text", name: "Hero" }])
  })
})
