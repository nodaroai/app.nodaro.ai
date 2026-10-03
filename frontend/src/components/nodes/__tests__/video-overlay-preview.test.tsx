/**
 * The live stage (UX §3, D5): only the layers live at the stage's one time are
 * drawn (the selected layer's start, else 0); the base is a bare <video> — no
 * native controls, no crossOrigin (audit U14); Delete removes the SELECTED
 * layer, never the node.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { expandVideoOverlayLayer, resolveVideoOverlayGeometry, type VideoOverlayLayer } from "@nodaro/shared"
import { VideoOverlayPreview, videoOverlayLayerLive } from "../video-overlay-preview"

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

const layers = [expandVideoOverlayLayer({ start: 0, end: 2 }), expandVideoOverlayLayer({ start: 5, preset: "card" })]
const sources = ["https://x/a.png", "https://x/b.png"]

function renderStage(selected: number | null, onRemove = vi.fn(), onSelect = vi.fn()) {
  render(
    <VideoOverlayPreview
      baseUrl="https://x/base.mp4"
      sources={sources}
      layers={layers}
      baseFit="cover"
      backgroundColor="#000000"
      fallbackDisplay={{ width: 1080, height: 1920 }}
      selected={selected}
      onSelect={onSelect}
      onLayerChange={vi.fn()}
      onReorder={vi.fn()}
      onRemove={onRemove}
    />,
  )
  return { onRemove, onSelect }
}

describe("videoOverlayLayerLive", () => {
  it("is [start, end) — an absent end runs to the end", () => {
    expect(videoOverlayLayerLive({ start: 1, end: 2 }, 1)).toBe(true)
    expect(videoOverlayLayerLive({ start: 1, end: 2 }, 2)).toBe(false)
    expect(videoOverlayLayerLive({ start: 1 }, 99)).toBe(true)
  })
})

describe("VideoOverlayPreview", () => {
  it("draws only the layers live at time 0 when nothing is selected", () => {
    renderStage(null)
    expect(screen.getByRole("img", { name: "Layer 1" })).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "Layer 2" })).toBeNull()
  })

  it("selecting a layer moves the stage to its start: layer 2 appears, layer 1 (ended at 2 s) does not", () => {
    renderStage(1)
    expect(screen.getByRole("img", { name: "Layer 2" })).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "Layer 1" })).toBeNull()
  })

  it("the base is a bare video: no controls, no crossOrigin", () => {
    const { container } = render(
      <VideoOverlayPreview baseUrl="https://x/base.mp4" sources={[]} layers={[]} baseFit="cover" backgroundColor="#000000" selected={null} onSelect={vi.fn()} onLayerChange={vi.fn()} onReorder={vi.fn()} onRemove={vi.fn()} />,
    )
    const video = container.querySelector("video")!
    expect(video.hasAttribute("controls")).toBe(false)
    expect(video.hasAttribute("crossorigin")).toBe(false)
  })

  it("Delete removes the selected layer", () => {
    const { onRemove } = renderStage(0)
    fireEvent.keyDown(screen.getByRole("img", { name: "Layer 1" }).closest("[tabindex]")!, { key: "Delete" })
    expect(onRemove).toHaveBeenCalledWith(0)
  })
})

/**
 * The geometry twin (spec §7, the image-overlay-geometry.test.ts discipline):
 * the stage draws each layer at the SHARED numbers the worker renders with,
 * scaled to the stage. 1080×1920 canvas in a 400×300 container → the stage is
 * 168.75×300, scale 300 / 1920 = 0.15625.
 */
