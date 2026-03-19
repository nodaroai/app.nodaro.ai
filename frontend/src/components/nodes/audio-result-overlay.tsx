"use client"

import { memo } from "react"
import { X, Expand, Download, Link } from "lucide-react"
import { toast } from "sonner"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"

interface AudioResultOverlayProps {
  url: string
  label: string
  hasResults: boolean
  onExpand: () => void
  onDelete: () => void
}

function AudioResultOverlayComponent({
  url,
  label,
  hasResults,
  onExpand,
  onDelete,
}: AudioResultOverlayProps) {
  return (
    <div className="relative group/audio">
      <audio
        src={url}
        controls
        className="w-full h-8"
        onClick={(e) => e.stopPropagation()}
      />
      {/* Action buttons - appear on hover below the player */}
      <div className="flex items-center justify-between mt-1 opacity-0 group-hover/audio:opacity-100 transition-opacity">
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Expand preview"
            className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); onExpand() }}
          >
            <Expand className="w-3 h-3" />
          </button>
          <button
            type="button"
            aria-label="Download"
            className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => {
              e.stopPropagation()
              const a = document.createElement('a')
              a.href = `/v1/image-proxy?url=${encodeURIComponent(url)}&download=1`
              a.download = `${label || 'audio'}.mp3`
              a.click()
            }}
          >
            <Download className="w-3 h-3" />
          </button>
          <button
            type="button"
            aria-label="Copy URL"
            className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(url).then(() => toast.success("URL copied")).catch(() => {})
            }}
          >
            <Link className="w-3 h-3" />
          </button>
        </div>
        <div className="flex gap-1 items-center">
          <SaveToLibraryButton url={url} type="audio" />
          {hasResults && (
            <button
              type="button"
              aria-label="Remove result"
              className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export const AudioResultOverlay = memo(AudioResultOverlayComponent)
