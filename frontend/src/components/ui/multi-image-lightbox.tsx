"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"

interface LightboxItem {
  readonly url: string
  readonly alt?: string
  /** Asset kind. Defaults to "image" — provide "video" to render the URL as
   *  a controlled <video> element instead of a cached <img>. */
  readonly kind?: "image" | "video"
}

interface MultiImageLightboxProps {
  /** Full list — the lightbox cycles within this set. Empty list → renders nothing. */
  readonly items: readonly LightboxItem[]
  /** Which item to open at. Pass null to close. */
  readonly startIndex: number | null
  readonly onClose: () => void
}

/**
 * Fullscreen lightbox with prev/next navigation. Each item is either an image
 * (default) or a video (when `kind: "video"`) — videos render with native
 * controls, autoplay, loop, and start muted (browsers reject unmuted autoplay).
 * Lets the user cycle via:
 *   - on-screen ◀ / ▶ buttons
 *   - keyboard ← / → arrows
 *   - Escape to close
 *
 * Index is kept locally — caller just provides the starting index and the
 * full set. The "x of N" footer and looping (wrap-around) come for free.
 * Single-item sets get no navigation chrome, just the close + footer.
 */
export function MultiImageLightbox({ items, startIndex, onClose }: MultiImageLightboxProps) {
  const [index, setIndex] = useState<number>(startIndex ?? 0)

  // Sync local index when the caller pops the lightbox open at a new position.
  useEffect(() => {
    if (startIndex !== null) setIndex(startIndex)
  }, [startIndex])

  const total = items.length
  const prev = useCallback(() => setIndex((i) => (i - 1 + total) % total), [total])
  const next = useCallback(() => setIndex((i) => (i + 1) % total), [total])

  useEffect(() => {
    if (startIndex === null) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") {
        e.preventDefault()
        prev()
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        next()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [startIndex, onClose, prev, next])

  if (startIndex === null || total === 0) return null
  const current = items[Math.max(0, Math.min(index, total - 1))]
  if (!current) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      data-state="open"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Close (top-right) */}
      <button
        type="button"
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="Close"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Previous (left edge) */}
      {total > 1 && (
        <button
          type="button"
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            prev()
          }}
          aria-label="Previous image"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* Image or video — `key` forces a fresh element on index change so
          the new src takes effect even when the same DOM node is reused
          (otherwise React's reconciler keeps the old video's playback state
          and the new clip never plays). */}
      {current.kind === "video" ? (
        <video
          key={current.url}
          src={current.url}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl bg-black"
          controls
          autoPlay
          loop
          muted
          playsInline
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <CachedImage
          src={current.url}
          alt={current.alt ?? "Preview"}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {/* Next (right edge) */}
      {total > 1 && (
        <button
          type="button"
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            next()
          }}
          aria-label="Next image"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* Footer position indicator + name */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 text-white text-xs flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {current.alt && <span className="opacity-90">{current.alt}</span>}
        {total > 1 && <span className="opacity-60 tabular-nums">{index + 1} / {total}</span>}
      </div>
    </div>,
    document.body,
  )
}
