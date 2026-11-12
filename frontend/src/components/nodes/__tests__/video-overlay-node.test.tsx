/**
 * The node card (UX §1): the dashed placeholder until a base video is wired,
 * then the live stage; the strip's Run is disabled with the reason (sugar
 * over the executor's refusal).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return { ...actual, useUpdateNodeInternals: () => vi.fn(), Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" } }
})
vi.mock("@/components/nodes/base-node", () => ({
  BaseNode: ({ children, topToolbarContent, credits, creditsRange }: { children?: import("react").ReactNode; topToolbarContent?: import("react").ReactNode; credits?: number; creditsRange?: { min: number; max: number } }) => (
    <div data-testid="base-node" data-credits={String(credits)} data-range={creditsRange ? `${creditsRange.min}-${creditsRange.max}` : ""}>{topToolbarContent}{children}</div>
  ),
}))
// Charged prices as the server serves them: the flat image row, one video unit, and a whole run of N video units.
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: (id: string) => (id === "video-overlay:video" ? 11 : 22) }))
vi.mock("@/hooks/use-unit-quote-credits", () => ({ useUnitQuoteCredits: (id: string, units: number) => (id === "video-overlay:video" ? units * 11 : 0) }))
vi.mock("@/components/nodes/editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("@/components/nodes/handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: { image: "#000", video: "#000" } }))
vi.mock("@/components/nodes/node-quick-strip", () => ({
  NodeQuickStrip: ({ disabled, disabledReason, credits }: { disabled?: boolean; disabledReason?: string; credits?: number }) => (
    <button type="button" data-testid="run" disabled={disabled} title={disabledReason} data-credits={String(credits)}>Run</button>
  ),
}))

vi.mock("@/components/nodes/video-result-overlay", () => ({
  VideoResultOverlay: ({ url }: { url: string }) => <div data-testid="result-video">{url}</div>,
}))

import { videoOverlayCompositionKey, videoOverlaySlotSources, type VideoOverlayLayerInput } from "@nodaro/shared/video"
import { VideoOverlayNode } from "../video-overlay-node"
import { useVideoOverlayLayers } from "@/hooks/use-video-overlay-layers"
import { useVideoOverlayAspectStore } from "@/hooks/use-video-overlay-aspects"
import { useVideoOverlaySelectionStore } from "@/hooks/use-video-overlay-selection"

type TestEdge = { id: string; source: string; target: string; targetHandle: string }

function seedStore(edges: TestEdge[], layers: unknown[] = [], extra: Record<string, unknown> = {}) {
  useWorkflowStore.setState({
    isReadOnly: false,
    nodes: [
      { id: "vo", type: "video-overlay", position: { x: 0, y: 0 }, data: { label: "Video Overlay", layers, fieldMappings: {}, ...extra } },
      { id: "vid", type: "upload-video", position: { x: 0, y: 0 }, data: { url: "https://x/base.mp4" } },
      { id: "img", type: "upload-image", position: { x: 0, y: 0 }, data: { url: "https://x/a.png" } },
    ],
    edges: edges.map((e) => ({ ...e, sourceHandle: null })),
  } as never)
}

function renderNode(edges: TestEdge[], layers: unknown[] = [], extra: Record<string, unknown> = {}) {
  seedStore(edges, layers, extra)
  const data = useWorkflowStore.getState().nodes[0]!.data
  render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  // The shapes a stage read are shared by URL: each test starts with none.
  useVideoOverlayAspectStore.setState({ aspects: {}, unreadable: {} })
  useVideoOverlaySelectionStore.setState({ selected: {}, base: {} })
})

describe("VideoOverlayNode — the price its Run button and pill show", () => {
  const baseEdge = { id: "e1", source: "vid", target: "vo", targetHandle: "video" }
  const withBaseLength = (sec: number) =>
    useWorkflowStore.setState((s) => ({ nodes: s.nodes.map((n) => (n.id === "vid" ? { ...n, data: { ...n.data, duration: sec } } : n)) }) as never)
  const renderSeeded = (edges: TestEdge[], layers: unknown[], baseSec?: number) => {
    seedStore(edges, layers)
    if (baseSec !== undefined) withBaseLength(baseSec)
    const data = useWorkflowStore.getState().nodes[0]!.data
    render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
  }

  it("an image-only node: the flat row", () => {
    renderSeeded([baseEdge, { id: "e2", source: "img", target: "vo", targetHandle: "overlay" }], [], 600)
    expect(screen.getByTestId("run")).toHaveAttribute("data-credits", "22")
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "22")
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-range", "")
  })

  it("a video layer on a 10 s base: 2 units of the video row", () => {
    renderSeeded([baseEdge], [{ videoUrl: "https://x/c.mp4", start: 0 }], 10)
    expect(screen.getByTestId("run")).toHaveAttribute("data-credits", "22")
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-credits", "22")
  })

  it("a video layer on a 30 s base: 6 units", () => {
    renderSeeded([baseEdge], [{ videoUrl: "https://x/c.mp4", start: 0 }], 30)
    expect(screen.getByTestId("run")).toHaveAttribute("data-credits", "66")
  })

  it("UGC Cards' layer plan (its card images) keeps the flat row, the base's length not read", () => {
    seedStore([baseEdge, { id: "e3", source: "cards", target: "vo", targetHandle: "layerPlan" }], [])
    useWorkflowStore.setState((s) => ({
      nodes: [...s.nodes, { id: "cards", type: "ugc-cards", position: { x: 0, y: 0 }, data: { label: "UGC Cards" } }],
      edges: s.edges.map((e) => (e.id === "e3" ? { ...e, sourceHandle: "layerPlan" } : e)),
    }) as never)
    const data = useWorkflowStore.getState().nodes[0]!.data
    render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
    expect(screen.getByTestId("run")).toHaveAttribute("data-credits", "22")
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-range", "")
  })

  it("a plan whose layers are not known before the run (a Text node) is quoted as a video run, at the cap while the base is not measured", () => {
    seedStore([baseEdge, { id: "e3", source: "txt", target: "vo", targetHandle: "layerPlan" }], [])
    useWorkflowStore.setState((s) => ({ nodes: [...s.nodes, { id: "txt", type: "text", position: { x: 0, y: 0 }, data: { label: "Text", text: "[]" } }] }) as never)
    const data = useWorkflowStore.getState().nodes[0]!.data
    render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
    expect(screen.getByTestId("run")).toHaveAttribute("data-credits", "132")
  })

  it("a video layer on a base not measured yet: the pill shows one unit up to the 60 s cap, Run quotes the cap", () => {
    renderSeeded([baseEdge], [{ videoUrl: "https://x/c.mp4", start: 0 }])
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-range", "11-132")
    expect(screen.getByTestId("run")).toHaveAttribute("data-credits", "132")
  })
})

describe("VideoOverlayNode", () => {
  it("shows the placeholder and disables Run until a base video is wired", () => {
    renderNode([])
    expect(screen.getByText("Connect a video, then image or video layers")).toBeInTheDocument()
    expect(screen.getByTestId("run")).toBeDisabled()
    expect(screen.getByTestId("run")).toHaveAttribute("title", "Connect a base video")
  })

  it("a JSON-written node with more than 20 stored layers disables Run with the too_many_layers reason (spec §3.5)", () => {
    const layers = Array.from({ length: 21 }, (_, i) => ({ imageUrl: `https://x/${i}.png`, start: 0 }))
    renderNode([{ id: "e1", source: "vid", target: "vo", targetHandle: "video" }], layers)
    expect(screen.getByTestId("run")).toBeDisabled()
    expect(screen.getByTestId("run")).toHaveAttribute("title", "At most 20 layers (this node has 21)")
  })

  it("with a base and one wired image, shows the stage hint and enables Run", () => {
    renderNode([
      { id: "e1", source: "vid", target: "vo", targetHandle: "video" },
      { id: "e2", source: "img", target: "vo", targetHandle: "overlay" },
    ])
    expect(screen.getByText("Live preview. Run renders the video file.")).toBeInTheDocument()
    expect(screen.getByTestId("run")).not.toBeDisabled()
  })

  // A 24-layer node written via workflow JSON; the user removes layers 1–4.
  // Removal never re-numbers, so 20 layers stay at slots 5–24: the stage draws
  // all 20 (slots 21–24 included), Run is enabled, and the canvas key sees them.
  describe("layers 1–4 removed from a 24-layer node", () => {
    const realRO = globalThis.ResizeObserver
    beforeEach(() => {
      // A stage with a real size (the setup polyfill never reports one).
      globalThis.ResizeObserver = class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() { this.cb([{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    })
    afterEach(() => { globalThis.ResizeObserver = realRO })

    const baseEdge = [{ id: "e1", source: "vid", target: "vo", targetHandle: "video" }]
    const stored24 = () => Array.from({ length: 24 }, (_, i) => ({ imageUrl: `https://x/${i}.png`, start: 0 }))

    function removeFirstFour() {
      const { result } = renderHook(() => useVideoOverlayLayers("vo"))
      act(() => { for (const i of [0, 1, 2, 3]) result.current.removeLayer(i) })
      return useWorkflowStore.getState().nodes[0]!.data as { layers: Array<VideoOverlayLayerInput | null> }
    }

    it("draws the 20 remaining layers — slots 5–24 — and enables Run", () => {
      seedStore(baseEdge, stored24())
      const data = removeFirstFour()
      expect(data.layers).toHaveLength(24)
      expect(data.layers.slice(0, 4)).toEqual([null, null, null, null])
      render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
      const drawn = screen.getAllByRole("img", { name: /^Layer \d+$/ }).map((el) => el.getAttribute("aria-label"))
      expect(drawn).toHaveLength(20)
      expect(new Set(drawn)).toEqual(new Set(Array.from({ length: 20 }, (_, i) => `Layer ${i + 5}`)))
      for (const run of screen.getAllByTestId("run")) expect(run).not.toBeDisabled()
    })

    it("parity past slot 20: the canvas key equals the backend key for the same node → a stamped result reads fresh", () => {
      seedStore(baseEdge, stored24())
      const data = removeFirstFour()
      // What payload-builder computes for the same node read back from the DB (jsonb re-orders keys).
      const dbLayers = data.layers.map((l) => (l ? { start: l.start, imageUrl: l.imageUrl } : null))
      const backendKey = videoOverlayCompositionKey({ baseUrl: "https://x/base.mp4", sources: videoOverlaySlotSources(dbLayers, []), data: { layers: dbLayers } })
      expect(JSON.parse(backendKey)[1][23]).toBe("https://x/23.png")
      const stamped = {
        ...data,
        executionStatus: "completed",
        generatedVideoUrl: "https://x/out.mp4",
        activeResultIndex: 0,
        generatedResults: [{ url: "https://x/out.mp4", jobId: "j1", resultCompositionKey: backendKey }],
      }
      render(<VideoOverlayNode {...({ id: "vo", data: stamped, selected: false } as unknown as NodeProps)} />)
      expect(screen.getByRole("button", { name: "Result" })).toHaveAttribute("aria-pressed", "true")
      expect(screen.queryByText("Result (old)")).not.toBeInTheDocument()
    })
  })

  describe("a wired layer plan (spec §6.1)", () => {
    const planEdges = [
      { id: "e1", source: "vid", target: "vo", targetHandle: "video" },
      { id: "e3", source: "plan", target: "vo", targetHandle: "layerPlan" },
    ]
    const box = { anchor: "top", x: 0, y: 12, width: 78, height: 52, fit: "contain" } as const
    const plan = [{ imageUrl: "https://x/s1.png", start: 0, ...box }]
    function renderPlanNode(planText: string, extra: Record<string, unknown> = {}, layers: unknown[] = []) {
      seedStore(planEdges, layers, extra)
      useWorkflowStore.setState((st) => ({ nodes: [...st.nodes, { id: "plan", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: planText } }] }) as never)
      const data = useWorkflowStore.getState().nodes[0]!.data
      render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
    }

    it("a plan with a layer enables Run (no handle layer needed)", () => {
      renderPlanNode(JSON.stringify(plan))
      expect(screen.getByTestId("run")).not.toBeDisabled()
    })
    it("an empty plan with no other layer enables Run — it passes the video through", () => {
      renderPlanNode("[]")
      expect(screen.getByTestId("run")).not.toBeDisabled()
    })
    it("an unreadable plan disables Run with the invalid_layer_plan reason", () => {
      renderPlanNode("not json")
      expect(screen.getByTestId("run")).toBeDisabled()
      expect(screen.getByTestId("run")).toHaveAttribute("title", "The layer plan must be a list of layers")
    })
    it("draws the plan's layer on the stage, read-only, with the hint", () => {
      const realRO = globalThis.ResizeObserver
      // A stage with a real size (the setup polyfill never reports one).
      globalThis.ResizeObserver = class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() { this.cb([{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
      try {
        renderPlanNode(JSON.stringify(plan))
        expect(screen.getByRole("img", { name: "From the layer plan" })).toBeInTheDocument()
      } finally {
        globalThis.ResizeObserver = realRO
      }
    })
    it("parity: the canvas key equals the key the executor computes with the wired plan → the result reads fresh", () => {
      const key = videoOverlayCompositionKey({ baseUrl: "https://x/base.mp4", sources: videoOverlaySlotSources([], []), data: { layers: [] }, planLayers: JSON.stringify(plan) })
      renderPlanNode(JSON.stringify(plan), {
        executionStatus: "completed",
        generatedVideoUrl: "https://x/out.mp4",
        activeResultIndex: 0,
        generatedResults: [{ url: "https://x/out.mp4", jobId: "j1", resultCompositionKey: key }],
      })
      expect(screen.getByRole("button", { name: "Result" })).toHaveAttribute("aria-pressed", "true")
    })
  })

  describe("freshness of a result a backend run stamped (resultCompositionKey)", () => {
    const wiredEdges = [
      { id: "e1", source: "vid", target: "vo", targetHandle: "video" },
      { id: "e2", source: "img", target: "vo", targetHandle: "overlay" },
    ]
    const canvasLayers: VideoOverlayLayerInput[] = [{ start: 1, end: 3, preset: "card", anchor: "center", x: 0, y: -4, width: 78, height: 60, fit: "contain", opacity: 1, animate: true }]
    // What payload-builder computes for the same node read back from the DB (jsonb re-orders keys).
    const dbLayers: VideoOverlayLayerInput[] = [{ x: 0, y: -4, end: 3, fit: "contain", start: 1, width: 78, anchor: "center", height: 60, preset: "card", animate: true, opacity: 1 }]
    const backendKey = videoOverlayCompositionKey({
      baseUrl: "https://x/base.mp4",
      sources: videoOverlaySlotSources(dbLayers, ["https://x/a.png"]),
      data: { layers: dbLayers, outputAspect: "9:16" },
    })
    const result = (key?: string) => ({
      executionStatus: "completed",
      outputAspect: "9:16",
      generatedVideoUrl: "https://x/out.mp4",
      activeResultIndex: 0,
      generatedResults: [{ url: "https://x/out.mp4", jobId: "j1", ...(key ? { resultCompositionKey: key } : {}) }],
    })

    it("parity: the canvas key for the node equals the backend key for the same resolved inputs → the result reads fresh", () => {
      renderNode(wiredEdges, canvasLayers, result(backendKey))
      expect(screen.getByRole("button", { name: "Result" })).toHaveAttribute("aria-pressed", "true")
      expect(screen.getByTestId("result-video")).toHaveTextContent("https://x/out.mp4")
      expect(screen.queryByText("Result (old)")).not.toBeInTheDocument()
    })

    it("an unstamped result still reads old", () => {
      renderNode(wiredEdges, canvasLayers, result())
      expect(screen.getByRole("button", { name: "Result (old)" })).toHaveAttribute("aria-pressed", "false")
      expect(screen.queryByTestId("result-video")).not.toBeInTheDocument()
    })
  })

  // The base is movable now; an image-only node that never moved it is untouched: no write on mount, the same key.
  it("an image-only node with no base box: mounting the node writes nothing, and its key is unchanged", () => {
    seedStore([{ id: "e1", source: "vid", target: "vo", targetHandle: "video" }, { id: "e2", source: "img", target: "vo", targetHandle: "overlay" }], [], { outputAspect: "9:16", probedVideo: { url: "https://x/base.mp4", durationSec: 5, width: 1920, height: 1080 } })
    const before = useWorkflowStore.getState().nodes[0]!.data
    render(<VideoOverlayNode {...({ id: "vo", data: before, selected: false } as unknown as NodeProps)} />)
    expect(useWorkflowStore.getState().nodes[0]!.data).toBe(before)
    expect(before).not.toHaveProperty("baseBox")
    expect(videoOverlayCompositionKey({ baseUrl: "https://x/base.mp4", sources: ["https://x/a.png"], data: before as never })).toBe(
      videoOverlayCompositionKey({ baseUrl: "https://x/base.mp4", sources: ["https://x/a.png"], data: { layers: [], outputAspect: "9:16" } }),
    )
  })

  describe("a video wired into a layer handle", () => {
    const CLIP = "https://x/signed/clip"
    function seedWithClip(extra: Record<string, unknown>, columnType = "video-url") {
      seedStore([{ id: "e1", source: "vid", target: "vo", targetHandle: "video" }], [], extra)
      useWorkflowStore.setState((s) => ({
        nodes: [...s.nodes, { id: "clips", type: "list", position: { x: 0, y: 0 }, data: { label: "Clips", columns: [{ id: "c", handleId: "c", name: "Clips", type: columnType }], rows: [[CLIP]] } }],
        edges: [...s.edges, { id: "e2", source: "clips", target: "vo", sourceHandle: "c", targetHandle: "overlay" }],
      }) as never)
      return useWorkflowStore.getState().nodes[0]!.data
    }

    it("satisfies a stack layout: Run is enabled (the wire is the stack's video layer)", () => {
      const data = seedWithClip({ outputAspect: "9:16", layout: "stack-whole" })
      render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
      expect(screen.getByTestId("run")).not.toBeDisabled()
    })

    it("draws the wired video on the stage as a video, and an image wire as an image", () => {
      const realRO = globalThis.ResizeObserver
      // A stage with a real size (the setup polyfill never reports one).
      globalThis.ResizeObserver = class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() { this.cb([{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
      try {
        const data = seedWithClip({ outputAspect: "9:16" })
        useWorkflowStore.setState((s) => ({ edges: [...s.edges, { id: "e3", source: "img", target: "vo", sourceHandle: null, targetHandle: "overlay2" }] }) as never)
        render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
        // The stage element asks for the first frame (#t=0.001); the layer's URL is the plain one.
        expect(screen.getByRole("img", { name: "Layer 1" }).querySelector("video")).toHaveAttribute("src", `${CLIP}#t=0.001`)
        expect(screen.getByRole("img", { name: "Layer 2" }).querySelector("img")).toHaveAttribute("src", "https://x/a.png")
      } finally {
        globalThis.ResizeObserver = realRO
      }
    })

    // The base's length cap is shown in the panel only: the server measures the real file and decides.
    it("on a base past 60 s, Run stays enabled (the panel warns; the server decides)", () => {
      const data = seedWithClip({ probedVideo: { url: "https://x/base.mp4", durationSec: 61 } })
      useWorkflowStore.setState((s) => ({ nodes: s.nodes.map((n) => (n.id === "vid" ? { ...n, data: { ...n.data, duration: 61 } } : n)) }) as never)
      render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
      expect(screen.getByTestId("run")).not.toBeDisabled()
    })

    // End to end: the stage's drag goes through the layers writer, which
    // turns the layout Custom keeping the pip box, so the drag moves the inset
    // instead of being overridden — and it stays 30 % wide.
    it("a drag on the pip inset turns the layout Custom and moves it, keeping its width", async () => {
      const realRO = globalThis.ResizeObserver
      globalThis.ResizeObserver = class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() { this.cb([{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
      try {
        const data = seedWithClip({ layout: "pip", probedVideo: { url: "https://x/base.mp4", durationSec: 10, width: 1920, height: 1080 } })
        render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
        const inset = screen.getByRole("img", { name: "Layer 1" })
        // 1920×1080 in 400×300: the stage is 400 px wide, so 40 px is 10 % of the output width. Shift: no snapping.
        fireEvent.pointerDown(inset, { pointerId: 1, clientX: 100, clientY: 100, shiftKey: true })
        fireEvent.pointerMove(screen.getByRole("group", { name: "Preview" }), { pointerId: 1, clientX: 60, clientY: 100, shiftKey: true })
        await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
        const stored = useWorkflowStore.getState().nodes[0]!.data as { layout?: string; layers: Array<Record<string, unknown> | null> }
        expect(stored.layout).toBeUndefined()
        expect(stored.layers[0]).toMatchObject({ anchor: "bottom-right", x: -14, y: -4, width: 30, start: 0 })
        // The untouched wired slot keeps the run's timing: Run stays enabled.
        expect(screen.getByTestId("run")).not.toBeDisabled()
      } finally {
        globalThis.ResizeObserver = realRO
      }
    })

    // Base dragging end to end: the stage's base drag goes through the layers writer; under an edge layout it turns Custom first.
    it("a drag on the base under Video at bottom turns the layout Custom and moves the base, keeping its box", async () => {
      const realRO = globalThis.ResizeObserver
      globalThis.ResizeObserver = class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() { this.cb([{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
      try {
        const data = seedWithClip({ outputAspect: "9:16", layout: "video-bottom", probedVideo: { url: "https://x/base.mp4", durationSec: 10, width: 1920, height: 1080 } })
        // Selected from the Base video card: the node's panel is open.
        useWorkflowStore.setState({ selectedNodeId: "vo" } as never)
        useVideoOverlaySelectionStore.getState().selectBase("vo", true)
        render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
        // 9:16 in 400×300: the stage is 300 px tall, so 30 px is 10 % of the output height. Shift: no snapping.
        fireEvent.pointerDown(screen.getByRole("img", { name: "Base video" }), { pointerId: 1, clientX: 100, clientY: 200, shiftKey: true })
        fireEvent.pointerMove(screen.getByRole("group", { name: "Preview" }), { pointerId: 1, clientX: 100, clientY: 170, shiftKey: true })
        await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
        const stored = useWorkflowStore.getState().nodes[0]!.data as { layout?: string; baseBox?: unknown }
        expect(stored.layout).toBeUndefined()
        expect(stored.baseBox).toEqual({ anchor: "bottom", x: 0, y: -10, width: 100, fit: "contain" })
        expect(screen.getByTestId("run")).not.toBeDisabled()
      } finally {
        globalThis.ResizeObserver = realRO
      }
    })

    function withStage<T>(body: () => Promise<T>): Promise<T> {
      const realRO = globalThis.ResizeObserver
      globalThis.ResizeObserver = class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() { this.cb([{ contentRect: { width: 400, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
      return body().finally(() => { globalThis.ResizeObserver = realRO })
    }
    function renderImageOnly(onNodeClick = vi.fn()) {
      seedStore([{ id: "e1", source: "vid", target: "vo", targetHandle: "video" }, { id: "e2", source: "img", target: "vo", targetHandle: "overlay2" }], [], { outputAspect: "9:16", probedVideo: { url: "https://x/base.mp4", durationSec: 5, width: 1920, height: 1080 } })
      const before = useWorkflowStore.getState().nodes[0]!.data
      render(<div onClick={onNodeClick}><VideoOverlayNode {...({ id: "vo", data: before, selected: false } as unknown as NodeProps)} /></div>)
      return before
    }

    // "Only after selecting it": an image-only node with an output aspect behaves as before the base could move.
    it("unselected, the base takes no pointer: a press-drag on the stage writes nothing and the click reaches the node", () =>
      withStage(async () => {
        const onNodeClick = vi.fn()
        const before = renderImageOnly(onNodeClick)
        expect(screen.queryByRole("img", { name: "Base video" })).toBeNull()
        const stage = screen.getByRole("group", { name: "Preview" })
        fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 })
        fireEvent.pointerMove(stage, { pointerId: 1, clientX: 160, clientY: 160 })
        fireEvent.pointerUp(stage, { pointerId: 1 })
        fireEvent.click(stage)
        await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
        expect(useWorkflowStore.getState().nodes[0]!.data).toBe(before)
        expect(onNodeClick).toHaveBeenCalledTimes(1)
      }))

    it("a click with jitter on the selected base writes nothing (same data)", () =>
      withStage(async () => {
        useWorkflowStore.setState({ selectedNodeId: "vo" } as never)
        useVideoOverlaySelectionStore.getState().selectBase("vo", true)
        const before = renderImageOnly()
        const stage = screen.getByRole("group", { name: "Preview" })
        fireEvent.pointerDown(screen.getByRole("img", { name: "Base video" }), { pointerId: 1, clientX: 100, clientY: 100 })
        fireEvent.pointerMove(stage, { pointerId: 1, clientX: 101, clientY: 101 })
        fireEvent.pointerUp(stage, { pointerId: 1 })
        await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
        expect(useWorkflowStore.getState().nodes[0]!.data).toBe(before)
      }))

    it("the selected base is let go on Escape, on a press outside it, and when the panel shows another node", () =>
      withStage(async () => {
        const base = () => "vo" in useVideoOverlaySelectionStore.getState().base
        useWorkflowStore.setState({ selectedNodeId: "vo" } as never)
        useVideoOverlaySelectionStore.getState().selectBase("vo", true)
        renderImageOnly()
        expect(screen.getByRole("img", { name: "Base video" })).toBeInTheDocument()
        // A press on the base itself keeps it.
        fireEvent.pointerDown(screen.getByRole("img", { name: "Base video" }), { pointerId: 1, clientX: 50, clientY: 50 })
        fireEvent.pointerUp(screen.getByRole("group", { name: "Preview" }), { pointerId: 1 })
        expect(base()).toBe(true)
        act(() => { fireEvent.keyDown(document, { key: "Escape" }) })
        expect(base()).toBe(false)
        act(() => useVideoOverlaySelectionStore.getState().selectBase("vo", true))
        act(() => { fireEvent.pointerDown(document.body) })
        expect(base()).toBe(false)
        // A menu the Base card opened is marked as the card's: a press in it keeps the base; any other menu (a layer card's) lets it go.
        act(() => useVideoOverlaySelectionStore.getState().selectBase("vo", true))
        const cardMenu = document.createElement("div")
        cardMenu.setAttribute("data-radix-popper-content-wrapper", "")
        cardMenu.innerHTML = '<div data-video-overlay-base="vo" role="listbox"><div role="option">Cover</div></div>'
        const otherMenu = document.createElement("div")
        otherMenu.setAttribute("data-radix-popper-content-wrapper", "")
        otherMenu.innerHTML = '<div role="listbox"><div role="option">Cover</div></div>'
        document.body.append(cardMenu, otherMenu)
        act(() => { fireEvent.pointerDown(cardMenu.querySelector('[role="option"]')!) })
        expect(base()).toBe(true)
        act(() => { fireEvent.pointerDown(otherMenu.querySelector('[role="option"]')!) })
        expect(base()).toBe(false)
        cardMenu.remove()
        otherMenu.remove()
        act(() => useVideoOverlaySelectionStore.getState().selectBase("vo", true))
        act(() => useWorkflowStore.setState({ selectedNodeId: "other" } as never))
        expect(base()).toBe(false)
        expect(screen.queryByRole("img", { name: "Base video" })).toBeNull()
      }))

    it("under Stack whole, the selected base is dragged: the layout turns Custom, keeping the stacked boxes", () =>
      withStage(async () => {
        const data = seedWithClip({ outputAspect: "9:16", layout: "stack-whole", probedVideo: { url: "https://x/base.mp4", durationSec: 10, width: 1920, height: 1080 } })
        useVideoOverlayAspectStore.setState({ aspects: { [CLIP]: 16 / 9 } })
        useWorkflowStore.setState({ selectedNodeId: "vo" } as never)
        useVideoOverlaySelectionStore.getState().selectBase("vo", true)
        render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
        // 9:16 in 400×300: 30 px is 10 % of the output height. Shift: no snapping.
        fireEvent.pointerDown(screen.getByRole("img", { name: "Base video" }), { pointerId: 1, clientX: 100, clientY: 100, shiftKey: true })
        fireEvent.pointerMove(screen.getByRole("group", { name: "Preview" }), { pointerId: 1, clientX: 100, clientY: 70, shiftKey: true })
        await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
        const stored = useWorkflowStore.getState().nodes[0]!.data as { layout?: string; baseBox?: Record<string, unknown>; layers: Array<Record<string, unknown> | null> }
        expect(stored.layout).toBeUndefined()
        // The stacked base rect (top 354 of 1920 = 18.4375 %) as a box, moved up 10 % (a drag writes to 0.1 %); the clip keeps its stacked rect.
        expect(stored.baseBox).toMatchObject({ anchor: "top-left", fit: "cover", width: 100, height: 31.5625 })
        expect(stored.baseBox!.y as number).toBeCloseTo(8.4, 3)
        expect(stored.layers[0]).toMatchObject({ anchor: "top-left", y: 50, height: 31.5625, fit: "cover", start: 0 })
        expect(screen.getByTestId("run")).not.toBeDisabled()
      }))

    it("a result stamped with the wire as a video reads fresh; once the same link reads as an image, it reads old", () => {
      const key = videoOverlayCompositionKey({ baseUrl: "https://x/base.mp4", sources: [CLIP], data: { layers: [] }, videoSlots: [1] })
      const stamped = { executionStatus: "completed", generatedVideoUrl: "https://x/out.mp4", activeResultIndex: 0, generatedResults: [{ url: "https://x/out.mp4", jobId: "j1", resultCompositionKey: key }] }
      const data = seedWithClip(stamped)
      const { unmount } = render(<VideoOverlayNode {...({ id: "vo", data, selected: false } as unknown as NodeProps)} />)
      expect(screen.getByRole("button", { name: "Result" })).toHaveAttribute("aria-pressed", "true")
      unmount()
      const asImage = seedWithClip(stamped, "image-url")
      render(<VideoOverlayNode {...({ id: "vo", data: asImage, selected: false } as unknown as NodeProps)} />)
      expect(screen.getByRole("button", { name: "Result (old)" })).toHaveAttribute("aria-pressed", "false")
    })
  })
})
