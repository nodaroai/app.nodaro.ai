"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { X, Image as ImageIcon } from "lucide-react"
import type { LibraryAsset } from "@/lib/api"
import { LibraryMediaBrowser } from "./library-media-browser"
import { SHORTCUTS, formatBinding, isMacPlatform } from "@/lib/shortcuts"

interface MediaLibraryModalProps {
  open: boolean
  onClose: () => void
  onAddToCanvas?: (asset: LibraryAsset) => void
}

/**
 * Media Library modal — the user's uploaded/generated files (images, videos,
 * audio). Thin chrome around {@link LibraryMediaBrowser}, which owns the
 * search/filter/grid and is also embedded in the My Library "All Files" tab.
 */
export function MediaLibraryModal({ open, onClose, onAddToCanvas }: MediaLibraryModalProps) {
  const isMac = isMacPlatform()
  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-6xl max-h-[85vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ff0073]/10 flex items-center justify-center">
              <ImageIcon className="w-4 h-4 text-[#ff0073]" />
            </div>
            <h2 className="text-base font-semibold">Media Library</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <LibraryMediaBrowser
          onAddToCanvas={onAddToCanvas}
          autoFocusSearch
          owned
          footerHint={<p className="text-xs text-muted-foreground/40">{formatBinding(SHORTCUTS.mediaLibrary.bindings[0], isMac)} to toggle</p>}
        />
      </div>
    </div>,
    document.body,
  )
}
