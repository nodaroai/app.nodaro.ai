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

describe("onConnect → a wire that changes a layer's kind", () => {
  const layersOf = () => (useWorkflowStore.getState().nodes.find((n) => n.id === "vo")!.data as { layers: unknown[] }).layers
  beforeEach(() => {
    useWorkflowStore.setState((s) => ({
      nodes: [
        ...s.nodes,
        { id: "gv", type: "generate-video", position: { x: 0, y: 0 }, data: { label: "Clip", generatedVideoUrl: "https://x/clip" } },
        { id: "ts", type: "teleport-send", position: { x: 0, y: 0 }, data: { label: "Send" } },
        { id: "tr", type: "teleport-receive", position: { x: 0, y: 0 }, data: { label: "Receive" } },
      ],
    }) as never)
  })

  it("a video wired over a stored image drops the image and the image's fade setting", () => {
    useWorkflowStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === "vo" ? { ...n, data: { ...n.data, layers: [null, { imageUrl: "https://x/keep.png", start: 2, animate: true }] } } : n)),
    }) as never)
    useWorkflowStore.getState().onConnect({ source: "gv", target: "vo", sourceHandle: "video", targetHandle: "overlay2" })
    expect(layersOf()[1]).toEqual({ start: 2 })
  })

  it("an image wired where a video was wired drops the video's sound and fade", () => {
    useWorkflowStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === "vo" ? { ...n, data: { ...n.data, layers: [{ start: 1, animate: false, sound: { volume: 0.5 } }] } } : n)),
      edges: [{ id: "e-old", source: "gv", target: "vo", sourceHandle: "video", targetHandle: "overlay" }],
    }) as never)
    useWorkflowStore.getState().onConnect({ source: "img", target: "vo", sourceHandle: "image", targetHandle: "overlay" })
    expect(layersOf()[0]).toEqual({ start: 1 })
  })

  it("a video wired through a teleport pair where a video was keeps the layer's sound and fade", () => {
    useWorkflowStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === "vo" ? { ...n, data: { ...n.data, layers: [{ start: 1, animate: true, sound: { volume: 0.5 } }] } } : n)),
      edges: [
        { id: "e-old", source: "gv", target: "vo", sourceHandle: "video", targetHandle: "overlay" },
        { id: "e-in", source: "gv", target: "ts", sourceHandle: "video", targetHandle: "in" },
        { id: "e-pair", source: "ts", target: "tr", sourceHandle: "out", targetHandle: "in" },
      ],
    }) as never)
    useWorkflowStore.getState().onConnect({ source: "tr", target: "vo", sourceHandle: "out", targetHandle: "overlay" })
    expect(layersOf()[0]).toEqual({ start: 1, animate: true, sound: { volume: 0.5 } })
  })
})
