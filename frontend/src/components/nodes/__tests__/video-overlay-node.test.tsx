/**
 * The node card (UX §1): the dashed placeholder until a base video is wired,
 * then the live stage; the strip's Run is disabled with the reason (sugar
 * over the executor's refusal).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, renderHook, screen } from "@testing-library/react"
import type { NodeProps } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return { ...actual, useUpdateNodeInternals: () => vi.fn(), Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" } }
})
vi.mock("@/components/nodes/base-node", () => ({
  BaseNode: ({ children, topToolbarContent }: { children?: import("react").ReactNode; topToolbarContent?: import("react").ReactNode }) => (
    <div data-testid="base-node">{topToolbarContent}{children}</div>
  ),
}))
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 20 }))
vi.mock("@/components/nodes/editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("@/components/nodes/handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: { image: "#000", video: "#000" } }))
vi.mock("@/components/nodes/node-quick-strip", () => ({
  NodeQuickStrip: ({ disabled, disabledReason }: { disabled?: boolean; disabledReason?: string }) => (
    <button type="button" data-testid="run" disabled={disabled} title={disabledReason}>Run</button>
  ),
}))

vi.mock("@/components/nodes/video-result-overlay", () => ({
  VideoResultOverlay: ({ url }: { url: string }) => <div data-testid="result-video">{url}</div>,
}))

import { videoOverlayCompositionKey, videoOverlaySlotSources, type VideoOverlayLayerInput } from "@nodaro/shared"
import { VideoOverlayNode } from "../video-overlay-node"
import { useVideoOverlayLayers } from "@/hooks/use-video-overlay-layers"

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

beforeEach(() => vi.clearAllMocks())

describe("VideoOverlayNode", () => {
  it("shows the placeholder and disables Run until a base video is wired", () => {
    renderNode([])
    expect(screen.getByText("Connect a video and image layers")).toBeInTheDocument()
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
})
