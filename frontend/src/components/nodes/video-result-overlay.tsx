"use client"

import { memo } from "react"
import { X, Expand, Download, Link, Settings, Scissors } from "lucide-react"
import { copyToClipboard } from "@/lib/utils"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"

interface VideoResultOverlayProps {
  url: string
  videoAutoplay: boolean
  label: string
  hasResults: boolean
  onExpand: () => void
  onDelete: () => void
  onDimensionsChange: (dims: { width: number; height: number }) => void
  onVideoError?: () => void
  onVideoLoad?: () => void
  onSettings?: () => void
  isSettingsOpen?: boolean
  onEdit?: () => void
}

function VideoResultOverlayComponent({
  url,
  videoAutoplay,
  label,
  hasResults,
  onExpand,
  onDelete,
  onDimensionsChange,
  onVideoError,
  onVideoLoad,
  onSettings,
  isSettingsOpen,
  onEdit,
}: VideoResultOverlayProps) {
  return (
    <div
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden', zIndex: 10 }}
      className="group/video"
    >
      <video
        src={url}
        crossOrigin="anonymous"
        autoPlay={videoAutoplay}
        loop={videoAutoplay}
        muted
        playsInline
        className="w-full h-full object-cover"
        onError={onVideoError}
        onLoadedMetadata={(e) => {
          onVideoLoad?.()
          const video = e.currentTarget
          const ratio = video.videoWidth / video.videoHeight
          const baseWidth = 280
          const baseHeight = Math.round(baseWidth / ratio)
          onDimensionsChange({ width: baseWidth, height: Math.max(120, Math.min(360, baseHeight)) })
        }}
      />
      {hasResults && (
        <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
          <button
            type="button"
            aria-label="Remove result"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
        <button
          type="button"
          aria-label="Expand preview"
          className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
          onClick={(e) => { e.stopPropagation(); onExpand() }}
        >
          <Expand className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label="Download"
          className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
          onClick={(e) => {
            e.stopPropagation()
            const a = document.createElement('a')
            a.href = `/v1/image-proxy?url=${encodeURIComponent(url)}&download=1`
            a.download = `${label || 'video'}.mp4`
            a.click()
          }}
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label="Copy URL"
          className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
          onClick={(e) => {
            e.stopPropagation()
            copyToClipboard(url, "URL copied")
          }}
        >
          <Link className="w-3.5 h-3.5" />
        </button>
        {onEdit && (
          <button
            type="button"
            aria-label="Edit in FreeCut"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            title="Edit in FreeCut"
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
        {onSettings ? (
          <button type="button" aria-label="Settings" className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
            onClick={(e) => { e.stopPropagation(); onSettings() }} title="Settings">
            <Settings className="w-3.5 h-3.5" />
          </button>
        ) : (
          <SaveToLibraryButton url={url} type="video" />
        )}
      </div>
    </div>
  )
}

export const VideoResultOverlay = memo(VideoResultOverlayComponent)
