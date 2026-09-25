"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useT } from "@/lib/i18n"
import {
  VIDEO_OVERLAY_BOUNDS,
  hasDrawableVideoOverlayBox,
  resolveVideoOverlayGeometry,
  videoOverlayCanvas,
  videoOverlayRenderOrder,
  type VideoOverlayFit,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayOutputAspect,
} from "@nodaro/shared"
import { snapBox, type Rect } from "@/lib/image-overlay-snap"
import { isEditableTarget } from "@/lib/dom-editable"

const SNAP_PX = 6
const HANDLE = "nodrag nopan absolute w-3 h-3 rounded-full bg-white border-2 border-[#ff0073] shadow"
const clamp = (v: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, Math.round(v * 10) / 10))

/** A layer is on the stage at time `t` when `t` is inside its [start, end) window. */
export function videoOverlayLayerLive(layer: Pick<VideoOverlayLayer, "start" | "end">, t: number): boolean {
  return t >= layer.start && (layer.end === undefined || t < layer.end)
}

export interface VideoOverlayPreviewProps {
  readonly baseUrl: string
  /** Per slot, the image it draws: the wired handle's, else its own imageUrl. */
  readonly sources: ReadonlyArray<string | undefined>
  /** Per slot, the EXPANDED layer (the default badge for an untouched slot). */
  readonly layers: ReadonlyArray<VideoOverlayLayer>
  readonly outputAspect?: VideoOverlayOutputAspect
  readonly baseFit: VideoOverlayFit
  readonly backgroundColor: string
  /** The probed display size, used until the stage's own <video> reports one (and if it never loads). */
  readonly fallbackDisplay?: { width: number; height: number }
  readonly selected: number | null
  readonly onSelect: (index: number | null) => void
  readonly onLayerChange: (index: number, patch: VideoOverlayLayerInput) => void
  readonly onReorder: (index: number, direction: "up" | "down") => void
  readonly onRemove: (index: number) => void
}

type Drag =
  | { kind: "move"; index: number; startX: number; startY: number; x0: number; y0: number; box0: Rect; stageRect: Rect }
  | { kind: "resize"; index: number; startX: number; startY: number; w0: number; h0?: number }

/**
 * The live placement stage (UX §3): the base video's frame with the layers
 * drawn from the node's own settings, through the SAME geometry the worker
 * renders with (`resolveVideoOverlayGeometry`, @nodaro/shared) on the same
 * canvas (`videoOverlayCanvas`) — no server call. One time: the selected
 * layer's start (selecting seeks the video there), else 0; only the layers
 * live at that time are drawn (D5) — the panel's timeline reaches the rest.
 * No native controls, no crossOrigin (the stage never reads pixels). Dragging
 * writes x / y, the corner handle writes width (and height when set); a box
 * edit on a preset layer turns it Custom through the layers writer.
 */
