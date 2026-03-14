"use client"

import { useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"

interface MediaPreviewModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly type: "image" | "video" | "audio"
  readonly url: string
  /** Current 0-based index (for "X of Y" counter) */
  readonly currentIndex?: number
  /** Total items across all pages */
  readonly totalCount?: number
  /** Navigate to previous item (undefined = at start) */
  readonly onPrev?: () => void
  /** Navigate to next item (undefined = at end) */
  readonly onNext?: () => void
}

export function MediaPreviewModal({ isOpen, onClose, type, url, currentIndex, totalCount, onPrev, onNext }: MediaPreviewModalProps) {
  const hasNav = currentIndex !== undefined && totalCount !== undefined

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
    if (e.key === "ArrowLeft" && onPrev) onPrev()
    if (e.key === "ArrowRight" && onNext) onNext()
  }, [onClose, onPrev, onNext])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  // Touch swipe support
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return
    if (dx < 0 && onNext) onNext()
    if (dx > 0 && onPrev) onPrev()
  }, [onPrev, onNext])

  if (!isOpen || !url) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
      onTouchStart={hasNav ? handleTouchStart : undefined}
      onTouchEnd={hasNav ? handleTouchEnd : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[90vw] md:w-[60vw] max-h-[80vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close preview"
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors"
          onClick={onClose}
        >
          <X className="w-7 h-7" />
        </button>

        {/* Counter */}
        {hasNav && (
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-white/70 text-sm tabular-nums">
            {currentIndex! + 1} of {totalCount}
          </div>
        )}

        {/* Prev button */}
        {onPrev && (
          <button
            type="button"
            aria-label="Previous"
            className="absolute left-0 md:-left-12 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            onClick={(e) => { e.stopPropagation(); onPrev() }}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Next button */}
        {onNext && (
          <button
            type="button"
            aria-label="Next"
            className="absolute right-0 md:-right-12 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            onClick={(e) => { e.stopPropagation(); onNext() }}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {type === "image" ? (
          <CachedImage
            src={url}
            alt="Preview"
            className="max-w-full max-h-[90vh] rounded-lg object-contain"
          />
        ) : type === "video" ? (
          <video
            src={url}
            className="max-w-full max-h-[80vh] rounded-lg"
            controls
            autoPlay
            muted
            playsInline
          />
        ) : (
          <audio src={url} controls autoPlay className="w-full" />
        )}
      </div>
    </div>,
    document.body
  )
}
