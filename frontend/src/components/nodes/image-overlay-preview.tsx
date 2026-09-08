"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react"
import { useT } from "@/lib/i18n"
import { CachedImage } from "@/components/ui/cached-image"
import { resolveOverlayGeometry, overlayRenderOrder, clampOverlayEdit, normalizeOverlayLayer } from "@/lib/image-overlay-geometry"
import { DEFAULT_OVERLAY_TEXT as DEFAULT_TEXT_STYLE, DEFAULT_OVERLAY_QR as DEFAULT_QR_STYLE, DEFAULT_OVERLAY_SHAPE as DEFAULT_SHAPE_STYLE } from "@nodaro/shared"
import { snapBox, type Rect } from "@/lib/image-overlay-snap"
import { isEditableTarget } from "@/lib/dom-editable"
import { qrLinkLabel } from "@/lib/image-overlay-labels"

const SNAP_PX = 6
import { DEFAULT_OVERLAY_LAYER, type OverlayLayerConfig } from "@/types/nodes"
import { TextLayerPreview, QrLayerPreview, ShapeLayerPreview, imageEffectStyle, hexToRgba } from "./image-overlay-kinds"

/**
 * The live composite: the base image with every connected layer drawn on it
 * from the node's OWN settings — no server call. Dragging a layer writes its
 * x/y back (a plain delta, because the anchor offsets are additive), the
 * corner handle writes width (and height when set), the top handle writes
 * rotation. Drawn with the same placement math the worker uses
 * (lib/image-overlay-geometry.ts ↔ backend overlay.ts), so what you see here
 * is what the run produces.
 */
export interface ImageOverlayPreviewProps {
  readonly baseUrl: string
  /** Indexed by handle: [0] ↔ overlay, [1] ↔ overlay2 … sparse when unwired. */
  readonly layerUrls: ReadonlyArray<string | undefined>
  readonly layers: ReadonlyArray<OverlayLayerConfig>
  readonly selected: number | null
  readonly onSelect: (index: number | null) => void
  readonly onLayerChange: (index: number, patch: Partial<OverlayLayerConfig>) => void
  readonly onReorder: (index: number, direction: "up" | "down") => void
  /** Delete / Backspace on the stage with a layer selected. */
  readonly onRemove?: (index: number) => void
  /** The "edit" chip under a selected QR: jump to its link field. */
  readonly onEditContent?: (index: number) => void
  /** Text wired into the node's QR link handle — what fromInput QR layers show. */
  readonly qrText?: string
  readonly onBaseDimensions?: (dim: { width: number; height: number }) => void
  /** Output canvas: the stage becomes this size and the base is fitted into it. */
  readonly canvas?: { width: number; height: number; backgroundColor: string }
  readonly baseFit?: "contain" | "cover"
  /** Always-visible region of the canvas, as fractions — drawn as a dashed box and used for snapping. */
  readonly safeArea?: { x: number; y: number; w: number; h: number }
  /** Per-device viewports (YouTube banner: TV / desktop / all devices), drawn as labelled nested boxes. */
  readonly zones?: ReadonlyArray<{ id: "tv" | "desktop" | "all"; x: number; y: number; w: number; h: number }>
}

type Drag =
  | { kind: "move"; index: number; startX: number; startY: number; x0: number; y0: number; box0: Rect; stageRect: Rect; safeRect?: Rect }
  | { kind: "scale-text"; index: number; startX: number; w0: number; f0: number }
  | { kind: "resize"; index: number; startX: number; startY: number; w0: number; h0?: number }
  | { kind: "rotate"; index: number; cx: number; cy: number }

const HANDLE = "nodrag nopan absolute w-3 h-3 rounded-full bg-white border-2 border-[#ff0073] shadow"