export function VideoOverlayPreview(p: VideoOverlayPreviewProps) {
  const t = useT()
  const { onLayerChange, onSelect } = p
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [container, setContainer] = useState({ w: 0, h: 0 })
  const [display, setDisplay] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [aspects, setAspects] = useState<Record<number, number>>({})
  const [guides, setGuides] = useState<{ v: readonly number[]; h: readonly number[] }>({ v: [], h: [] })
  const dragRef = useRef<Drag | null>(null)
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null)
  const zoomRef = useRef(1)
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef<Map<number, VideoOverlayLayerInput>>(new Map())

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
  const canvas = useMemo(
    () => videoOverlayCanvas(display ?? p.fallbackDisplay ?? null, p.outputAspect) ?? { w: 1920, h: 1080 },
    [display, p.fallbackDisplay, p.outputAspect],
  )
  const stage = useMemo(() => {
    if (container.w <= 0 || container.h <= 0) return null
    const scale = Math.min(container.w / canvas.w, container.h / canvas.h)
    const w = canvas.w * scale
    const h = canvas.h * scale
    return { left: (container.w - w) / 2, top: (container.h - h) / 2, w, h, scale }
  }, [container, canvas])

  // One store write per animation frame; patches coalesce per layer.
  const flush = useCallback(() => {
    frameRef.current = null
    const pending = pendingRef.current
    pendingRef.current = new Map()
    for (const [index, patch] of pending) onLayerChange(index, patch)
  }, [onLayerChange])

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
      const el = containerRef.current
      zoomRef.current = el && el.clientWidth > 0 ? el.getBoundingClientRect().width / el.clientWidth : 1
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      captureRef.current = { el: target, pointerId: e.pointerId }
      onSelect(d.index)
    },
    [onSelect],
  )

  // Each slot at its OWN position (slot = i + 1), whatever a JSON writer stored
  // in `slot` — the engine assemblies stamp the same, so the stage and the
  // render stack alike.
  const order = videoOverlayRenderOrder(p.layers.map((l, i) => ({ zIndex: l?.zIndex, slot: i + 1 })))
  const videoFit = p.outputAspect ? (p.baseFit === "contain" ? "contain" : "cover") : "fill"
  const selectedDrawn = p.selected !== null && !!p.sources[p.selected] && !!p.layers[p.selected] && hasDrawableVideoOverlayBox(p.layers[p.selected]) && videoOverlayLayerLive(p.layers[p.selected]!, time)

  return (
    <div
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
              src={p.baseUrl}
              muted
              playsInline
              preload="metadata"
              className="w-full h-full pointer-events-none"
              style={{ objectFit: videoFit }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth > 0 && v.videoHeight > 0) setDisplay({ width: v.videoWidth, height: v.videoHeight })
              }}
              onError={() => setFailed(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/30 px-3 text-center text-[10px] text-muted-foreground">
              {t("node.videoOverlayPreviewUnavailable")}
            </div>
          )}
          {guides.v.map((f, i) => <div key={`v${i}`} className="absolute top-0 bottom-0 w-px bg-[#ff0073] pointer-events-none" style={{ left: `${f * 100}%` }} />)}
          {guides.h.map((f, i) => <div key={`h${i}`} className="absolute left-0 right-0 h-px bg-[#ff0073] pointer-events-none" style={{ top: `${f * 100}%` }} />)}
          {order.map((i, z) => {
            const layer = p.layers[i]
            const url = p.sources[i]
            if (!layer || !url || !videoOverlayLayerLive(layer, time)) return null
            // A partial box saved from workflow JSON is stored as written (the
            // validator answers incomplete_box, the layer card shows it) — the
            // geometry would throw on it and take the whole canvas down.
            if (!hasDrawableVideoOverlayBox(layer)) return null
            const { drawn } = resolveVideoOverlayGeometry(canvas, layer, aspects[i] ?? 1)
            const s = stage.scale
            const isSel = p.selected === i
            return (
              <div
                key={i}
                className={`nodrag nopan absolute ${isSel ? "cursor-move" : "cursor-pointer"}`}
                style={{ left: drawn.left * s, top: drawn.top * s, width: drawn.width * s, height: drawn.height * s, zIndex: 1 + z, opacity: layer.opacity }}
                onPointerDown={(e) => {
                  containerRef.current?.focus({ preventScroll: true })
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const c = containerRef.current!.getBoundingClientRect()
                  const zoom = containerRef.current!.clientWidth > 0 ? c.width / containerRef.current!.clientWidth : 1
                  const stageRect: Rect = { left: c.left + stage.left * zoom, top: c.top + stage.top * zoom, width: stage.w * zoom, height: stage.h * zoom }
                  start(e, { kind: "move", index: i, startX: e.clientX, startY: e.clientY, x0: layer.x, y0: layer.y, box0: { left: r.left, top: r.top, width: r.width, height: r.height }, stageRect })
                }}
                onClick={(e) => e.stopPropagation()}
                role="img"
                aria-label={t("overlayEditor.layerN", { n: i + 1 })}
              >
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  className="w-full h-full pointer-events-none"
                  style={{ objectFit: layer.fit === "cover" ? "cover" : "fill" }}
                  onLoad={(e) => {
                    const img = e.currentTarget
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      const a = img.naturalWidth / img.naturalHeight
                      setAspects((prev) => (prev[i] === a ? prev : { ...prev, [i]: a }))
                    }
                  }}
                />
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
          <span className="text-[10px] font-medium px-1">{t("overlayEditor.layerN", { n: p.selected! + 1 })}</span>
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
