"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"

interface MediaPreviewModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly type: "image" | "video" | "audio"
  readonly url: string
  /** All results for internal prev/next navigation (overrides currentIndex/totalCount/onPrev/onNext) */
  readonly results?: ReadonlyArray<{ url?: string }>
  /** Starting index into results (default 0) */
  readonly initialIndex?: number
  /** Called when internal navigation changes the viewed index */
  readonly onIndexChange?: (index: number) => void
  /** Current 0-based index (for "X of Y" counter) — used when results not provided */
  readonly currentIndex?: number
  /** Total items across all pages — used when results not provided */
  readonly totalCount?: number
  /** Navigate to previous item (undefined = at start) — used when results not provided */
  readonly onPrev?: () => void
  /** Navigate to next item (undefined = at end) — used when results not provided */
  readonly onNext?: () => void
}

export function MediaPreviewModal({ isOpen, onClose, type, url, results, initialIndex, onIndexChange, currentIndex, totalCount, onPrev, onNext }: MediaPreviewModalProps) {
  // Internal navigation state when results array is provided
  const validResults = results?.filter((r) => r.url) ?? []
  const hasInternalNav = validResults.length > 1
  const [viewIndex, setViewIndex] = useState(initialIndex ?? 0)

  // Reset viewIndex when modal opens or initialIndex changes
  useEffect(() => {
    if (isOpen) setViewIndex(initialIndex ?? 0)
  }, [isOpen, initialIndex])

  const goInternalPrev = useCallback(() => {
    setViewIndex((prev) => {
      const next = Math.max(0, prev - 1)
      onIndexChange?.(next)
      return next
    })
  }, [onIndexChange])

  const goInternalNext = useCallback(() => {
    setViewIndex((prev) => {
      const next = Math.min(validResults.length - 1, prev + 1)
      onIndexChange?.(next)
      return next
    })
  }, [validResults.length, onIndexChange])

  // Determine which navigation to use
  const effectiveUrl = hasInternalNav ? (validResults[viewIndex]?.url ?? url) : url
  const effectiveIndex = hasInternalNav ? viewIndex : currentIndex
  const effectiveTotal = hasInternalNav ? validResults.length : totalCount
  const effectivePrev = hasInternalNav ? (viewIndex > 0 ? goInternalPrev : undefined) : onPrev
  const effectiveNext = hasInternalNav ? (viewIndex < validResults.length - 1 ? goInternalNext : undefined) : onNext
  const hasNav = effectiveIndex !== undefined && effectiveTotal !== undefined

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopImmediatePropagation(); onClose() }
    if (e.key === "ArrowLeft" && effectivePrev) { e.stopImmediatePropagation(); effectivePrev() }
    if (e.key === "ArrowRight" && effectiveNext) { e.stopImmediatePropagation(); effectiveNext() }
  }, [onClose, effectivePrev, effectiveNext])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
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
    if (dx < 0 && effectiveNext) effectiveNext()
    if (dx > 0 && effectivePrev) effectivePrev()
  }, [effectivePrev, effectiveNext])

  if (!isOpen || !effectiveUrl) return null

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
        className="relative w-[95vw] max-h-[95vh] flex items-center justify-center"
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

        {/* Counter — bottom center */}
        {hasNav && (
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-white/70 text-sm tabular-nums">
            {effectiveIndex! + 1} / {effectiveTotal}
          </div>
        )}

        {/* Prev button */}
        {effectivePrev && (
          <button
            type="button"
            aria-label="Previous"
            className="absolute left-0 md:-left-12 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            onClick={(e) => { e.stopPropagation(); effectivePrev() }}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Next button */}
        {effectiveNext && (
          <button
            type="button"
            aria-label="Next"
            className="absolute right-0 md:-right-12 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
            onClick={(e) => { e.stopPropagation(); effectiveNext() }}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {type === "image" ? (
          <CachedImage
            src={effectiveUrl}
            alt="Preview"
            className="max-w-full max-h-[90vh] rounded-lg object-contain"
          />
        ) : type === "video" ? (
          <video
            key={effectiveUrl}
            src={effectiveUrl}
            className="max-w-full max-h-[80vh] rounded-lg"
            controls
            autoPlay
            muted
            playsInline
          />
        ) : (
          <audio key={effectiveUrl} src={effectiveUrl} controls autoPlay className="w-full" />
        )}
      </div>
    </div>,
    document.body
  )
}
