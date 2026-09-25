/**
 * D3 on the canvas: the store's onConnect — the interactive connection path — clears
 * the wired slot's own imageUrl, whether or not the node's panel is open.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))

import { useWorkflowStore } from "../use-workflow-store"

beforeEach(() => {
  useWorkflowStore.setState({
    isReadOnly: false,
    nodes: [
      { id: "img", type: "upload-image", position: { x: 0, y: 0 }, data: { label: "Card", url: "https://x/card.png" } },
      {
        id: "vo",
        type: "video-overlay",
        position: { x: 300, y: 0 },
        data: { label: "Video Overlay", layers: [{ imageUrl: "https://x/old.png", start: 1, preset: "card" }, { imageUrl: "https://x/keep.png", start: 2 }], fieldMappings: {} },
      },
    ],
    edges: [],
  } as never)
})

describe("onConnect → video-overlay layer handle", () => {
  it("clears the wired slot's imageUrl and keeps its settings and the other slots", () => {
    useWorkflowStore.getState().onConnect({ source: "img", target: "vo", sourceHandle: "image", targetHandle: "overlay" })
    const state = useWorkflowStore.getState()
    expect(state.edges).toHaveLength(1)
    const layers = (state.nodes.find((n) => n.id === "vo")!.data as { layers: unknown[] }).layers
    expect(layers).toEqual([{ start: 1, preset: "card" }, { imageUrl: "https://x/keep.png", start: 2 }])
  })

  it("leaves the node untouched for the base handle", () => {
    const before = useWorkflowStore.getState().nodes.find((n) => n.id === "vo")!.data
    useWorkflowStore.getState().onConnect({ source: "img", target: "vo", sourceHandle: "image", targetHandle: "video" })
    expect(useWorkflowStore.getState().nodes.find((n) => n.id === "vo")!.data).toBe(before)
  })
})
