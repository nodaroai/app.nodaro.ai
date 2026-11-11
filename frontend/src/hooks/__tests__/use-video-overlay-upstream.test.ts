/**
 * What the Video Overlay node reads from its wires: the base, each layer's
 * source and — so the preview, the Run button and the composition key read a
 * wire as the run does — which layer slots are videos, by the shared
 * wired-kind rule. Its `wiredVideoSlots` must equal the canvas run's
 * `overlayVideoSlots` (node-input-resolver) for the same graph.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { readVideoOverlayUpstream, useVideoOverlayUpstream } from "../use-video-overlay-upstream"

const CLIP = "https://x/signed/clip?sig=1"
const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as unknown as WorkflowNode
const wire = (source: string, sourceHandle: string | null, target: string, targetHandle: string) =>
  ({ id: `${source}:${sourceHandle}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle }) as WorkflowEdge

function graph() {
  const nodes = [
    node("base", "upload-video", { url: "https://x/base.mp4" }),
    node("gv", "generate-video", { generatedVideoUrl: "https://x/render" }),
    node("img", "upload-image", { url: "https://x/still" }),
    node("list", "list", { columns: [{ id: "c", handleId: "c", name: "Clips", type: "video-url" }], rows: [[CLIP]] }),
    node("pics", "list", { columns: [{ id: "c", handleId: "c", name: "Cards", type: "video-url" }], rows: [["https://x/card.png"]] }),
    node("ts", "teleport-send"),
    node("tr", "teleport-receive"),
    node("vo", "video-overlay", { layers: [] }),
  ]
  const edges = [
    wire("base", "video", "vo", "video"),
    wire("img", "image", "vo", "overlay"),
    wire("list", "c", "vo", "overlay2"),
    wire("gv", "video", "ts", "in"),
    wire("ts", "out", "tr", "in"),
    wire("tr", "out", "vo", "overlay3"),
    wire("pics", "c", "vo", "overlay4"),
  ]
  return { nodes, edges }
}

beforeEach(() => {
  useWorkflowStore.setState({ isReadOnly: false, ...graph() } as never)
})

describe("useVideoOverlayUpstream — a wired layer's kind", () => {
  it("reads each layer's source and the video slots (1-based) by the shared rule, through a teleport pair", () => {
    const { result } = renderHook(() => useVideoOverlayUpstream("vo"))
    expect(result.current.base).toBe("https://x/base.mp4")
    expect(result.current.layers).toEqual(["https://x/still", CLIP, "https://x/render", "https://x/card.png"])
    expect([...result.current.wiredVideoSlots].sort()).toEqual([2, 3])
  })

  it("outside React (the layers writer reads it at write time) it reads what the hook reads", () => {
    const { nodes, edges } = graph()
    const { result } = renderHook(() => useVideoOverlayUpstream("vo"))
    expect(readVideoOverlayUpstream(nodes, edges, "vo")).toEqual(result.current)
    expect(readVideoOverlayUpstream(nodes, [], "vo")).toEqual({ layers: [], wiredVideoSlots: new Set(), connected: new Set() })
  })

  it("equals the canvas run's overlayVideoSlots for the same graph", () => {
    const { nodes, edges } = graph()
    const { result } = renderHook(() => useVideoOverlayUpstream("vo"))
    const inputs = resolveNodeInputs(nodes.find((n) => n.id === "vo")!, nodes, edges)
    expect([...result.current.wiredVideoSlots].sort((a, b) => a - b)).toEqual(inputs.overlayVideoSlots)
    expect(result.current.layers).toEqual(inputs.overlayImageUrls)
  })

  it("the last wire with a file decides a slot, its kind included; an image-only node has no video slot", () => {
    const { nodes } = graph()
    useWorkflowStore.setState({
      nodes: [...nodes, node("empty", "generate-video")],
      edges: [wire("gv", "video", "vo", "overlay"), wire("img", "image", "vo", "overlay"), wire("empty", "video", "vo", "overlay")],
    } as never)
    const { result } = renderHook(() => useVideoOverlayUpstream("vo"))
    expect(result.current.layers).toEqual(["https://x/still"])
    expect(result.current.wiredVideoSlots.size).toBe(0)
    expect(result.current.connected.has("overlay")).toBe(true)
  })

  it("re-reads when only a wire's kind changes (a List column's type, same link)", () => {
    const { result, rerender } = renderHook(() => useVideoOverlayUpstream("vo"))
    expect(result.current.wiredVideoSlots.has(2)).toBe(true)
    useWorkflowStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === "list" ? { ...n, data: { ...n.data, columns: [{ id: "c", handleId: "c", name: "Clips", type: "image-url" }] } } : n)),
    }))
    rerender()
    expect(result.current.wiredVideoSlots.has(2)).toBe(false)
  })
})
