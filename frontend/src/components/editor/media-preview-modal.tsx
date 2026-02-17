"use client"

import { useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"

interface MediaPreviewModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly type: "image" | "video"
  readonly url: string
}

export function MediaPreviewModal({ isOpen, onClose, type, url }: MediaPreviewModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!isOpen || !url) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative w-[60vw] max-h-[80vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors"
          onClick={onClose}
        >
          <X className="w-7 h-7" />
        </button>

        {type === "image" ? (
          <CachedImage
            src={url}
            alt="Preview"
            className="max-w-full max-h-[80vh] rounded-lg object-contain"
          />
        ) : (
          <video
            src={url}
            className="max-w-full max-h-[80vh] rounded-lg"
            controls
            autoPlay
            playsInline
          />
        )}
      </div>
    </div>,
    document.body
  )
}