describe("VideoOverlayPreview — draws at the shared geometry", () => {
  const SCALE = 300 / 1920

  function drawnStyle(layer: VideoOverlayLayer, natural: { w: number; h: number }) {
    render(
      <VideoOverlayPreview
        baseUrl="https://x/base.mp4"
        sources={["https://x/layer.png"]}
        layers={[layer]}
        baseFit="cover"
        backgroundColor="#000000"
        fallbackDisplay={{ width: 1080, height: 1920 }}
        selected={null}
        onSelect={vi.fn()}
        onLayerChange={vi.fn()}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    const box = screen.getByRole("img", { name: "Layer 1" })
    const img = box.querySelector("img")!
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: natural.w })
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: natural.h })
    fireEvent.load(img)
    const s = screen.getByRole("img", { name: "Layer 1" }).style
    return { left: parseFloat(s.left), top: parseFloat(s.top), width: parseFloat(s.width), height: parseFloat(s.height) }
  }

  it("a card on 1080×1920 with a 1:2 image: drawn 576×1152 at (252, 307), times the stage scale", () => {
    const card = expandVideoOverlayLayer({ start: 0, preset: "card" })
    const { drawn } = resolveVideoOverlayGeometry({ w: 1080, h: 1920 }, card, 1080 / 2160)
    // The shared numbers, pinned again from the frontend (Task 2 pins them in @nodaro/shared).
    expect(drawn).toEqual({ left: 252, top: 307, width: 576, height: 1152 })
    const style = drawnStyle(card, { w: 1080, h: 2160 })
    expect(style.left).toBeCloseTo(drawn.left * SCALE, 3)
    expect(style.top).toBeCloseTo(drawn.top * SCALE, 3)
    expect(style.width).toBeCloseTo(drawn.width * SCALE, 3)
    expect(style.height).toBeCloseTo(drawn.height * SCALE, 3)
  })

  it("a very tall image (1:10) at width 60 % with no height is clamped inside the frame: 192×1920 at (444, 0)", () => {
    const tall = expandVideoOverlayLayer({ start: 0, anchor: "center", x: 0, y: 0, width: 60, fit: "contain" })
    const { drawn } = resolveVideoOverlayGeometry({ w: 1080, h: 1920 }, tall, 400 / 4000)
    expect(drawn).toEqual({ left: 444, top: 0, width: 192, height: 1920 })
    const style = drawnStyle(tall, { w: 400, h: 4000 })
    expect(style.left).toBeCloseTo(drawn.left * SCALE, 3)
    expect(style.top).toBeCloseTo(drawn.top * SCALE, 3)
    expect(style.width).toBeCloseTo(drawn.width * SCALE, 3)
    expect(style.height).toBeCloseTo(drawn.height * SCALE, 3)
  })
})

/**
 * A partial box saved from workflow JSON (MCP update_workflow_json, copilot, a
 * REST save) is stored as written — the expansion leaves it for the
 * validator's incomplete_box. The stage must skip it, not throw: a throw here
 * is caught by the canvas error boundary and takes the whole canvas down.
 */
describe("VideoOverlayPreview — a stored partial box", () => {
  it("renders { width } and { anchor: null, width } without throwing; the complete layer beside them still draws", () => {
    const partial = [
      { imageUrl: "https://x/a.png", start: 0, width: 40 },
      { imageUrl: "https://x/b.png", start: 0, anchor: null, width: 30 },
      expandVideoOverlayLayer({ imageUrl: "https://x/c.png", start: 0 }),
    ] as unknown as VideoOverlayLayer[]
    const draw = (selected: number | null) =>
      render(
        <VideoOverlayPreview
          baseUrl="https://x/base.mp4"
          sources={["https://x/a.png", "https://x/b.png", "https://x/c.png"]}
          layers={partial}
          baseFit="cover"
          backgroundColor="#000000"
          fallbackDisplay={{ width: 1080, height: 1920 }}
          selected={selected}
          onSelect={vi.fn()}
          onLayerChange={vi.fn()}
          onReorder={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
    expect(() => draw(null)).not.toThrow()
    expect(screen.queryByRole("img", { name: "Layer 1" })).toBeNull()
    expect(screen.queryByRole("img", { name: "Layer 2" })).toBeNull()
    expect(screen.getByRole("img", { name: "Layer 3" })).toBeInTheDocument()
  })

  it("selecting the partial layer does not throw either", () => {
    const partial = [{ imageUrl: "https://x/a.png", start: 0, anchor: null, width: 30 }] as unknown as VideoOverlayLayer[]
    expect(() =>
      render(
        <VideoOverlayPreview
          baseUrl="https://x/base.mp4"
          sources={["https://x/a.png"]}
          layers={partial}
          baseFit="cover"
          backgroundColor="#000000"
          fallbackDisplay={{ width: 1080, height: 1920 }}
          selected={0}
          onSelect={vi.fn()}
          onLayerChange={vi.fn()}
          onReorder={vi.fn()}
          onRemove={vi.fn()}
        />,
      ),
    ).not.toThrow()
    expect(screen.queryByRole("img", { name: "Layer 1" })).toBeNull()
  })
})
