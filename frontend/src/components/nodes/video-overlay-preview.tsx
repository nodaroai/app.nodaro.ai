"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useT } from "@/lib/i18n"
import {
  VIDEO_OVERLAY_BOUNDS,
  videoOverlayCanvas,
  type VideoOverlayBox,
  type VideoOverlayBoxInput,
  type VideoOverlayFit,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayOutputAspect,
} from "@nodaro/shared/video"
import { snapBox, type Rect } from "@/lib/image-overlay-snap"
import { isEditableTarget } from "@/lib/dom-editable"
import { resolveVideoOverlayStage, type VideoOverlayStageItem } from "@/lib/video-overlay-stage"
import { useVideoOverlayAspectStore } from "@/hooks/use-video-overlay-aspects"
import { UPSTREAM_VIDEO_PROBE_TIMEOUT_MS } from "@/hooks/use-upstream-video-probe"

const SNAP_PX = 6
/**
 * How far the pointer must travel (screen px) before a press becomes a drag.
 * A click — a trackpad's or a pen's jitter included — writes nothing: no box
 * (the base's whole-frame box would otherwise be stored by a click, marking a
 * fresh result old), no layout turned Custom.
 */
const DRAG_THRESHOLD_PX = 3
const HANDLE = "nodrag nopan absolute w-3 h-3 rounded-full bg-white border-2 border-[#ff0073] shadow"
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, Math.round(v * 10) / 10))

/** A layer is on the stage at time `t` when `t` is inside its [start, end) window. */
export function videoOverlayLayerLive(layer: Pick<VideoOverlayLayer, "start" | "end">, t: number): boolean {
  return t >= layer.start && (layer.end === undefined || t < layer.end)
}

export interface VideoOverlayPreviewProps {
  readonly baseUrl: string
  /** Per slot, the file it draws: the wired handle's, else its own imageUrl or videoUrl. */
  readonly sources: ReadonlyArray<string | undefined>
  /** Per slot, the EXPANDED layer as the run assembles it (the default badge for an untouched slot); a video layer carries its `videoUrl`. */
  readonly layers: ReadonlyArray<VideoOverlayLayer>
  /** The wired layer plan's EXPANDED layers (each with its own `imageUrl` or `videoUrl`): drawn under the slot layers, read-only — no selection, no drag handles. */
  readonly planLayers?: ReadonlyArray<VideoOverlayLayer>
  readonly outputAspect?: VideoOverlayOutputAspect
  readonly baseFit: VideoOverlayFit
  readonly backgroundColor: string
  /** As stored: a named layout writes the boxes, as the render does. */
  readonly layout?: string | null
  /** As stored: where the base sits (a partial box draws the base as before). */
  readonly baseBox?: VideoOverlayBoxInput | null
  /** The probed display size, used until the stage's own <video> reports one (and if it never loads). */
  readonly fallbackDisplay?: { width: number; height: number }
  readonly selected: number | null
  readonly onSelect: (index: number | null) => void
  readonly onLayerChange: (index: number, patch: VideoOverlayLayerInput) => void
  /**
   * The base is selected (from the panel's Base video card): only then is it
   * movable here. Unselected, the base takes no pointer at all — the node's
   * body drags the node and a click selects the node, as before.
   */
  readonly baseSelected?: boolean
  /** Ties the base's handle area to its node, so a click on it does not read as a click outside it. */
  readonly baseMarker?: string
  /** A drag or resize of the selected base writes its box through this (the layers writer's `setBaseBox`), with the box it started from. */
  readonly onBaseChange?: (patch: VideoOverlayBoxInput, from: VideoOverlayBox) => void
  readonly onReorder: (index: number, direction: "up" | "down") => void
  readonly onRemove: (index: number) => void
}

/** The base's index in a drag and the write queue (a layer's is its 0-based slot). */
const BASE = -1

type Drag =
  | { kind: "move"; index: number; startX: number; startY: number; x0: number; y0: number; box0: Rect; stageRect: Rect }
  | { kind: "resize"; index: number; startX: number; startY: number; w0: number; h0?: number }

const NO_PLAN_LAYERS: ReadonlyArray<VideoOverlayLayer> = []

/**
 * A layer video's `src` on the stage: a `#t=0.001` media fragment asks the
 * browser for its first frame (Safari shows black until a video is seeked).
 * The stage element's only — the layer's URL in the request, the composition
 * key and the aspect map stays the plain one. A URL that already has a
 * fragment is left alone.
 */
export function videoOverlayFirstFrameSrc(url: string): string {
  return url.includes("#") ? url : `${url}#t=0.001`
}

