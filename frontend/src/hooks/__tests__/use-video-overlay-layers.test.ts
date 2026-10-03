import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import {
  DEFAULT_VIDEO_OVERLAY_LAYER,
  applyVideoOverlayPreset,
  normalizeVideoOverlayNodes,
  videoOverlayCompositionKey,
  videoOverlaySlotSources,
  type VideoOverlayLayerInput,
} from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { VideoOverlayData } from "@/types/nodes"
import { patchVideoOverlayLayer, reorderVideoOverlayLayers, useVideoOverlayLayers, writeVideoOverlaySlot } from "../use-video-overlay-layers"

describe("pure helpers", () => {
  it("writeVideoOverlaySlot fills holes with null and never shifts a later slot", () => {
    expect(writeVideoOverlaySlot([{ start: 0 }], 2, { start: 3 })).toEqual([{ start: 0 }, null, { start: 3 }])
    expect(writeVideoOverlaySlot([{ start: 0 }, { start: 1 }], 0, null)).toEqual([null, { start: 1 }])
  })

  it("patchVideoOverlayLayer: an untouched slot starts from the default badge; a timing edit keeps a preset tag", () => {
    expect(patchVideoOverlayLayer(null, { start: 2 })).toEqual({ ...DEFAULT_VIDEO_OVERLAY_LAYER, start: 2 })
    const card = patchVideoOverlayLayer({ preset: "card", start: 0 }, { end: 3 })
    expect(card).toMatchObject({ preset: "card", end: 3, anchor: "center", width: 78 })
  })

  it("patchVideoOverlayLayer: a box edit that leaves the preset's box turns the layer Custom (silently)", () => {
    const moved = patchVideoOverlayLayer({ preset: "card", start: 0 }, { x: 5 })
    expect(moved.preset).toBeUndefined()
    expect(moved).toMatchObject({ anchor: "center", x: 5, width: 78, height: 60 })
  })

  it("reorderVideoOverlayLayers moves one step and re-stamps zIndex; the ends are no-ops", () => {
    const next = reorderVideoOverlayLayers([{ start: 0 }, { start: 1 }], 2, 0, "up")!
    expect(next.map((l) => l?.zIndex)).toEqual([1, 0])
    expect(reorderVideoOverlayLayers([{ start: 0 }, { start: 1 }], 2, 1, "up")).toBeNull()
    expect(reorderVideoOverlayLayers([{ start: 0 }, { start: 1 }], 2, 0, "down")).toBeNull()
  })

  it("reorderVideoOverlayLayers leaves an empty, unwired slot null — no default layer, no zIndex (Review Focus 1)", () => {
    const next = reorderVideoOverlayLayers([{ start: 0 }, { start: 1 }, null, null], 4, 0, "up")!
    expect(next[2]).toBeNull()
    expect(next[3]).toBeNull()
    expect(next.map((l) => l?.zIndex)).toEqual([1, 0, undefined, undefined])
  })

  it("reorderVideoOverlayLayers makes a WIRED empty slot (drawn as the default badge) a real layer with its new zIndex", () => {
    const next = reorderVideoOverlayLayers([null, { start: 1 }], 2, 1, "down", new Set([0]))!
    expect(next[0]).toEqual({ ...DEFAULT_VIDEO_OVERLAY_LAYER, zIndex: 1 })
    expect(next[1]).toMatchObject({ start: 1, zIndex: 0 })
  })
})

function data(): VideoOverlayData {
  return useWorkflowStore.getState().nodes.find((n) => n.id === "vo")!.data as VideoOverlayData
}