export function ImageOverlayPreview(p: ImageOverlayPreviewProps) {
  const t = useT()
  const { onLayerChange, onSelect } = p
  const containerRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState({ w: 0, h: 0 })
  const [base, setBase] = useState<{ w: number; h: number } | null>(null)
  const [aspects, setAspects] = useState<Record<number, number>>({})
  const [guides, setGuides] = useState<{ v: readonly number[]; h: readonly number[] }>({ v: [], h: [] })
  const dragRef = useRef<Drag | null>(null)
  /** The element holding pointer capture for the current drag. */
  const captureRef = useRef<{ el: HTMLElement; pointerId: number } | null>(null)
  /** Screen px per layout px of the stage at drag start (React Flow zoom). */
  const zoomRef = useRef(1)
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef<Map<number, Partial<OverlayLayerConfig>>>(new Map())

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      setContainer({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The stage is the OUTPUT: the base image contained in the container, or —
  // with an output canvas — the canvas contained in the container with the
  // base fitted inside it (contain letterboxes, cover fills). Layers are
  // placed relative to the BASE rectangle, exactly as the worker does;
  // `stage.scale` is the base's display scale.
  const stage = useMemo(() => {
    if (!base || container.w <= 0 || container.h <= 0) return null
    const canvas = p.canvas
    if (!canvas) {
      const scale = Math.min(container.w / base.w, container.h / base.h)
      const w = base.w * scale
      const h = base.h * scale
      const left = (container.w - w) / 2
      const top = (container.h - h) / 2
      return { left, top, w, h, scale, baseLeft: 0, baseTop: 0, baseW: w, baseH: h }
    }
    const cs = Math.min(container.w / canvas.width, container.h / canvas.height)
    const w = canvas.width * cs
    const h = canvas.height * cs
    const fit = p.baseFit === "cover" ? Math.max(w / base.w, h / base.h) : Math.min(w / base.w, h / base.h)
    const baseW = base.w * fit
    const baseH = base.h * fit
    return { left: (container.w - w) / 2, top: (container.h - h) / 2, w, h, scale: fit, baseLeft: (w - baseW) / 2, baseTop: (h - baseH) / 2, baseW, baseH }
  }, [base, container, p.canvas, p.baseFit])

  // One store write per animation frame; patches for several layers coalesce
  // per layer instead of the newest index dropping an older one.
  const flush = useCallback(() => {
    frameRef.current = null
    const pending = pendingRef.current
    pendingRef.current = new Map()
    for (const [index, patch] of pending) onLayerChange(index, clampOverlayEdit(patch))
  }, [onLayerChange])

  const queue = useCallback(
    (index: number, patch: Partial<OverlayLayerConfig>) => {
      pendingRef.current.set(index, { ...(pendingRef.current.get(index) ?? {}), ...patch })
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush)
    },
    [flush],
  )

  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current) }, [])

  const slotCount = Math.max(p.layers.length, p.layerUrls.length)
  const layers = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => normalizeOverlayLayer(p.layers[i] ?? DEFAULT_OVERLAY_LAYER)),
    [p.layers, slotCount],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d || !stage || !base) return
      e.preventDefault()
      const z = zoomRef.current
      if (d.kind === "move") {
        let dx = e.clientX - d.startX
        let dy = e.clientY - d.startY
        if (!e.shiftKey) {
          const predicted: Rect = { left: d.box0.left + dx, top: d.box0.top + dy, width: d.box0.width, height: d.box0.height }
          const snap = snapBox(predicted, d.stageRect, d.safeRect, SNAP_PX)
          dx += snap.dx
          dy += snap.dy
          setGuides((g) => (g.v.length === snap.vertical.length && g.h.length === snap.horizontal.length && g.v[0] === snap.vertical[0] && g.h[0] === snap.horizontal[0] ? g : { v: snap.vertical, h: snap.horizontal }))
        } else {
          setGuides((g) => (g.v.length || g.h.length ? { v: [], h: [] } : g))
        }
        // Offsets are % of the BASE, not the canvas.
        queue(d.index, { x: d.x0 + (dx / (stage.baseW * z)) * 100, y: d.y0 + (dy / (stage.baseH * z)) * 100 })
      } else if (d.kind === "resize") {
        const patch: Partial<OverlayLayerConfig> = { width: d.w0 + ((e.clientX - d.startX) / (stage.w * z)) * 100 }
        if (d.h0 !== undefined) patch.height = d.h0 + ((e.clientY - d.startY) / (stage.h * z)) * 100
        queue(d.index, patch)
      } else if (d.kind === "scale-text") {
        // Dragging the corner scales the type: font size grows with the box.
        const f = d.f0 * Math.max(0.1, 1 + (e.clientX - d.startX) / Math.max(1, d.w0))
        queue(d.index, { text: { ...(layers[d.index].text ?? DEFAULT_TEXT_STYLE), fontSize: Math.max(1, Math.min(50, f)) } })
      } else {
        queue(d.index, { rotation: (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI + 90 })
      }
    },
    [stage, base, queue, layers],
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

  const order = overlayRenderOrder(layers)

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Delete" && e.key !== "Backspace") return
        if (isEditableTarget(e.target)) return
        // The selected LAYER is what Delete means on the stage — never let the
        // key reach React Flow, which would delete the whole node.
        e.preventDefault()
        e.stopPropagation()
        if (p.selected !== null && p.onRemove) p.onRemove(p.selected)
      }}
      className="relative w-full h-full overflow-hidden rounded-xl bg-black/20 select-none outline-none"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => onSelect(null)}
    >
      <CachedImage
        src={p.baseUrl}
        alt={t("overlayEditor.background")}
        className={p.canvas ? "w-full h-full object-contain invisible" : "w-full h-full object-contain"}
        thumbnail
        thumbnailWidth={1024}
        onLoadDimensions={(dim) => {
          if (dim.width > 0 && dim.height > 0) {
            setBase({ w: dim.width, h: dim.height })
            p.onBaseDimensions?.(dim)
          }
        }}
      />

      {stage && base && p.canvas && (
        <div className="absolute overflow-hidden" style={{ left: stage.left, top: stage.top, width: stage.w, height: stage.h, background: p.canvas.backgroundColor }}>
          <div className="absolute" style={{ left: stage.baseLeft, top: stage.baseTop, width: stage.baseW, height: stage.baseH }}>
            <CachedImage src={p.baseUrl} alt="" className="w-full h-full" thumbnail thumbnailWidth={1024} />
          </div>
        </div>
      )}

      {stage && base && (
        <div className="absolute overflow-hidden pointer-events-none" style={{ left: stage.left, top: stage.top, width: stage.w, height: stage.h }}>
          {/* Everything OUTSIDE the always-visible region is shaded (like a
              platform's own crop tool), so what a phone will cut off is
              obvious at a glance; device zones draw as labelled outlines. */}
          {p.safeArea && (
            <div
              className="absolute border-2 border-cyan-300"
              style={{ left: `${p.safeArea.x * 100}%`, top: `${p.safeArea.y * 100}%`, width: `${p.safeArea.w * 100}%`, height: `${p.safeArea.h * 100}%`, boxShadow: "0 0 0 200vmax rgba(0,0,0,0.55)" }}
              title={t("overlayPreview.safeAreaHint")}
            >
              <span className="absolute bottom-1 left-1 rounded bg-cyan-300 px-1.5 py-0.5 text-[9px] font-semibold text-black whitespace-nowrap">{t("overlayPreview.safeAreaHint")}</span>
            </div>
          )}
          {p.zones?.filter((z) => !(p.safeArea && z.x === p.safeArea.x && z.y === p.safeArea.y && z.w === p.safeArea.w && z.h === p.safeArea.h)).map((z) => (
            <div key={z.id} className="absolute border border-dashed border-cyan-200/80" style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}>
              <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-cyan-100 whitespace-nowrap">{t(`overlayPreview.zone.${z.id}` as never)}</span>
            </div>
          ))}
          {p.zones?.filter((z) => p.safeArea && z.x === p.safeArea.x && z.y === p.safeArea.y && z.w === p.safeArea.w && z.h === p.safeArea.h).map((z) => (
            <span key={z.id} className="absolute rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-cyan-100 whitespace-nowrap" style={{ left: `calc(${z.x * 100}% + 4px)`, top: `calc(${z.y * 100}% + 4px)` }}>{t(`overlayPreview.zone.${z.id}` as never)}</span>
          ))}
          {guides.v.map((f, i) => <div key={`v${i}`} className="absolute top-0 bottom-0 w-px bg-[#ff0073]" style={{ left: `${f * 100}%` }} />)}
          {guides.h.map((f, i) => <div key={`h${i}`} className="absolute left-0 right-0 h-px bg-[#ff0073]" style={{ top: `${f * 100}%` }} />)}
        </div>
      )}

      {stage && base && (
        <div className="absolute" style={{ left: stage.left + stage.baseLeft, top: stage.top + stage.baseTop, width: stage.baseW, height: stage.baseH }}>
          {order.map((i, z) => {
            const layer = layers[i]
            const kind = layer.kind ?? "image"
            const url = p.layerUrls[i]
            if (kind === "image" && !url) return null
            const s = stage.scale
            const isSel = p.selected === i
            const shadow = layer.shadow
            const objectFit = layer.height === undefined ? "fill" : layer.fit === "stretch" ? "fill" : layer.fit
            // Text sizes itself (font size % of base height) and is placed by
            // the CSS twin of the anchor math; boxed kinds use the shared geometry.
            const isText = kind === "text"
            const qrStyle = { ...DEFAULT_QR_STYLE, ...(layer.qr ?? {}) }
            const qrEffectiveText = qrStyle.fromInput ? (p.qrText ?? "") : qrStyle.text
            const shapeAspect = kind === "shape" && layer.height === undefined ? 3 : kind === "qr" ? 1 : aspects[i] ?? 1
            const box = isText ? null : resolveOverlayGeometry(base, layer, shapeAspect)
            const [ax, ay] = anchorFactors(layer.anchor)
            const placement: React.CSSProperties = box
              ? { left: box.left * s, top: box.top * s, width: box.width * s, height: box.height * s, transform: `rotate(${layer.rotation}deg)` }
              : { left: `calc(${ax * 100}% + ${layer.x}%)`, top: `calc(${ay * 100}% + ${layer.y}%)`, transform: `translate(${-ax * 100}%, ${-ay * 100}%) rotate(${layer.rotation}deg)` }
            return (
              <div
                key={i}
                className={`nodrag nopan absolute ${isSel ? "cursor-move" : "cursor-pointer"}`}
                style={{
                  ...placement,
                  transformOrigin: "center",
                  zIndex: 1 + z,
                  opacity: layer.opacity,
                  mixBlendMode: layer.blend === "over" ? "normal" : layer.blend,
                  filter: shadow && kind !== "image"
                    ? `drop-shadow(${shadow.offsetX * s}px ${shadow.offsetY * s}px ${2 * shadow.blur * s}px ${hexToRgba(shadow.color, shadow.opacity)})`
                    : undefined,
                }}
                onPointerDown={(e) => {
                  const el = e.currentTarget as HTMLElement
                  containerRef.current?.focus({ preventScroll: true })
                  const r = el.getBoundingClientRect()
                  const c = containerRef.current!.getBoundingClientRect()
                  const zoom = containerRef.current!.clientWidth > 0 ? c.width / containerRef.current!.clientWidth : 1
                  const stageRect: Rect = { left: c.left + stage.left * zoom, top: c.top + stage.top * zoom, width: stage.w * zoom, height: stage.h * zoom }
                  const sa = p.safeArea
                  const safeRect: Rect | undefined = sa ? { left: stageRect.left + sa.x * stageRect.width, top: stageRect.top + sa.y * stageRect.height, width: sa.w * stageRect.width, height: sa.h * stageRect.height } : undefined
                  start(e, { kind: "move", index: i, startX: e.clientX, startY: e.clientY, x0: layer.x, y0: layer.y, box0: { left: r.left, top: r.top, width: r.width, height: r.height }, stageRect, safeRect })
                }}
                onClick={(e) => e.stopPropagation()}
                role="img"
                aria-label={t("overlayEditor.layerN", { n: i + 1 })}
              >
                {kind === "text" && <TextLayerPreview style={layer.text ?? DEFAULT_TEXT_STYLE} fontPx={((layer.text?.fontSize ?? DEFAULT_TEXT_STYLE.fontSize) / 100) * base.h * s} scale={s} />}
                {kind === "qr" && <QrLayerPreview style={{ ...qrStyle, text: qrEffectiveText }} />}
                {kind === "shape" && box && <ShapeLayerPreview style={layer.shape ?? DEFAULT_SHAPE_STYLE} boxW={box.width} boxH={box.height} />}
                {kind === "qr" && isSel && (
                  <button
                    type="button"
                    className="nodrag nopan absolute left-1/2 -translate-x-1/2 top-full mt-1 max-w-[220px] whitespace-nowrap rounded-full bg-black/80 text-white text-[10px] leading-none px-2 py-1 flex items-center gap-1 hover:bg-[#ff0073]"
                    style={{ transform: `translateX(-50%) rotate(${-layer.rotation}deg)` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); p.onEditContent?.(i) }}
                    title={t("overlayEditor.editLink")}
                  >
                    <span aria-hidden>↗</span>
                    <span className="truncate">{qrLinkLabel(qrEffectiveText, 28) || (qrStyle.fromInput ? t("overlayEditor.fromWorkflow") : "—")}</span>
                    <span className="opacity-70">· {t("overlayEditor.editLink")}</span>
                  </button>
                )}
                {kind === "image" && url && (
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  className="w-full h-full pointer-events-none"
                  style={{
                    objectFit,
                    borderRadius: (layer.roundedCorners ?? 0) * s,
                    ...imageEffectStyle(layer.effects, s),
                    // CSS drop-shadow takes a blur RADIUS (σ = r/2); sharp.blur takes σ directly.
                    filter: [imageEffectStyle(layer.effects, s).filter, shadow ? `drop-shadow(${shadow.offsetX * s}px ${shadow.offsetY * s}px ${2 * shadow.blur * s}px ${hexToRgba(shadow.color, shadow.opacity)})` : undefined].filter(Boolean).join(" ") || undefined,
                  }}
                  onLoad={(e) => {
                    const img = e.currentTarget
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      const a = img.naturalWidth / img.naturalHeight
                      setAspects((prev) => (prev[i] === a ? prev : { ...prev, [i]: a }))
                    }
                  }}
                />
                )}
                {isSel && (
                  <>
                    <div className="absolute inset-0 border border-[#ff0073] pointer-events-none" />
                    <div
                      className={`${HANDLE} -right-1.5 -bottom-1.5 cursor-nwse-resize`}
                      onPointerDown={(e) => {
                        if (isText) {
                          const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                          start(e, { kind: "scale-text", index: i, startX: e.clientX, w0: r.width, f0: layer.text?.fontSize ?? DEFAULT_TEXT_STYLE.fontSize })
                        } else {
                          start(e, { kind: "resize", index: i, startX: e.clientX, startY: e.clientY, w0: layer.width, h0: layer.height })
                        }
                      }}
                      title={t("overlayPreview.resize")}
                    />
                    <div className="absolute left-1/2 -top-6 w-px h-6 bg-[#ff0073]/70 pointer-events-none" />
                    <div
                      className={`${HANDLE} left-1/2 -ml-1.5 -top-7 cursor-grab`}
                      onPointerDown={(e) => {
                        const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                        start(e, { kind: "rotate", index: i, cx: r.left + r.width / 2, cy: r.top + r.height / 2 })
                      }}
                      title={t("overlayPreview.rotate")}
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {p.selected !== null && ((layers[p.selected]?.kind ?? "image") !== "image" || p.layerUrls[p.selected]) && (
        <div
          className="nodrag nopan absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/60 backdrop-blur-sm border border-white/10 text-white"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-[10px] font-medium px-1">{t("overlayEditor.layerN", { n: p.selected + 1 })}</span>
          <button type="button" className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/15" title={t("overlayEditor.bringForward")} aria-label={t("overlayEditor.bringForward")} onClick={() => p.onReorder(p.selected!, "up")}>
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/15" title={t("overlayEditor.sendBackward")} aria-label={t("overlayEditor.sendBackward")} onClick={() => p.onReorder(p.selected!, "down")}>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/15" title={t("overlayPreview.resetRotation")} aria-label={t("overlayPreview.resetRotation")} onClick={() => onLayerChange(p.selected!, { rotation: 0 })}>
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

/** 0 / 0.5 / 1 anchor factors — the CSS twin of the geometry helper's anchorPoint. */
function anchorFactors(anchor: OverlayLayerConfig["anchor"]): readonly [number, number] {
  const h = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? 1 : 0.5
  const v = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 1 : 0.5
  return [h, v]
}