/** How long a shape read may take before the clip counts as unreadable (the upstream probe's own limit). */
export const VIDEO_OVERLAY_SHAPE_PROBE_TIMEOUT_MS = UPSTREAM_VIDEO_PROBE_TIMEOUT_MS

/**
 * Reads a video's shape for the stage without drawing it: a hidden,
 * metadata-only `<video>` that writes its aspect to the shared store. A stack
 * places the base by its first video layer's shape for the whole run, so that
 * shape is read even while the layer is not on the stage — and by the panel
 * while the node shows its result, so a stack can be turned Custom. A clip the
 * browser cannot decode (a load error, no metadata in time) is marked
 * unreadable, so the canvas stops waiting and says why.
 */
export function VideoOverlayShapeProbe({ url }: { url: string }) {
  const onAspect = useVideoOverlayAspectStore((s) => s.setAspect)
  const markUnreadable = useVideoOverlayAspectStore((s) => s.markUnreadable)
  useEffect(() => {
    const timer = setTimeout(() => markUnreadable(url), VIDEO_OVERLAY_SHAPE_PROBE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [url, markUnreadable])
  return (
    <video
      src={url}
      muted
      playsInline
      preload="metadata"
      className="hidden"
      aria-hidden
      onLoadedMetadata={(e) => {
        const v = e.currentTarget
        if (v.videoWidth > 0 && v.videoHeight > 0) onAspect(url, v.videoWidth / v.videoHeight)
        else markUnreadable(url)
      }}
      onError={() => markUnreadable(url)}
    />
  )
}

/** How a placed picture fills its rect: `cover` crops, `contain` is scaled to the rect (the rect already has its aspect). */
const objectFitOf = (fit: VideoOverlayFit): "cover" | "fill" => (fit === "cover" ? "cover" : "fill")

/**
 * One layer's picture: an image, or a video showing its first frame — muted,
 * no controls, metadata only, no crossOrigin (the stage never reads pixels).
 * Its natural shape is reported once known (an image's `load`, a video's
 * `loadedmetadata`): the geometry places it by that aspect.
 */
function LayerPicture({ item, onAspect }: { item: VideoOverlayStageItem; onAspect: (url: string, aspect: number) => void }) {
  const style = { objectFit: objectFitOf(item.fit) }
  if (item.video) {
    return (
      <video
        src={videoOverlayFirstFrameSrc(item.url)}
        muted
        playsInline
        preload="metadata"
        className="w-full h-full pointer-events-none"
        style={style}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (v.videoWidth > 0 && v.videoHeight > 0) onAspect(item.url, v.videoWidth / v.videoHeight)
        }}
      />
    )
  }
  return (
    <img
      src={item.url}
      alt=""
      draggable={false}
      className="w-full h-full pointer-events-none"
      style={style}
      onLoad={(e) => {
        const img = e.currentTarget
        if (img.naturalWidth > 0 && img.naturalHeight > 0) onAspect(item.url, img.naturalWidth / img.naturalHeight)
      }}
    />
  )
}

/**
 * The live placement stage (UX §3): the base video's frame with the layers
 * drawn from the node's own settings, through the SAME placement the worker
 * renders with (`resolveVideoOverlayStage`: a layout's boxes, a stack, a
 * placed base and every video layer by `placeVideoOverlayVideos`, every image
 * layer by `resolveVideoOverlayGeometry`, @nodaro/shared) on the same canvas
 * (`videoOverlayCanvas`) — no server call. A video layer shows its first
 * frame. One time: the selected layer's start (selecting seeks the base
 * there), else 0; only the layers live at that time are drawn (D5) — the
 * panel's timeline reaches the rest. No native controls, no crossOrigin (the
 * stage never reads pixels). Dragging writes x / y, the corner handle writes
 * width (and height when set); a box edit on a preset layer turns it Custom
 * through the layers writer. With an output aspect the BASE moves the same
 * way (`onBaseChange` → its `baseBox`), but only while it is selected from
 * the panel's Base video card (`baseSelected`): it is the bottom of the stage,
 * so a layer over it takes the pointer first; it starts from the box the stage
 * reads it in (`baseFrame`), and is not movable while that is not known.
 */
