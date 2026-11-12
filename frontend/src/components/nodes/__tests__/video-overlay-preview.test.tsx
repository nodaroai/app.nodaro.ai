/**
 * The live stage (UX §3, D5): only the layers live at the stage's one time are
 * drawn (the selected layer's start, else 0); the base is a bare <video> — no
 * native controls, no crossOrigin (audit U14); Delete removes the SELECTED
 * layer, never the node.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react"
import { evenVideoOverlayRect, expandVideoOverlayLayer, resolveVideoOverlayGeometry, resolveVideoOverlayStackRects, type VideoOverlayLayer } from "@nodaro/shared/video"
import { useVideoOverlayAspectStore } from "@/hooks/use-video-overlay-aspects"
import { VIDEO_OVERLAY_SHAPE_PROBE_TIMEOUT_MS, VideoOverlayPreview, VideoOverlayShapeProbe, videoOverlayFirstFrameSrc, videoOverlayLayerLive } from "../video-overlay-preview"

const realRO = globalThis.ResizeObserver
beforeEach(() => {
  // The shapes a stage read are shared by URL: each test starts with none.
  useVideoOverlayAspectStore.setState({ aspects: {}, unreadable: {} })
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

describe("VideoOverlayPreview — a wired layer plan", () => {
  const planLayer = expandVideoOverlayLayer({ imageUrl: "https://x/plan.png", start: 0, anchor: "top", x: 0, y: 12, width: 78, height: 52, fit: "contain" })
  function renderWithPlan(planLayers: VideoOverlayLayer[]) {
    render(
      <VideoOverlayPreview
        baseUrl="https://x/base.mp4"
        sources={sources}
        layers={layers}
        planLayers={planLayers}
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
  }

  it("draws a live plan layer read-only (the hint, no handles) beneath the slot layers", () => {
    renderWithPlan([planLayer])
    const plan = screen.getByRole("img", { name: "From the layer plan" })
    const slot = screen.getByRole("img", { name: "Layer 1" })
    expect(plan).toHaveAttribute("title", "From the layer plan")
    expect(plan.className).not.toContain("cursor-")
    expect(Number(plan.style.zIndex)).toBeLessThan(Number(slot.style.zIndex))
  })
  it("a plan layer outside its window or without an image is not drawn", () => {
    renderWithPlan([{ ...planLayer, start: 5 }, { ...planLayer, imageUrl: undefined }])
    expect(screen.queryByRole("img", { name: "From the layer plan" })).toBeNull()
  })
})

/**
 * Video layers and a placed base (the preview and the render never
 * disagree about where something sits). A video layer is a bare first frame —
 * muted, inline, metadata only, no controls, no crossOrigin — placed by its
 * own shape once its metadata loads, at the even rect the worker hands the
 * graph; a stack, an edge layout or a base box moves the base itself.
 * 9:16 canvas (1080×1920) in a 400×300 container → scale 0.15625.
 */