describe("useVideoOverlayLayers", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      isReadOnly: false,
      nodes: [
        { id: "vo", type: "video-overlay", position: { x: 0, y: 0 }, data: { label: "Video Overlay", layers: [null, { start: 1 }, null, null, { imageUrl: "https://x/5.png", start: 4 }], layerCount: 6, fieldMappings: {} } },
        { id: "img", type: "upload-image", position: { x: 0, y: 0 }, data: { url: "https://x/img.png" } },
      ],
      edges: [
        { id: "e-base", source: "img", target: "vo", sourceHandle: "image", targetHandle: "video" },
        { id: "e-l1", source: "img", target: "vo", sourceHandle: "image", targetHandle: "overlay" },
      ],
    } as never)
  })

  it("applyPreset replaces the box and sets the tag (corner badge in a chosen corner)", () => {
    const { result } = renderHook(() => useVideoOverlayLayers("vo"))
    act(() => result.current.applyPreset(1, "corner-badge", "top-left"))
    expect(data().layers[1]).toMatchObject({ start: 1, preset: "corner-badge", corner: "top-left", anchor: "top-left", x: 4, y: 4, width: 18 })
  })

  it("setCustom clears the tag and keeps the box", () => {
    const { result } = renderHook(() => useVideoOverlayLayers("vo"))
    act(() => result.current.applyPreset(1, "card"))
    act(() => result.current.setCustom(1))
    expect(data().layers[1]).toMatchObject({ anchor: "center", width: 78, height: 60 })
    expect(data().layers[1]?.preset).toBeUndefined()
  })

  it("removeLayer unwires the handle, empties the slot, trims the tail and shrinks the handles", () => {
    const { result } = renderHook(() => useVideoOverlayLayers("vo"))
    act(() => result.current.removeLayer(4))
    expect(data().layers).toEqual([null, { start: 1 }])
    expect(data().layerCount).toBe(4)
    act(() => result.current.removeLayer(0))
    expect(useWorkflowStore.getState().edges.map((e) => e.id)).toEqual(["e-base"])
    expect(useWorkflowStore.getState().nodes).toHaveLength(2)
  })
})

// The canvas stamps its key over the layers it wrote (expanded by the canvas
// writers, undefined fields and all); a backend run reads the same node after
// the save's normaliser (routes/workflows.ts → normalizeVideoOverlayNodes) and
// a jsonb round-trip. Both must give one key, or a run of the current settings
// would read "Result (old)".
describe("composition key parity — canvas-written layers vs the saved, normalised node", () => {
  it("the key over the canvas layers equals the key over JSON.parse(JSON.stringify(normalizeVideoOverlayNodes([node], edges)[0].data))", () => {
    const base = "https://x/base.mp4"
    const wiredUrl = "https://x/wired.png"
    let layers: Array<VideoOverlayLayerInput | null> = []
    // Slot 1 is wired (the canvas cleared its imageUrl on connect): a preset card, then a timing edit.
    layers = writeVideoOverlaySlot(layers, 0, applyVideoOverlayPreset(layers[0], "card"))
    layers = writeVideoOverlaySlot(layers, 0, patchVideoOverlayLayer(layers[0], { start: 1.25, end: 4 }))
    // Slot 3 is unwired and draws its own URL; dragged, so it turned Custom (preset: undefined).
    layers = writeVideoOverlaySlot(layers, 2, patchVideoOverlayLayer({ imageUrl: "https://x/own.png", preset: "corner-badge", corner: "top-left" }, { x: 12 }))
    // Slot 4: an end cleared back to "to the end" (end: undefined).
    layers = writeVideoOverlaySlot(layers, 3, patchVideoOverlayLayer({ imageUrl: "https://x/four.png", start: 2, end: 6 }, { end: undefined }))
    const data = { label: "Video Overlay", layers, outputAspect: "9:16", baseFit: "contain", backgroundColor: "#101010" }
    const node = { id: "vo", type: "video-overlay", data }
    const edges = [{ id: "e1", source: "img", target: "vo", targetHandle: "overlay" }]

    const canvasKey = videoOverlayCompositionKey({ baseUrl: base, sources: videoOverlaySlotSources(layers, [wiredUrl]), data })
    const saved = JSON.parse(JSON.stringify(normalizeVideoOverlayNodes([node], edges)[0]!.data)) as typeof data
    const savedKey = videoOverlayCompositionKey({ baseUrl: base, sources: videoOverlaySlotSources(saved.layers, [wiredUrl]), data: saved })
    expect(savedKey).toBe(canvasKey)
  })
})

