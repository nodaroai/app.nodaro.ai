import { memo, useRef, useState, useCallback } from "react"
import { Download, Copy, Play, Pause, Volume2, VolumeX, VideoIcon } from "lucide-react"
import { StatusBadge, GlassCard, GlassButton, ShimmerPlaceholder, copyUrl, downloadFile, UnhideBanner, resolveCardActions, type OutputStatus, type OutputCardActions } from "./shared"
import { ActionMenu } from "./action-menu"
import { ActionBar } from "./action-bar"
import { shareMedia } from "./share-utils"
import { ELEMENT_SIZES } from "@/lib/presentation-display"
import { SwitchXAttribution } from "@/components/switchx-attribution"
import { useT } from "@/lib/i18n"

interface VideoOutputCardProps {
  label: string
  status: OutputStatus
  url?: string
  nodeId?: string
  onOpenMedia?: (nodeId: string) => void
  elementSize?: "sm" | "md" | "lg"
  actions?: OutputCardActions
  /** Producing node type — drives required brand attribution (e.g. switchx). */
  nodeType?: string
}

function VideoOutputCardImpl({ label, status, url, nodeId, onOpenMedia, elementSize, actions, nodeType }: VideoOutputCardProps) {
  const t = useT()
  const maxHClass = ELEMENT_SIZES.videoOutput[elementSize ?? "md"]
  const bound = resolveCardActions(actions, nodeId, "video", url)
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
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        <StatusBadge status={status} />
      </div>

      {status === "running" || status === "waiting" ? (
        <ShimmerPlaceholder />
      ) : url ? (
        <>
          <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={handleClick}>
            <video
              ref={videoRef}
              src={url}
              className={`w-full ${maxHClass} rounded-lg object-contain`}
              muted
              autoPlay
              loop
              playsInline
            />
            {/* Required brand attribution for SwitchX outputs (always visible). */}
            {nodeType === "switchx" && (
              <div className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2">
                <SwitchXAttribution />
              </div>
            )}
            {/* Bottom-left: play/pause — visible on hover/touch */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
            <div className="media-overlay-controls absolute bottom-2 start-2 hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
              <GlassButton onClick={togglePlay} title={paused ? t("common.play") : t("common.pause")}>
                {paused
                  ? <Play className="w-3.5 h-3.5 ms-0.5" fill="white" />
                  : <Pause className="w-3.5 h-3.5" fill="white" />}
              </GlassButton>
            </div>
            {/* Bottom-right: mute/unmute — visible on hover/touch */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
            <div className="media-overlay-controls absolute bottom-2 end-2 hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
              <GlassButton onClick={toggleMute} title={muted ? t("present.unmute") : t("present.mute")}>
                {muted
                  ? <VolumeX className="w-3.5 h-3.5" />
                  : <Volume2 className="w-3.5 h-3.5" />}
              </GlassButton>
            </div>
            {/* Top-right: download, copy, menu — visible on hover/touch */}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions */}
            <div className="media-overlay-controls absolute top-2 end-2 hidden md:flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => e.stopPropagation()}>
              <GlassButton onClick={() => downloadFile(url, `${label.replace(/\s+/g, "-").toLowerCase()}.mp4`)} title={t("common.download")}>
                <Download className="w-3.5 h-3.5" />
              </GlassButton>
              <GlassButton onClick={() => copyUrl(url)} title={t("cfgshared.copyUrl")}>
                <Copy className="w-3.5 h-3.5" />
              </GlassButton>
              <ActionMenu
                mediaType="video"
                onShare={() => shareMedia({ url, title: label, type: "video" })}
                onEdit={bound.onEdit}
                onHide={bound.onHide}
              />
            </div>
          </div>
          <ActionBar
            mediaType="video"
            url={url}
            label={label}
            onShare={() => shareMedia({ url, title: label, type: "video" })}
            onEdit={bound.onEdit}
            onHide={bound.onHide}
          />
          {bound.isRevealed && bound.onUnhide && (
            <UnhideBanner onUnhide={bound.onUnhide} />
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 sm:h-48 rounded-lg bg-muted/30 text-muted-foreground">
          <VideoIcon className="w-10 h-10 mb-2 animate-pulse" />
          <span className="text-xs">
            {status === "failed" ? t("present.generationFailed") : t("present.awaitingGeneration")}
          </span>
        </div>
      )}
    </GlassCard>
  )
}

export const VideoOutputCard = memo(VideoOutputCardImpl)
