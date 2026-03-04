import { Download, Copy, Maximize2, Play, VideoIcon } from "lucide-react"
import { StatusBadge, GlassCard, GlassButton, ShimmerPlaceholder, copyUrl, downloadFile, type OutputStatus } from "./shared"

interface VideoOutputCardProps {
  label: string
  status: OutputStatus
  url?: string
  nodeId?: string
  onOpenMedia?: (nodeId: string) => void
}

export function VideoOutputCard({ label, status, url, nodeId, onOpenMedia }: VideoOutputCardProps) {
  const handleClick = () => {
    if (nodeId && onOpenMedia) onOpenMedia(nodeId)
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <StatusBadge status={status} />
      </div>

      {status === "running" ? (
        <ShimmerPlaceholder />
      ) : url ? (
        <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={handleClick}>
          <video
            src={url}
            className="w-full rounded-lg bg-black/20 object-contain"
            muted
            playsInline
          />
          {/* Centered play overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center group-hover:bg-black/60 group-hover:scale-110 transition-all duration-200">
              <Play className="w-7 h-7 text-white ml-1" fill="white" />
            </div>
          </div>
          {/* Hover toolbar */}
          <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <GlassButton onClick={handleClick} title="Fullscreen">
              <Maximize2 className="w-3.5 h-3.5" />
            </GlassButton>
            <GlassButton onClick={() => downloadFile(url, `${label.replace(/\s+/g, "-").toLowerCase()}.mp4`)} title="Download">
              <Download className="w-3.5 h-3.5" />
            </GlassButton>
            <GlassButton onClick={() => copyUrl(url)} title="Copy URL">
              <Copy className="w-3.5 h-3.5" />
            </GlassButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-48 rounded-lg bg-muted/30 text-muted-foreground">
          <VideoIcon className="w-10 h-10 mb-2 animate-pulse" />
          <span className="text-xs">
            {status === "failed" ? "Generation failed" : "Awaiting generation"}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