describe("VideoOverlayPreview — video layers and a placed base", () => {
  const SCALE = 300 / 1920
  const CLIP = "https://x/clip.mp4"
  const px = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height].map((v) => parseFloat(v))
  const scaled = (r: { left: number; top: number; width: number; height: number }) => [r.left, r.top, r.width, r.height].map((v) => v * SCALE)
  const loadVideo = (el: HTMLVideoElement, w: number, h: number) => {
    Object.defineProperty(el, "videoWidth", { configurable: true, value: w })
    Object.defineProperty(el, "videoHeight", { configurable: true, value: h })
    fireEvent.loadedMetadata(el)
  }

  function renderVideoStage(layers: VideoOverlayLayer[], extra: Partial<Parameters<typeof VideoOverlayPreview>[0]> = {}) {
    return render(
      <VideoOverlayPreview
        baseUrl="https://x/base.mp4"
        sources={layers.map((l) => l.videoUrl ?? l.imageUrl)}
        layers={layers}
        outputAspect="9:16"
        baseFit="cover"
        backgroundColor="#000000"
        fallbackDisplay={{ width: 1920, height: 1080 }}
        selected={null}
        onSelect={vi.fn()}
        onLayerChange={vi.fn()}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        {...extra}
      />,
    )
  }

  it("a video layer draws a muted, inline, metadata-only <video> (no controls, no crossOrigin) at its even drawn rect", () => {
    const layer = expandVideoOverlayLayer({ videoUrl: CLIP, start: 0, anchor: "top-left", x: 3, y: 3, width: 33 })
    renderVideoStage([layer])
    const box = screen.getByRole("img", { name: "Layer 1" })
    const v = box.querySelector("video")!
    // The first frame is asked for with a media fragment on the element only.
    expect(v.getAttribute("src")).toBe(`${CLIP}#t=0.001`)
    expect(v.muted).toBe(true)
    expect(v.hasAttribute("playsinline")).toBe(true)
    expect(v.getAttribute("preload")).toBe("metadata")
    expect(v.hasAttribute("controls")).toBe(false)
    expect(v.hasAttribute("crossorigin")).toBe(false)
    loadVideo(v, 1440, 1080)
    const drawn = evenVideoOverlayRect(resolveVideoOverlayGeometry({ w: 1080, h: 1920 }, layer, 4 / 3).drawn)
    px(screen.getByRole("img", { name: "Layer 1" })).forEach((v, k) => expect(v).toBeCloseTo(scaled(drawn)[k]!, 3))
  })

  it("the first-frame fragment never changes the URL a shape is read under, and a URL with a fragment is left alone", () => {
    expect(videoOverlayFirstFrameSrc(CLIP)).toBe(`${CLIP}#t=0.001`)
    expect(videoOverlayFirstFrameSrc(`${CLIP}#t=2`)).toBe(`${CLIP}#t=2`)
    renderVideoStage([expandVideoOverlayLayer({ videoUrl: CLIP, start: 0 })])
    loadVideo(screen.getByRole("img", { name: "Layer 1" }).querySelector("video")!, 1440, 1080)
    expect(useVideoOverlayAspectStore.getState().aspects).toEqual({ [CLIP]: 4 / 3 })
  })

  it("stack-whole: the base and the layer draw at the stacked rects (16:9 over 1:1 at y 116 and 722)", () => {
    const layer = expandVideoOverlayLayer({ videoUrl: CLIP, start: 0 })
    const { container } = renderVideoStage([layer], { layout: "stack-whole" })
    loadVideo(screen.getByRole("img", { name: "Layer 1" }).querySelector("video")!, 1080, 1080)
    const rects = resolveVideoOverlayStackRects("stack-whole", { w: 1080, h: 1920 }, 16 / 9, 1)
    const base = container.querySelector<HTMLVideoElement>("[data-testid=video-overlay-base]")!
    px(base).forEach((v, k) => expect(v).toBeCloseTo(scaled(evenVideoOverlayRect(rects.top))[k]!, 3))
    px(screen.getByRole("img", { name: "Layer 1" })).forEach((v, k) => expect(v).toBeCloseTo(scaled(evenVideoOverlayRect(rects.bottom))[k]!, 3))
    expect(parseFloat(base.style.top) / SCALE).toBeCloseTo(116, 3)
    expect(base.style.objectFit).toBe("fill")
  })

  it("a stacked layer that starts later still places the base by its shape (its metadata is read off-stage)", () => {
    const layer = expandVideoOverlayLayer({ videoUrl: CLIP, start: 3 })
    const { container } = renderVideoStage([layer], { layout: "stack-whole" })
    expect(screen.queryByRole("img", { name: "Layer 1" })).toBeNull()
    const probe = container.querySelector<HTMLVideoElement>(`video[src="${CLIP}"]`)!
    loadVideo(probe, 1080, 1080)
    const base = container.querySelector<HTMLVideoElement>("[data-testid=video-overlay-base]")!
    expect(parseFloat(base.style.top) / SCALE).toBeCloseTo(116, 3)
  })

  it("a base box moves the base: video-bottom sits flush on the bottom edge (y 1314)", () => {
    const { container } = renderVideoStage([expandVideoOverlayLayer({ imageUrl: "https://x/a.png", start: 0 })], { layout: "video-bottom" })
    const base = container.querySelector<HTMLVideoElement>("[data-testid=video-overlay-base]")!
    px(base).forEach((v, k) => expect(v).toBeCloseTo([0, 1314, 1080, 606].map((n) => n * SCALE)[k]!, 3))
  })

  it("a partial base box written as JSON does not throw; the base fills the stage as before", () => {
    let container!: HTMLElement
    expect(() => {
      container = renderVideoStage([expandVideoOverlayLayer({ imageUrl: "https://x/a.png", start: 0 })], { baseBox: { width: 50 } }).container
    }).not.toThrow()
    const base = container.querySelector<HTMLVideoElement>("[data-testid=video-overlay-base]")!
    expect(base.className).toContain("w-full h-full")
    expect(base.style.left).toBe("")
  })

  it("pip: the first video layer in the bottom-right corner, 30 % wide, whatever box it stores", () => {
    const layer = expandVideoOverlayLayer({ videoUrl: CLIP, start: 0, anchor: "top-left", width: 80 })
    renderVideoStage([layer], { layout: "pip" })
    loadVideo(screen.getByRole("img", { name: "Layer 1" }).querySelector("video")!, 1920, 1080)
    const pip = evenVideoOverlayRect(resolveVideoOverlayGeometry({ w: 1080, h: 1920 }, { anchor: "bottom-right", x: -4, y: -4, width: 30, fit: "contain" }, 16 / 9).drawn)
    px(screen.getByRole("img", { name: "Layer 1" })).forEach((v, k) => expect(v).toBeCloseTo(scaled(pip)[k]!, 3))
  })
})

