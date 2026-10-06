import { describe, it, expect, vi } from "vitest"

// Mock @xyflow/react before importing the store (matches sibling tests)
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, { ...connection, id: connection.id ?? "edge_mock" }]),
}))

import { useWorkflowStore } from "../use-workflow-store"

/**
 * The burn-down table (`RENDERED_OUTPUT_HANDLES`, @nodaro/shared): a node whose
 * component still renders a pip its definition does not declare. A saved edge
 * on the DECLARED id would not draw (React Flow error 008), so the load pass
 * moves it onto the pip that draws — the same move the server makes when it
 * writes such an edge (`renderedSourceHandle`, one rule for both).
 */
describe("loadWorkflow — a declared-only source id on a burn-down node moves onto the pip that draws", () => {
  it("trim-video `video` → `video-out`, save-to-storage `asset` → `out`; a rendered pip and a node outside the table stay as saved", () => {
    const at = { x: 0, y: 0 }
    const nodes = [
      { id: "trim", type: "trim-video", position: at, data: { label: "Trim" } },
      { id: "merge", type: "merge-video-audio", position: at, data: { label: "Merge" } },
      { id: "store", type: "save-to-storage", position: at, data: { label: "Store" } },
      { id: "combine", type: "combine-text", position: at, data: { label: "Combine" } },
      { id: "gen", type: "generate-image", position: at, data: { label: "Gen" } },
    ] as never
    const edges = [
      { id: "a", source: "trim", sourceHandle: "video", target: "merge", targetHandle: "in" },
      { id: "b", source: "store", sourceHandle: "asset", target: "combine", targetHandle: "text" },
      { id: "c", source: "merge", sourceHandle: "video-out", target: "trim", targetHandle: "in" },
      { id: "d", source: "gen", sourceHandle: "image", target: "trim", targetHandle: "in" },
    ] as never
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, edges)
    const sourceHandles = Object.fromEntries(useWorkflowStore.getState().edges.map((e) => [e.id, e.sourceHandle]))
    expect(sourceHandles).toEqual({ a: "video-out", b: "out", c: "video-out", d: "image" })
  })

  it("a declared-only id with several rendered pips is left alone — never guessed", () => {
    const at = { x: 0, y: 0 }
    const nodes = [
      { id: "stems", type: "audio-separation", position: at, data: { label: "Stems" } },
      { id: "vc", type: "voice-changer", position: at, data: { label: "Voice" } },
    ] as never
    const edges = [{ id: "a", source: "stems", sourceHandle: "audio", target: "vc", targetHandle: "audio" }] as never
    useWorkflowStore.getState().loadWorkflow("w1", "test", nodes, edges)
    expect(useWorkflowStore.getState().edges.map((e) => e.sourceHandle)).toEqual(["audio"])
  })
})
