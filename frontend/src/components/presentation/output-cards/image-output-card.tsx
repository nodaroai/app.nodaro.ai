import { useState } from "react"
import { Download, Copy, Maximize2, ImageIcon } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { StatusBadge, GlassCard, GlassButton, ShimmerPlaceholder, copyUrl, downloadFile, type OutputStatus } from "./shared"

interface ImageOutputCardProps {
  label: string
  status: OutputStatus
  url?: string
}

export function ImageOutputCard({ label, status, url }: ImageOutputCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <StatusBadge status={status} />
      </div>

      {status === "running" ? (
        <ShimmerPlaceholder />
      ) : url ? (
        <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={() => setPreviewOpen(true)}>
          <CachedImage
            src={url}
            alt={label}
            thumbnail
            className="w-full rounded-lg bg-black/20"
          />
          {/* Hover toolbar — top-right, no blur overlay */}
          <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <GlassButton onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} title="Fullscreen">
              <Maximize2 className="w-3.5 h-3.5" />
            </GlassButton>
            <GlassButton onClick={(e) => { e.stopPropagation(); downloadFile(url, `${label.replace(/\s+/g, "-").toLowerCase()}.png`) }} title="Download">
              <Download className="w-3.5 h-3.5" />
            </GlassButton>
            <GlassButton onClick={(e) => { e.stopPropagation(); copyUrl(url) }} title="Copy URL">
              <Copy className="w-3.5 h-3.5" />
            </GlassButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-48 rounded-lg bg-muted/30 text-muted-foreground">
          <ImageIcon className="w-10 h-10 mb-2 animate-pulse" />
          <span className="text-xs">
            {status === "failed" ? "Generation failed" : "Awaiting generation"}
          </span>
        </div>
      )}

      {url && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="image"
          url={url}
        />
      )}
    </GlassCard>
  )
}
