import { describe, it, expect, beforeEach, vi } from "vitest"
import { toast } from "sonner"
import { renderHook, act } from "@testing-library/react"
import {
  DEFAULT_VIDEO_OVERLAY_LAYER,
  applyVideoOverlayPreset,
  expandVideoOverlayLayer,
  normalizeVideoOverlayNodes,
  videoOverlayCompositionKey,
  videoOverlaySlotSources,
  type VideoOverlayLayerInput,
} from "@nodaro/shared/video"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useVideoOverlayAspectStore } from "@/hooks/use-video-overlay-aspects"
import { readVideoOverlayUpstream } from "@/hooks/use-video-overlay-upstream"
import { resolveVideoOverlayView, videoOverlayViewMedia } from "@/lib/video-overlay-view"
import { validateVideoOverlayRequest } from "@nodaro/shared/video"
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

  it("reorderVideoOverlayLayers makes a WIRED empty slot (drawn as the default badge) a real layer with its new zIndex — its fade left to its wire's kind", () => {
    const next = reorderVideoOverlayLayers([null, { start: 1 }], 2, 1, "down", new Set([0]))!
    const { animate: _byKind, ...badge } = DEFAULT_VIDEO_OVERLAY_LAYER
    expect(next[0]).toEqual({ ...badge, zIndex: 1 })
    expect(next[1]).toMatchObject({ start: 1, zIndex: 0, animate: true })
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

  // Slot 1 is wired (e-l1): its kind is its wire's, read at the run, so a
  // panel edit never stores the fade default of one kind on it.
  it("an edit on a WIRED slot stores no fade it was not given; an explicit one is kept; an unwired slot is stored in full", () => {
    const { result } = renderHook(() => useVideoOverlayLayers("vo"))
    act(() => result.current.setLayer(0, { start: 2 }))
    expect(data().layers[0]).toMatchObject({ start: 2, preset: "corner-badge", anchor: "bottom-right", opacity: 1 })
    expect(data().layers[0]).not.toHaveProperty("animate")
    act(() => result.current.applyPreset(0, "card"))
    expect(data().layers[0]).toMatchObject({ preset: "card", start: 2 })
    expect(data().layers[0]).not.toHaveProperty("animate")
    act(() => result.current.setCustom(0))
    expect(data().layers[0]).not.toHaveProperty("animate")
    act(() => result.current.setLayer(0, { animate: false }))
    expect(data().layers[0]).toMatchObject({ animate: false })
    act(() => result.current.setLayer(0, { x: 3 }))
    expect(data().layers[0]).toMatchObject({ animate: false, x: 3 })
    act(() => result.current.setLayer(1, { start: 2 }))
    expect(data().layers[1]).toMatchObject({ start: 2, animate: true })
  })

  it("a wired layer the canvas wrote is what the save normaliser stores: one composition key", () => {
    useWorkflowStore.setState((st) => ({ nodes: st.nodes.map((n) => (n.id === "vo" ? { ...n, data: { ...n.data, layers: [] } } : n)) }) as never)
    const { result } = renderHook(() => useVideoOverlayLayers("vo"))
    act(() => result.current.setLayer(0, { start: 1.5 }))
    act(() => result.current.applyPreset(0, "card"))
    const d = data()
    const edges = useWorkflowStore.getState().edges
    const saved = JSON.parse(JSON.stringify(normalizeVideoOverlayNodes([{ id: "vo", type: "video-overlay", data: d }], edges)[0]!.data)) as VideoOverlayData
    expect(saved.layers).toEqual(d.layers)
    const wired = ["https://x/img.png"]
    const key = (v: VideoOverlayData) => videoOverlayCompositionKey({ baseUrl: "https://x/base.mp4", sources: videoOverlaySlotSources(v.layers, wired), data: v })
    expect(key(saved)).toBe(key(d))
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


/**
 * A box edit (a drag or resize on the stage, a box field or a preset on a
 * card) makes a layout Custom, and Custom keeps every box the layout placed:
 * only the edited layer moves. A timing or look edit keeps the layout.
 */
describe("useVideoOverlayLayers — layouts", () => {
  const BASE = "https://x/base.mp4"
  const CLIP = "https://x/clip.mp4"
  const CARD: VideoOverlayLayerInput = { imageUrl: "https://x/card.png", start: 0, anchor: "top", x: 0, y: 8, width: 80 }

  function setup(nodeData: Partial<VideoOverlayData>, wireClip = false) {
    useVideoOverlayAspectStore.setState({ aspects: { [BASE]: 16 / 9, [CLIP]: 16 / 9, "https://x/card.png": 2 } })
    useWorkflowStore.setState({
      isReadOnly: false,
      nodes: [
        { id: "vo", type: "video-overlay", position: { x: 0, y: 0 }, data: { label: "Video Overlay", fieldMappings: {}, layers: [], probedVideo: { url: BASE, durationSec: 10, width: 1920, height: 1080 }, ...nodeData } },
        { id: "base", type: "upload-video", position: { x: 0, y: 0 }, data: { url: BASE } },
        { id: "gv", type: "generate-video", position: { x: 0, y: 0 }, data: { generatedVideoUrl: CLIP } },
      ],
      edges: [
        { id: "e-base", source: "base", target: "vo", sourceHandle: "video", targetHandle: "video" },
        ...(wireClip ? [{ id: "e-clip", source: "gv", target: "vo", sourceHandle: "video", targetHandle: "overlay2" }] : []),
      ],
    } as never)
    return renderHook(() => useVideoOverlayLayers("vo")).result
  }
  function view() {
    const { nodes, edges } = useWorkflowStore.getState()
    const upstream = readVideoOverlayUpstream(nodes, edges, "vo")
    return resolveVideoOverlayView(data(), upstream, videoOverlayViewMedia(data().probedVideo, upstream.base, useVideoOverlayAspectStore.getState().aspects))
  }
  /** What the stage draws for the node as stored now. */
  function drawn() {
    const v = view()
    return { base: v.stage.base?.drawn, items: v.stage.items.map((i) => i?.drawn) }
  }
  /** The run's verdict on the node as stored now (the canvas run and the DAG assemble the same request). */
  const verdict = () => validateVideoOverlayRequest(view().request)

  it("a card drag under video-bottom: the layout turns Custom, the base stays on the bottom edge", () => {
    const result = setup({ outputAspect: "9:16", layout: "video-bottom", layers: [CARD] })
    const before = drawn()
    expect(before.base).toEqual({ left: 0, top: 1314, width: 1080, height: 606 })
    act(() => result.current.setLayer(0, { x: 5 }))
    expect(data().layout).toBeUndefined()
    expect(data().baseBox).toEqual({ anchor: "bottom", x: 0, y: 0, width: 100, fit: "contain" })
    expect(data().layers[0]).toMatchObject({ x: 5, anchor: "top", width: 80 })
    expect(drawn().base).toEqual(before.base)
  })

  it("a timing or look edit keeps the layout", () => {
    const result = setup({ outputAspect: "9:16", layout: "video-bottom", layers: [CARD] })
    act(() => result.current.setLayer(0, { start: 2 }))
    act(() => result.current.setLayer(0, { opacity: 0.5 }))
    act(() => result.current.setLayer(0, { animate: false }))
    expect(data().layout).toBe("video-bottom")
    expect(data().baseBox).toBeUndefined()
  })

  it("a pip drag on the WIRED inset moves it and keeps it 30 % wide (the stored corner badge never comes back)", () => {
    const result = setup({ layout: "pip", layers: [CARD, { start: 0 }] }, true)
    expect(drawn().items[1]).toEqual({ left: 1266, top: 712, width: 576, height: 324 })
    // The stage's drag starts from the pip box (x -4, y -4) and writes x / y only.
    act(() => result.current.setLayer(1, { x: -10, y: -6 }))
    expect(data().layout).toBeUndefined()
    expect(data().layers[1]).toMatchObject({ anchor: "bottom-right", x: -10, y: -6, width: 30, fit: "contain" })
    expect(data().layers[1]).not.toHaveProperty("videoUrl")
    expect(drawn().items[1]).toMatchObject({ width: 576, height: 324 })
    // The card stays where it was.
    expect(data().layers[0]).toBe(CARD)
  })

  it("a stack: a box edit on the stacked video keeps the base's rect; only the edited video moves", () => {
    const result = setup({ outputAspect: "9:16", layout: "stack-whole", layers: [null, { videoUrl: CLIP, start: 0 }] })
    const before = drawn()
    expect(before.base).toEqual({ left: 0, top: 354, width: 1080, height: 606 })
    expect(before.items[1]).toEqual({ left: 0, top: 960, width: 1080, height: 606 })
    // The stage's drag starts from the stacked rect as a box (top-left, y = 960 / 1920 = 50 %).
    act(() => result.current.setLayer(1, { y: 60 }))
    expect(data().layout).toBeUndefined()
    expect(data().baseBox).toMatchObject({ anchor: "top-left", fit: "cover" })
    expect(drawn().base).toEqual(before.base)
    expect(drawn().items[1]).toEqual({ left: 0, top: 1152, width: 1080, height: 606 })
  })

  it("a preset click is a box edit; a fade edit on the layout's video makes it Custom (the layout holds that fade off)", () => {
    const result = setup({ layout: "pip", layers: [CARD, { videoUrl: CLIP, start: 0 }] })
    act(() => result.current.setLayer(0, { animate: false }))
    expect(data().layout).toBe("pip")
    act(() => result.current.setLayer(1, { animate: true }))
    expect(data().layout).toBeUndefined()
    expect(data().layers[1]).toMatchObject({ animate: true, width: 30, anchor: "bottom-right" })
    setup({ layout: "pip", layers: [CARD, { videoUrl: CLIP, start: 0 }] })
    const again = renderHook(() => useVideoOverlayLayers("vo")).result
    act(() => again.current.applyPreset(0, "card"))
    expect(data().layout).toBeUndefined()
    expect(data().layers[1]).toMatchObject({ width: 30, anchor: "bottom-right" })
  })

  it("setLayout: a stack writes its tag, a 9:16 output when there is none, and clears a stored base box; Custom keeps its boxes", () => {
    const result = setup({ layers: [null, { videoUrl: CLIP, start: 0 }], baseBox: { anchor: "top", width: 50 } })
    act(() => result.current.setLayout("stack-whole"))
    expect(data()).toMatchObject({ layout: "stack-whole", outputAspect: "9:16" })
    expect(data().baseBox).toBeUndefined()
    const stacked = drawn()
    act(() => result.current.setLayout(null))
    expect(data().layout).toBeUndefined()
    expect(data()).not.toMatchObject({ layout: "" })
    expect(drawn()).toEqual(stacked)
  })

  it("an output aspect already set is kept; pip needs none and sets none", () => {
    const result = setup({ outputAspect: "1:1", layers: [{ videoUrl: CLIP, start: 0 }] })
    act(() => result.current.setLayout("video-top"))
    expect(data().outputAspect).toBe("1:1")
    setup({ layers: [{ videoUrl: CLIP, start: 0 }] })
    const pip = renderHook(() => useVideoOverlayLayers("vo")).result
    act(() => pip.current.setLayout("pip"))
    expect(data().layout).toBe("pip")
    expect(data().outputAspect).toBeUndefined()
  })

  // A layout turned Custom is a new canvas write: the saved, normalised node must
  // give the same composition key, or a fresh result reads "Result (old)" after a reload.
  it("a layout turned Custom is stored as the save normaliser stores it: one composition key", () => {
    const keyParity = () => {
      const d = data()
      const { nodes, edges } = useWorkflowStore.getState()
      const upstream = readVideoOverlayUpstream(nodes, edges, "vo")
      const saved = JSON.parse(JSON.stringify(normalizeVideoOverlayNodes([{ id: "vo", type: "video-overlay", data: d }], edges)[0]!.data)) as VideoOverlayData
      const key = (v: VideoOverlayData) =>
        videoOverlayCompositionKey({ baseUrl: upstream.base, sources: videoOverlaySlotSources(v.layers, upstream.layers), data: v, videoSlots: upstream.wiredVideoSlots })
      expect(key(saved)).toBe(key(d))
    }
    // Every writer stores an unwired layer expanded (the canvas writer, the save and MCP normaliser); so does this fixture.
    const pip = setup({ layout: "pip", layers: [expandVideoOverlayLayer(CARD), { start: 0 }] }, true)
    act(() => pip.current.setLayer(1, { x: -10, y: -6 }))
    keyParity()
    const stack = setup({ outputAspect: "9:16", layout: "stack-whole", layers: [null, { videoUrl: CLIP, start: 0 }] })
    act(() => stack.current.setLayout(null))
    expect(data().baseBox).toBeDefined()
    keyParity()
  })

  it("choosing a layout after a Custom moves the base again: the base box Custom kept is cleared", () => {
    const result = setup({ outputAspect: "9:16", layout: "video-bottom", layers: [CARD] })
    act(() => result.current.setLayer(0, { x: 5 }))
    expect(data().baseBox).toBeDefined()
    act(() => result.current.setLayout("video-top"))
    expect(data().baseBox).toBeUndefined()
    expect(drawn().base).toEqual({ left: 0, top: 0, width: 1080, height: 606 })
  })
})

describe("useVideoOverlayLayers — fix round 1", () => {
  const BASE = "https://x/base.mp4"
  const CLIP = "https://x/clip.mp4"
  function setup(nodeData: Partial<VideoOverlayData>, aspects: Record<string, number> = { [BASE]: 16 / 9, [CLIP]: 16 / 9 }) {
    useVideoOverlayAspectStore.setState({ aspects })
    useWorkflowStore.setState({
      isReadOnly: false,
      nodes: [
        { id: "vo", type: "video-overlay", position: { x: 0, y: 0 }, data: { label: "Video Overlay", fieldMappings: {}, layers: [], probedVideo: { url: BASE, durationSec: 10, width: 1920, height: 1080 }, ...nodeData } },
        { id: "base", type: "upload-video", position: { x: 0, y: 0 }, data: { url: BASE } },
        { id: "gv", type: "generate-video", position: { x: 0, y: 0 }, data: { generatedVideoUrl: CLIP } },
      ],
      edges: [
        { id: "e-base", source: "base", target: "vo", sourceHandle: "video", targetHandle: "video" },
        { id: "e-clip", source: "gv", target: "vo", sourceHandle: "video", targetHandle: "overlay" },
      ],
    } as never)
    return renderHook(() => useVideoOverlayLayers("vo")).result
  }
  function run() {
    const { nodes, edges } = useWorkflowStore.getState()
    const upstream = readVideoOverlayUpstream(nodes, edges, "vo")
    const v = resolveVideoOverlayView(data(), upstream, videoOverlayViewMedia(data().probedVideo, upstream.base, useVideoOverlayAspectStore.getState().aspects))
    return { verdict: validateVideoOverlayRequest(v.request), stage: v.stage }
  }

  // CRITICAL 1: an untouched slot stores no timing; the layer Custom stores keeps the run's start.
  describe.each(["pip", "stack-whole", "stack-filled"] as const)("%s with a wired video on an untouched slot", (layout) => {
    it.each([[[]], [[null]]])("turned Custom by the select (layers %j): the run is accepted", (layers) => {
      const result = setup({ outputAspect: "9:16", layout, layers })
      act(() => result.current.setLayout(null))
      expect(data().layout).toBeUndefined()
      expect(data().layers[0]).toMatchObject({ start: 0 })
      expect(run().verdict).toEqual({ ok: true })
    })
    it.each([[[]], [[null]]])("turned Custom by a drag (layers %j): the run is accepted", (layers) => {
      const result = setup({ outputAspect: "9:16", layout, layers })
      const from = run().stage.items[0]!.layer
      act(() => result.current.setLayer(0, { x: from.x + 2, y: from.y + 2 }))
      expect(data().layout).toBeUndefined()
      expect(data().layers[0]).toMatchObject({ start: 0, x: from.x + 2 })
      expect(run().verdict).toEqual({ ok: true })
    })
  })

  // IMPORTANT 1: a stack-whole waits for its clip's shape before it turns Custom.
  it("stack-whole before the clip's shape is read: a drag or Custom waits (nothing is stored); once read, Custom keeps the render's rects", () => {
    // A spy, not a module mock: this file runs in the shared worker (no-isolate-files.json).
    const toastInfo = vi.spyOn(toast, "info").mockImplementation(() => "")
    try {
      const result = setup({ outputAspect: "9:16", layout: "stack-whole", layers: [] }, { [BASE]: 16 / 9 })
      act(() => result.current.setLayer(0, { y: 60 }))
      // A dropped edit says why (one toast per node, updated in place).
      expect(toastInfo).toHaveBeenLastCalledWith("Reading the videos' shapes — Custom is available once they load.", { id: "video-overlay-shapes-vo" })
      act(() => useVideoOverlayAspectStore.getState().markUnreadable(CLIP))
      act(() => result.current.setLayer(0, { y: 61 }))
      expect(toastInfo).toHaveBeenLastCalledWith(
        "The clip's shape could not be read. The layout still renders (the server reads the real shape), but it cannot be turned Custom.",
        { id: "video-overlay-shapes-vo" },
      )
      act(() => useVideoOverlayAspectStore.setState({ unreadable: {} }))
      act(() => result.current.setLayout(null))
      act(() => result.current.setBaseBox({ y: 5 }))
      expect(data()).toMatchObject({ layout: "stack-whole", layers: [] })
      expect(data().baseBox).toBeUndefined()
      act(() => useVideoOverlayAspectStore.getState().setAspect(CLIP, 16 / 9))
      act(() => result.current.setLayout(null))
      expect(data().layout).toBeUndefined()
      expect(run().stage.base?.drawn).toEqual({ left: 0, top: 354, width: 1080, height: 606 })
      expect(run().stage.items[0]?.drawn).toEqual({ left: 0, top: 960, width: 1080, height: 606 })
    } finally {
      toastInfo.mockRestore()
    }
  })

  it("pip's corner is the layout's own input: it moves the inset and keeps the layout", () => {
    const result = setup({ layout: "pip", layers: [] })
    act(() => result.current.setLayer(0, { corner: "top-left" }))
    expect(data().layout).toBe("pip")
    expect(run().stage.items[0]?.drawn).toMatchObject({ left: 76, top: 42 })
  })

  describe("the base box", () => {
    it("a drag with no box and no layout starts from Video fit's whole frame and writes a complete box", () => {
      const result = setup({ outputAspect: "9:16", layers: [] })
      act(() => result.current.setBaseBox({ x: 10, y: -5 }))
      expect(data().baseBox).toEqual({ anchor: "center", x: 10, y: -5, width: 100, height: 100, fit: "cover" })
      act(() => result.current.setBaseBox({ width: 60, height: 40 }))
      expect(data().baseBox).toEqual({ anchor: "center", x: 10, y: -5, width: 60, height: 40, fit: "cover" })
      act(() => result.current.setBaseBox({ height: undefined }))
      expect(data().baseBox).toEqual({ anchor: "center", x: 10, y: -5, width: 60, fit: "cover" })
      expect(run().verdict).toEqual({ ok: true })
    })
    it("under video-bottom a base drag turns the layout Custom from the bottom edge box", () => {
      const result = setup({ outputAspect: "9:16", layout: "video-bottom", layers: [] })
      act(() => result.current.setBaseBox({ y: -10 }))
      expect(data().layout).toBeUndefined()
      expect(data().baseBox).toEqual({ anchor: "bottom", x: 0, y: -10, width: 100, fit: "contain" })
    })
    it("under a stack a base drag turns it Custom from the stacked rect, keeping the clip where it was", () => {
      const result = setup({ outputAspect: "9:16", layout: "stack-whole", layers: [] })
      const clip = run().stage.items[0]!.drawn
      act(() => result.current.setBaseBox({ y: 20 }))
      expect(data().layout).toBeUndefined()
      expect(data().baseBox).toMatchObject({ anchor: "top-left", y: 20, fit: "cover" })
      expect(run().stage.items[0]!.drawn).toEqual(clip)
      expect(run().verdict).toEqual({ ok: true })
    })
    it("with no box of its own, an edit starts from the box it began at (the stage's drawn rect, a shape-keeping resize box)", () => {
      const result = setup({ outputAspect: "9:16", layers: [] })
      const drawnRect = { anchor: "top-left", x: 0, y: 34.1667, width: 100, height: 31.5625, fit: "cover" } as const
      act(() => result.current.setBaseBox({ y: 30 }, drawnRect))
      expect(data().baseBox).toEqual({ ...drawnRect, y: 30 })
      // Once it has its own box, the next edit continues from it (a drag's later frames carry the same start box).
      act(() => result.current.setBaseBox({ y: 20 }, drawnRect))
      expect(data().baseBox).toEqual({ ...drawnRect, y: 20 })
      act(() => result.current.resetBaseBox())
      act(() => result.current.setBaseBox({ width: 60 }, { anchor: "center", x: 0, y: 0, width: 100, fit: "contain" }))
      expect(data().baseBox).toEqual({ anchor: "center", x: 0, y: 0, width: 60, fit: "contain" })
    })
    it("a partial stored box (written as JSON) is moved from the start box, not completed from Video fit's (no jump)", () => {
      const result = setup({ outputAspect: "9:16", layers: [], baseBox: { width: 40 } })
      const drawnRect = { anchor: "top-left", x: 0, y: 0, width: 100, height: 100, fit: "cover" } as const
      act(() => result.current.setBaseBox({ x: 5 }, drawnRect))
      expect(data().baseBox).toEqual({ ...drawnRect, x: 5 })
    })
    it("Reset removes the base box; without an output aspect nothing is written", () => {
      const result = setup({ outputAspect: "9:16", layers: [], baseBox: { anchor: "top", x: 0, y: 0, width: 50, fit: "contain" } })
      act(() => result.current.resetBaseBox())
      expect(data().baseBox).toBeUndefined()
      setup({ layers: [] })
      const none = renderHook(() => useVideoOverlayLayers("vo")).result
      act(() => none.current.setBaseBox({ x: 5 }))
      expect(data().baseBox).toBeUndefined()
    })
  })
})