/**
 * The base moves like a layer — only while it is selected,
 * from the panel's Base video card ("only after selecting it"). Unselected it
 * takes no pointer: the node's body drags the node and a click selects the
 * node, as before the base could move. A selected base is dragged and resized
 * from the box the stage reads it in, writing percentages of the output frame
 * through `onBaseChange(patch, from)` once per frame. 9:16 (1080×1920) in
 * 400×300 → the stage is 168.75 px wide and 300 px tall.
 */
describe("VideoOverlayPreview — the base", () => {
  const STAGE_W = 168.75
  const STAGE_H = 300
  const frame = () => new Promise((r) => setTimeout(r, 40))
  function renderBaseStage(extra: Partial<Parameters<typeof VideoOverlayPreview>[0]> = {}, onNodeClick = vi.fn()) {
    const onBaseChange = vi.fn()
    render(
      <div data-testid="node-wrapper" onClick={onNodeClick}>
        <VideoOverlayPreview
          baseUrl="https://x/base.mp4"
          sources={[]}
          layers={[]}
          outputAspect="9:16"
          baseFit="cover"
          backgroundColor="#000000"
          fallbackDisplay={{ width: 1920, height: 1080 }}
          selected={null}
          onSelect={vi.fn()}
          onLayerChange={vi.fn()}
          baseSelected
          onBaseChange={onBaseChange}
          onReorder={vi.fn()}
          onRemove={vi.fn()}
          {...extra}
        />
      </div>,
    )
    return onBaseChange
  }

  it("unselected, it takes no pointer: a press-drag on the stage writes nothing and a click reaches the node", async () => {
    const onNodeClick = vi.fn()
    const onBaseChange = renderBaseStage({ baseSelected: false }, onNodeClick)
    expect(screen.queryByRole("img", { name: "Base video" })).toBeNull()
    const stageEl = screen.getByRole("group", { name: "Preview" })
    fireEvent.pointerDown(stageEl, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stageEl, { pointerId: 1, clientX: 140, clientY: 160 })
    fireEvent.pointerUp(stageEl, { pointerId: 1 })
    fireEvent.click(stageEl)
    await act(async () => { await frame() })
    expect(onBaseChange).not.toHaveBeenCalled()
    expect(onNodeClick).toHaveBeenCalledTimes(1)
  })

  it("selected, a drag writes x / y as percentages of the output frame, from its drawn rect as a box (Video fit: nothing else moves)", async () => {
    const onBaseChange = renderBaseStage()
    fireEvent.pointerDown(screen.getByRole("img", { name: "Base video" }), { pointerId: 1, clientX: 100, clientY: 100, shiftKey: true })
    fireEvent.pointerMove(screen.getByRole("group", { name: "Preview" }), { pointerId: 1, clientX: 100 + STAGE_W * 0.1, clientY: 100 - STAGE_H * 0.25, shiftKey: true })
    await act(async () => { await frame() })
    expect(onBaseChange).toHaveBeenLastCalledWith({ x: 10, y: -25 }, { anchor: "top-left", x: 0, y: 0, width: 100, height: 100, fit: "cover" })
  })

  it("selected, its corner handle scales it keeping its shape (Video fit: a centred box with no height)", async () => {
    const onBaseChange = renderBaseStage()
    const handle = screen.getByRole("img", { name: "Base video" }).querySelector<HTMLElement>(".cursor-nwse-resize")!
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 160, clientY: 290 })
    fireEvent.pointerMove(screen.getByRole("group", { name: "Preview" }), { pointerId: 2, clientX: 160 - STAGE_W * 0.4, clientY: 290 - STAGE_H * 0.3 })
    await act(async () => { await frame() })
    expect(onBaseChange).toHaveBeenLastCalledWith({ width: 60 }, { anchor: "center", x: 0, y: 0, width: 100, fit: "contain" })
  })

  // A click is not a drag: jitter under the threshold writes nothing — not a
  // base box (a fresh result would read old), not a layer patch (under a
  // layout it would turn the layout Custom).
  it("a click with a 1 px or 0 px jitter writes nothing, on the selected base or on a layer", async () => {
    const onLayerChange = vi.fn()
    const onBaseChange = renderBaseStage({
      layout: "pip",
      layers: [expandVideoOverlayLayer({ videoUrl: "https://x/clip.mp4", start: 0 })],
      sources: ["https://x/clip.mp4"],
      onLayerChange,
    })
    const stageEl = screen.getByRole("group", { name: "Preview" })
    for (const target of [screen.getByRole("img", { name: "Base video" }), screen.getByRole("img", { name: "Layer 1" })]) {
      fireEvent.pointerDown(target, { pointerId: 1, clientX: 50, clientY: 50 })
      fireEvent.pointerMove(stageEl, { pointerId: 1, clientX: 51, clientY: 50 })
      fireEvent.pointerMove(stageEl, { pointerId: 1, clientX: 50, clientY: 50 })
      fireEvent.pointerUp(stageEl, { pointerId: 1 })
    }
    await act(async () => { await frame() })
    expect(onBaseChange).not.toHaveBeenCalled()
    expect(onLayerChange).not.toHaveBeenCalled()
  })

  it("is not movable without an output aspect, or with no writer", () => {
    renderBaseStage({ outputAspect: undefined })
    expect(screen.queryByRole("img", { name: "Base video" })).toBeNull()
    cleanup()
    renderBaseStage({ onBaseChange: undefined })
    expect(screen.queryByRole("img", { name: "Base video" })).toBeNull()
  })

  it("an unreadable mark is cleared when the clip's shape is later read by any reader", () => {
    useVideoOverlayAspectStore.getState().markUnreadable("https://x/late.mp4")
    expect(useVideoOverlayAspectStore.getState().unreadable).toEqual({ "https://x/late.mp4": true })
    useVideoOverlayAspectStore.getState().setAspect("https://x/late.mp4", 16 / 9)
    expect(useVideoOverlayAspectStore.getState().unreadable).toEqual({})
    // And a shape already read is never marked unreadable.
    useVideoOverlayAspectStore.getState().markUnreadable("https://x/late.mp4")
    expect(useVideoOverlayAspectStore.getState().unreadable).toEqual({})
  })

  it("a clip the browser cannot read is marked unreadable (load error, or no metadata in time)", () => {
    vi.useFakeTimers()
    try {
      const { unmount } = render(<VideoOverlayShapeProbe url="https://x/broken.mp4" />)
      fireEvent.error(document.querySelector<HTMLVideoElement>('video[src="https://x/broken.mp4"]')!)
      expect(useVideoOverlayAspectStore.getState().unreadable).toEqual({ "https://x/broken.mp4": true })
      unmount()
      render(<VideoOverlayShapeProbe url="https://x/slow.mp4" />)
      vi.advanceTimersByTime(VIDEO_OVERLAY_SHAPE_PROBE_TIMEOUT_MS)
      expect(useVideoOverlayAspectStore.getState().unreadable["https://x/slow.mp4"]).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