export function VideoOverlayPreview(p: VideoOverlayPreviewProps) {
  const t = useT()
  const { onLayerChange, onSelect, onBaseChange } = p
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [container, setContainer] = useState({ w: 0, h: 0 })
  const [display, setDisplay] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState(false)
  // A drawn picture's natural aspect, by its URL (a URL is one file, whichever
  // slot draws it) — shared with the panel and the layers writer, which keep
  // a stack's rects by the same shapes.
  const aspects = useVideoOverlayAspectStore((s) => s.aspects)
  const onAspect = useVideoOverlayAspectStore((s) => s.setAspect)
  const [guides, setGuides] = useState<{ v: readonly number[]; h: readonly number[] }>({ v: [], h: [] })
  const dragRef = useRef<Drag | null>(null)
  // Set once the pointer has travelled past DRAG_THRESHOLD_PX in this drag.
  const movedRef = useRef(false)
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null)
  const zoomRef = useRef(1)
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef<Map<number, VideoOverlayLayerInput>>(new Map())
  // The box a base gesture started from (its move or resize box): the writer starts from it until the base has a box of its own.
  const baseFromRef = useRef<VideoOverlayBox | null>(null)

  useEffect(() => {
    setDisplay(null)
    setFailed(false)
  }, [p.baseUrl])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect
      setContainer({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The output canvas in px — what the worker renders onto — and the stage:
  // that canvas contained in the node.
  const baseDisplay = display ?? p.fallbackDisplay ?? null
  const canvas = useMemo(() => videoOverlayCanvas(baseDisplay, p.outputAspect) ?? { w: 1920, h: 1080 }, [baseDisplay, p.outputAspect])
  const stage = useMemo(() => {
    if (container.w <= 0 || container.h <= 0) return null
    const scale = Math.min(container.w / canvas.w, container.h / canvas.h)
    const w = canvas.w * scale
    const h = canvas.h * scale
    return { left: (container.w - w) / 2, top: (container.h - h) / 2, w, h, scale }
  }, [container, canvas])

  const planLayers = p.planLayers ?? NO_PLAN_LAYERS
  // Every picture's place on the output canvas, as the render places it.
  const placed = useMemo(
    () =>
      resolveVideoOverlayStage({
        canvas,
        outputAspect: p.outputAspect,
        layout: p.layout,
        baseBox: p.baseBox,
        baseFit: p.baseFit,
        ...(baseDisplay && baseDisplay.width > 0 && baseDisplay.height > 0 ? { baseAspect: baseDisplay.width / baseDisplay.height } : {}),
        planLayers,
        layers: p.layers,
        sources: p.sources,
        aspectOf: (url) => aspects[url],
      }),
    [canvas, p.outputAspect, p.layout, p.baseBox, p.baseFit, baseDisplay, planLayers, p.layers, p.sources, aspects],
  )

  // One store write per animation frame; patches coalesce per layer.
  const flush = useCallback(() => {
    frameRef.current = null
    const pending = pendingRef.current
    pendingRef.current = new Map()
    for (const [index, patch] of pending) {
      if (index !== BASE) onLayerChange(index, patch)
      else if (baseFromRef.current) onBaseChange?.(patch, baseFromRef.current)
    }
  }, [onLayerChange, onBaseChange])

  const queue = useCallback(
    (index: number, patch: VideoOverlayLayerInput) => {
      pendingRef.current.set(index, { ...(pendingRef.current.get(index) ?? {}), ...patch })
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush)
    },
    [flush],
  )

  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current) }, [])

  // The stage's one time, and seek-on-select: the frame under the selected
  // layer is the frame it appears on.
  const time = p.selected !== null && p.layers[p.selected] ? p.layers[p.selected]!.start : 0
  useEffect(() => {
    const v = videoRef.current
    if (!v || !display) return
    if (Math.abs(v.currentTime - time) > 0.01) v.currentTime = time
  }, [time, display])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d || !stage) return
      e.preventDefault()
      if (!movedRef.current) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return
        movedRef.current = true
      }
      const z = zoomRef.current
      if (d.kind === "move") {
        let dx = e.clientX - d.startX
        let dy = e.clientY - d.startY
        if (!e.shiftKey) {
          const predicted: Rect = { left: d.box0.left + dx, top: d.box0.top + dy, width: d.box0.width, height: d.box0.height }
          const snap = snapBox(predicted, d.stageRect, undefined, SNAP_PX)
          dx += snap.dx
          dy += snap.dy
          setGuides((g) => (g.v[0] === snap.vertical[0] && g.h[0] === snap.horizontal[0] && g.v.length === snap.vertical.length && g.h.length === snap.horizontal.length ? g : { v: snap.vertical, h: snap.horizontal }))
        } else {
          setGuides((g) => (g.v.length || g.h.length ? { v: [], h: [] } : g))
        }
        // Offsets are % of the OUTPUT canvas.
        queue(d.index, {
          x: clamp(d.x0 + (dx / (stage.w * z)) * 100, VIDEO_OVERLAY_BOUNDS.x),
          y: clamp(d.y0 + (dy / (stage.h * z)) * 100, VIDEO_OVERLAY_BOUNDS.y),
        })
      } else {
        const patch: VideoOverlayLayerInput = { width: clamp(d.w0 + ((e.clientX - d.startX) / (stage.w * z)) * 100, VIDEO_OVERLAY_BOUNDS.width) }
        if (d.h0 !== undefined) patch.height = clamp(d.h0 + ((e.clientY - d.startY) / (stage.h * z)) * 100, VIDEO_OVERLAY_BOUNDS.height)
        queue(d.index, patch)
      }
    },
    [stage, queue],
  )

  const endDrag = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    setGuides((g) => (g.v.length || g.h.length ? { v: [], h: [] } : g))
    const cap = captureRef.current
    captureRef.current = null
    if (cap && cap.el.hasPointerCapture(cap.pointerId)) cap.el.releasePointerCapture(cap.pointerId)
  }, [])

  const start = useCallback(
    (e: React.PointerEvent, d: Drag) => {
      e.stopPropagation()
      e.preventDefault()
      dragRef.current = d
      movedRef.current = false
      const el = containerRef.current
      zoomRef.current = el && el.clientWidth > 0 ? el.getBoundingClientRect().width / el.clientWidth : 1
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      captureRef.current = { el: target, pointerId: e.pointerId }
      // A layer press selects the layer (the base is deselected with it); the base is already selected.
      if (d.index !== BASE) onSelect(d.index)
    },
    [onSelect],
  )

  /** A move starting on the element under the pointer: its rect and the stage's, in screen pixels (for snapping). */
  const moveFrom = (e: React.PointerEvent, index: number, x0: number, y0: number): Drag | null => {
    const el = containerRef.current
    if (!el || !stage) return null
    containerRef.current?.focus({ preventScroll: true })
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const c = el.getBoundingClientRect()
    const zoom = el.clientWidth > 0 ? c.width / el.clientWidth : 1
    const stageRect: Rect = { left: c.left + stage.left * zoom, top: c.top + stage.top * zoom, width: stage.w * zoom, height: stage.h * zoom }
    return { kind: "move", index, startX: e.clientX, startY: e.clientY, x0, y0, box0: { left: r.left, top: r.top, width: r.width, height: r.height }, stageRect }
  }
  const baseFrame = onBaseChange && p.baseSelected ? placed.baseFrame : undefined

  const videoFit = p.outputAspect ? (p.baseFit === "contain" ? "contain" : "cover") : "fill"
  const selectedItem = p.selected !== null ? placed.items[planLayers.length + p.selected] : undefined
  const selectedDrawn = !!selectedItem?.drawn && videoOverlayLayerLive(selectedItem.layer, time)
  // A stack places the base by its first video layer's shape for the whole
  // run, so that video's metadata is read even while it is not on the stage.
  const stackedItem = placed.stacked >= 0 ? placed.items[placed.stacked] : undefined
  const stackedOffStage = !!stackedItem && !videoOverlayLayerLive(stackedItem.layer, time)

  return (
    <div role="group" aria-label={t("common.preview")}
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Delete" && e.key !== "Backspace") return
        if (isEditableTarget(e.target)) return
        // The selected LAYER is what Delete means on the stage — never the node.
        e.preventDefault()
        e.stopPropagation()
        if (p.selected !== null) p.onRemove(p.selected)
      }}
      className="relative w-full h-full overflow-hidden rounded-xl bg-black/20 select-none outline-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => onSelect(null)}
    >
      {stage && (
        <div
          className="absolute overflow-hidden"
          style={{ left: stage.left, top: stage.top, width: stage.w, height: stage.h, background: p.outputAspect ? p.backgroundColor : "#000000" }}
        >
          {!failed ? (
            <video
              ref={videoRef}
              data-testid="video-overlay-base"
              src={p.baseUrl}
              muted
              playsInline
              preload="metadata"
              className={placed.base ? "absolute pointer-events-none" : "w-full h-full pointer-events-none"}
              style={
                placed.base
                  ? {
                      left: placed.base.drawn.left * stage.scale,
                      top: placed.base.drawn.top * stage.scale,
                      width: placed.base.drawn.width * stage.scale,
                      height: placed.base.drawn.height * stage.scale,
                      objectFit: objectFitOf(placed.base.fit),
                    }
                  : { objectFit: videoFit }
              }
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth > 0 && v.videoHeight > 0) {
                  setDisplay({ width: v.videoWidth, height: v.videoHeight })
                  onAspect(p.baseUrl, v.videoWidth / v.videoHeight)
                }
              }}
              onError={() => setFailed(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/30 px-3 text-center text-[11px] text-muted-foreground">
              {t("node.videoOverlayPreviewUnavailable")}
            </div>
          )}
          {stackedItem && stackedOffStage && <VideoOverlayShapeProbe url={stackedItem.url} />}
          {baseFrame && (
            // The SELECTED base's handle area (selected from the Base video card; an
            // unselected base renders none): under every layer — they take the pointer first — over its picture.
            <div
              className="nodrag nopan absolute cursor-move"
              style={{ left: baseFrame.drawn.left * stage.scale, top: baseFrame.drawn.top * stage.scale, width: baseFrame.drawn.width * stage.scale, height: baseFrame.drawn.height * stage.scale, zIndex: 0 }}
              role="img"
              aria-label={t("proccfg.videoOverlay.baseCard.title")}
              data-video-overlay-base={p.baseMarker}
              onPointerDown={(e) => {
                const d = moveFrom(e, BASE, baseFrame.box.x, baseFrame.box.y)
                if (!d) return
                baseFromRef.current = baseFrame.box
                start(e, d)
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute inset-0 border border-[#ff0073] pointer-events-none" />
              <div
                className={`${HANDLE} -right-1.5 -bottom-1.5 cursor-nwse-resize`}
                onPointerDown={(e) => {
                  baseFromRef.current = baseFrame.resizeBox
                  start(e, { kind: "resize", index: BASE, startX: e.clientX, startY: e.clientY, w0: baseFrame.resizeBox.width, h0: baseFrame.resizeBox.height })
                }}
              />
            </div>
          )}
          {guides.v.map((f, i) => <div key={`v${i}`} className="absolute top-0 bottom-0 w-px bg-[#ff0073] pointer-events-none" style={{ left: `${f * 100}%` }} />)}
          {guides.h.map((f, i) => <div key={`h${i}`} className="absolute left-0 right-0 h-px bg-[#ff0073] pointer-events-none" style={{ top: `${f * 100}%` }} />)}
          {placed.order.map((entry, z) => {
            // A partial box saved from workflow JSON is stored as written (the
            // validator answers incomplete_box, the layer card shows it): the
            // stage resolves it to no rect rather than throwing — a throw here
            // would take the whole canvas down.
            const item = placed.items[entry]
            if (!item?.drawn || !videoOverlayLayerLive(item.layer, time)) return null
            const { drawn } = item
            const s = stage.scale
            const box = { left: drawn.left * s, top: drawn.top * s, width: drawn.width * s, height: drawn.height * s, zIndex: 1 + z, opacity: item.layer.opacity }
            if (entry < planLayers.length) {
              // A plan layer: read-only, no selection or drag handles.
              return (
                <div key={`plan${entry}`} className="absolute" title={t("node.videoOverlayFromPlan")} style={box} role="img" aria-label={t("node.videoOverlayFromPlan")}>
                  <LayerPicture item={item} onAspect={onAspect} />
                </div>
              )
            }
            const i = entry - planLayers.length
            const isSel = p.selected === i
            const { layer } = item
            return (
              <div
                key={i}
                className={`nodrag nopan absolute ${isSel ? "cursor-move" : "cursor-pointer"}`}
                style={box}
                onPointerDown={(e) => {
                  const d = moveFrom(e, i, layer.x, layer.y)
                  if (d) start(e, d)
                }}
                onClick={(e) => e.stopPropagation()}
                role="img"
                aria-label={t("overlayEditor.layerN", { n: i + 1 })}
              >
                <LayerPicture item={item} onAspect={onAspect} />
                {isSel && (
                  <>
                    <div className="absolute inset-0 border border-[#ff0073] pointer-events-none" />
                    <div
                      className={`${HANDLE} -right-1.5 -bottom-1.5 cursor-nwse-resize`}
                      onPointerDown={(e) => start(e, { kind: "resize", index: i, startX: e.clientX, startY: e.clientY, w0: layer.width, h0: layer.height })}
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {selectedDrawn && (
        <div
          className="nodrag nopan absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/60 backdrop-blur-sm border border-white/10 text-white"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-[11px] font-medium px-1">{t("overlayEditor.layerN", { n: p.selected! + 1 })}</span>
          <button type="button" className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/15" title={t("overlayEditor.bringForward")} aria-label={t("overlayEditor.bringForward")} onClick={() => p.onReorder(p.selected!, "up")}>
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/15" title={t("overlayEditor.sendBackward")} aria-label={t("overlayEditor.sendBackward")} onClick={() => p.onReorder(p.selected!, "down")}>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
