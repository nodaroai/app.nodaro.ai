import { useRef, useState, useCallback } from "react"
import { Download, Copy, Maximize2, Play, Pause, Volume2, VolumeX, VideoIcon } from "lucide-react"
import { StatusBadge, GlassCard, GlassButton, ShimmerPlaceholder, copyUrl, downloadFile, type OutputStatus } from "./shared"

interface VideoOutputCardProps {
  label: string
  status: OutputStatus
  url?: string
  nodeId?: string
  onOpenMedia?: (nodeId: string) => void
}

export function VideoOutputCard({ label, status, url, nodeId, onOpenMedia }: VideoOutputCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [paused, setPaused] = useState(false)

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return
    videoRef.current.muted = !videoRef.current.muted
    setMuted(videoRef.current.muted)
  }, [])

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play()
      setPaused(false)
    } else {
      videoRef.current.pause()
      setPaused(true)
    }
  }, [])

  const handleClick = () => {
    if (nodeId && onOpenMedia) onOpenMedia(nodeId)
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <StatusBadge status={status} />
      </div>

      {status === "running" || status === "waiting" ? (
        <ShimmerPlaceholder />
      ) : url ? (
        <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={handleClick}>
          <video
            ref={videoRef}
            src={url}
            className="w-full max-h-[70vh] rounded-lg bg-black/20 object-contain"
            muted
            autoPlay
            loop
            playsInline
          />
          {/* Bottom-left: play/pause — visible on hover/touch */}
          <div className="media-overlay-controls absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <GlassButton onClick={togglePlay} title={paused ? "Play" : "Pause"}>
              {paused
                ? <Play className="w-3.5 h-3.5 ml-0.5" fill="white" />
                : <Pause className="w-3.5 h-3.5" fill="white" />}
            </GlassButton>
          </div>
          {/* Bottom-right: mute/unmute — visible on hover/touch */}
          <div className="media-overlay-controls absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <GlassButton onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
              {muted
                ? <VolumeX className="w-3.5 h-3.5" />
                : <Volume2 className="w-3.5 h-3.5" />}
            </GlassButton>
          </div>
          {/* Top-right: fullscreen, download, copy — visible on hover/touch */}
          <div className="media-overlay-controls absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
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
        <div className="flex flex-col items-center justify-center h-32 sm:h-48 rounded-lg bg-muted/30 text-muted-foreground">
          <VideoIcon className="w-10 h-10 mb-2 animate-pulse" />
          <span className="text-xs">
            {status === "failed" ? "Generation failed" : "Awaiting generation"}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
