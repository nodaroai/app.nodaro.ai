// Click an image in a tutorial, see it properly.
//
// Shared machinery, like the video and audio controls: a tutorial that shows
// generated images at thumbnail size is asking the reader to judge work they
// cannot actually see. Zoom is a real zoom (up to 4x with panning), not a
// fit-to-screen preview, because the point is usually a detail.

import { useCallback, useEffect, useRef, useState } from "react"
import { X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { useT } from "@/lib/i18n"
import "./tutorial-lightbox.css"

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const STEP = 0.5

export function TutorialLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt?: string
  onClose: () => void
}) {
  const t = useT()
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  const zoomTo = useCallback((next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    setZoom(clamped)
    // Back at 1x there is nothing to pan to, so recentre rather than leaving
    // the image stranded off to one side.
    if (clamped === MIN_ZOOM) setOffset({ x: 0, y: 0 })
  }, [])

  // Esc closes, +/- zoom. A full-screen overlay with no keyboard exit is a trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "+" || e.key === "=") zoomTo(zoom + STEP)
      else if (e.key === "-") zoomTo(zoom - STEP)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, zoom, zoomTo])

  return (
    <div className="tl" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt ?? t("common.image")}>
      <img
        className="tl-img"
        src={src}
        alt={alt ?? ""}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          cursor: zoom > 1 ? (drag.current ? "grabbing" : "grab") : "default",
        }}
        // The image itself must not close the overlay — only the backdrop does.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation()
          zoomTo(zoom >= MAX_ZOOM ? MIN_ZOOM : zoom + 1)
        }}
        onWheel={(e) => zoomTo(zoom + (e.deltaY < 0 ? STEP : -STEP))}
        onPointerDown={(e) => {
          if (zoom <= 1) return
          drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        draggable={false}
      />

      <div className="tl-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomTo(zoom - STEP)} aria-label={t("templates.zoomOut")} disabled={zoom <= MIN_ZOOM}>
          <ZoomOut className="tl-icon" />
        </button>
        <span className="tl-level">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomTo(zoom + STEP)} aria-label={t("templates.zoomIn")} disabled={zoom >= MAX_ZOOM}>
          <ZoomIn className="tl-icon" />
        </button>
        <button type="button" onClick={() => zoomTo(MIN_ZOOM)} aria-label={t("tut.fitToScreen")}>
          <Maximize2 className="tl-icon" />
        </button>
        <button type="button" onClick={onClose} aria-label={t("common.close")}>
          <X className="tl-icon" />
        </button>
      </div>
    </div>
  )
}

/** State for a body that has several openable images. */
export function useLightbox() {
  const [open, setOpen] = useState<{ src: string; alt?: string } | null>(null)
  return {
    open,
    show: useCallback((src: string, alt?: string) => setOpen({ src, alt }), []),
    hide: useCallback(() => setOpen(null), []),
  }
}
