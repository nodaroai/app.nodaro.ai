/**
 * Deleting a layer must never delete the node: a generated layer becomes an
 * empty image slot again, a wired layer loses only its wire (the source node
 * stays), and the shown handle count shrinks back to what is still in use.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DEFAULT_OVERLAY_LAYER, type ImageOverlayData } from "@/types/nodes"
import { useImageOverlayLayers, generatedLayer } from "../use-image-overlay-layers"

function overlayData(): ImageOverlayData {
  return useWorkflowStore.getState().nodes.find((n) => n.id === "ov")!.data as ImageOverlayData
}

describe("useImageOverlayLayers.removeLayer", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      isReadOnly: false,
      nodes: [
        { id: "ov", type: "image-overlay", position: { x: 0, y: 0 }, data: { layers: [DEFAULT_OVERLAY_LAYER, DEFAULT_OVERLAY_LAYER, DEFAULT_OVERLAY_LAYER, DEFAULT_OVERLAY_LAYER, DEFAULT_OVERLAY_LAYER, generatedLayer("text")], layerCount: 6 } },
        { id: "logo", type: "upload-image", position: { x: 0, y: 0 }, data: { imageUrl: "https://x/logo.png" } },
      ],
      edges: [
        { id: "e-base", source: "logo", target: "ov", sourceHandle: "image", targetHandle: "image" },
        { id: "e-l2", source: "logo", target: "ov", sourceHandle: "image", targetHandle: "overlay2" },
      ],
    } as never)
  })

  it("turns a generated layer back into an empty slot and shrinks the shown handles", () => {
    const { result } = renderHook(() => useImageOverlayLayers("ov", 6))
    act(() => result.current.removeLayer(5))
    const d = overlayData()
    expect(d.layers.length).toBeLessThanOrEqual(5)
    expect(d.layers[5]).toBeUndefined()
    expect(d.layerCount).toBe(4)
    expect(useWorkflowStore.getState().nodes).toHaveLength(2)
  })

  it("unwires a wired layer but keeps the source node and the base wire", () => {
    const { result } = renderHook(() => useImageOverlayLayers("ov", 6))
    act(() => result.current.removeLayer(1))
    const edges = useWorkflowStore.getState().edges
    expect(edges.map((e) => e.id)).toEqual(["e-base"])
    expect(useWorkflowStore.getState().nodes.map((n) => n.id)).toEqual(["ov", "logo"])
    // The text layer in slot 6 is still there, so six handles stay shown.
    expect(overlayData().layerCount).toBe(6)
  })
})
