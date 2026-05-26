"use client"

import { useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { useImageAspect } from "@/hooks/use-image-aspect"

interface ImageLightboxProps {
  readonly src: string | null
  readonly alt?: string
  readonly onClose: () => void
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!src) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [src, handleKeyDown])

  const aspect = useImageAspect(src)

  if (!src) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      data-state="open"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
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
      {aspect !== null && (
        <div
          className="rounded-lg shadow-2xl overflow-hidden"
          style={{
            width: `min(90vw, calc(90vh * ${aspect}))`,
            height: `min(90vh, calc(90vw / ${aspect}))`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <CachedImage
            src={src}
            alt={alt ?? "Preview"}
            className="w-full h-full object-contain"
            noPlaceholder
          />
        </div>
      )}
    </div>,
    document.body,
  )
}
