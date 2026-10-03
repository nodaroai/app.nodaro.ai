"use client"

import { useT } from "@/lib/i18n"
import { memo, useState, useCallback, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Link, X, Play, Video, Film, Music2, Camera, Hash, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { createPortal } from "react-dom"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { VideoLinkStatus } from "./video-link-status"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { VIDEO_PLATFORM_LABELS, detectVideoLinkPlatform, type VideoLinkPlatform } from "@/lib/video-link"
import { clearVideoLink, setVideoLinkUrl } from "@/lib/video-link-ingest"
import type { YouTubeVideoData } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { videoNodeSizing } from "./video-node-defaults"

type VideoPlatform = VideoLinkPlatform

function PlatformIcon({ platform, className }: { readonly platform: VideoPlatform; readonly className?: string }) {
  switch (platform) {
    case "facebook": return <Video className={className} />
    case "tiktok": return <Music2 className={className} />
    case "instagram": return <Camera className={className} />
    case "twitter": return <Hash className={className} />
    default: return <Video className={className} />
  }
}

function VideoPlayerModal({
  isOpen,
  onClose,
  videoId,
  platform,
  downloadedVideoUrl,
}: {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly videoId: string
  readonly platform: VideoPlatform
  readonly downloadedVideoUrl?: string
}) {
  const t = useT()
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    },
    [onClose]
  )

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!isOpen || !videoId) return null

  // A downloaded file plays as ITSELF, whatever the platform: it is what flows
  // downstream, and for a YouTube link it may be one part of the video — the
  // embed would play the whole thing and show something the workflow never gets.
  const showDownloadedPlayer = !!downloadedVideoUrl
  // YouTube with nothing downloaded yet: the embed is the only preview there is.
  const showYouTubeEmbed = platform === "youtube" && !downloadedVideoUrl

  if (!showDownloadedPlayer && !showYouTubeEmbed) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative w-[70vw] max-w-[960px] aspect-video"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute -top-10 right-0 text-white/70 hover:text-white transition-colors"
          onClick={onClose}
        >
          <X className="w-7 h-7" />
        </button>
        {showYouTubeEmbed && (
          <iframe
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
            className="w-full h-full rounded-lg"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={t("node.youtubeVideoPlayer")}
          />
        )}
        {showDownloadedPlayer && (
          <video
            src={downloadedVideoUrl}
            crossOrigin="anonymous"
            className="w-full h-full rounded-lg"
            controls
            autoPlay
          />
        )}
      </div>
    </div>,
    document.body
  )
}

const HANDLES = [
  { id: "in",    type: "target" as const, position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
  { id: "video", type: "source" as const, position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
] as const

function YouTubeVideoNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as YouTubeVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [playerOpen, setPlayerOpen] = useState(false)
  // Aspect of the displayed thumbnail — for downloaded non-YouTube clips
  // (TikTok/Reels/etc.) this is the real video aspect (vertical); for YouTube
  // it's the 16:9 thumbnail, matching the embed. Drives node + container size.
  const [thumbAspect, setThumbAspect] = useState<number | undefined>(undefined)

  const link = typeof nodeData.youtubeUrl === "string" ? nodeData.youtubeUrl : ""
  const platform = detectVideoLinkPlatform(link.trim())
  const canEmbed = platform === "youtube"
  const canPlay = canEmbed || !!nodeData.downloadedVideoUrl
  const useFull = useFullResolution(id)
  const displayThumbnail = nodeData.downloadedThumbnailUrl || nodeData.thumbnailUrl
  useEffect(() => { setThumbAspect(undefined) }, [displayThumbnail])

  const clearButton = (
    <button
      type="button"
      className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={(e) => {
        e.stopPropagation()
        clearVideoLink(id)
      }}
      title={t("imgcfg.remove")}
    >
      <X className="w-3 h-3" />
    </button>
  )

  return (
    <>
      <div className="relative" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {/* Floating label above node */}
        <EditableNodeLabel
          label={nodeData.label}
          icon={<Video className="w-3.5 h-3.5" />}
          onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
        />
        <BaseNode
          id={id}
          label={nodeData.label}
          icon={<Video className="h-4 w-4" />}
          category="input"
          credits={0}
          selected={selected}
          {...videoNodeSizing(thumbAspect)}
          hideHeader
          handles={HANDLES}
        >
          <div className="p-3 flex flex-col gap-1.5">
            {/* URL input — every download belongs to the controller (lib/video-link-ingest) */}
            <div className="flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              <input
                type="text"
                value={link}
                onChange={(e) => {
                  e.stopPropagation()
                  setVideoLinkUrl(id, e.target.value)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("inputcfg.youtubeFacebookTiktokInstagramOrX")}
                className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-[#38BDF8] transition-colors placeholder:text-muted-foreground/30"
              />
            </div>

            {/* Thumbnail — YouTube's own the instant the link lands, the downloaded file's after */}
            {nodeData.videoId && displayThumbnail && (
              <div className="relative group">
                <div
                  className={`w-full rounded-md overflow-hidden bg-muted/30 relative ${canPlay ? "cursor-pointer hover:opacity-90" : ""} transition-opacity`}
                  style={{ aspectRatio: thumbAspect ?? 16 / 9 }}
                  onClick={(e) => {
                    if (!canPlay) return
                    e.stopPropagation()
                    setPlayerOpen(true)
                  }}
                >
                  <CachedImage
                    src={displayThumbnail}
                    alt={nodeData.title || t("common.video")}
                    className="w-full h-full object-cover"
                    thumbnail={!useFull}
                    thumbnailWidth={320}
                    onLoadDimensions={({ width, height }) => { if (width > 0 && height > 0) setThumbAspect(width / height) }}
                  />
                  {/* Platform badge (non-YouTube) */}
                  {!canEmbed && platform !== "unknown" && (
                    <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1">
                      <PlatformIcon platform={platform} className="w-3 h-3" />
                      <span>{VIDEO_PLATFORM_LABELS[platform]}</span>
                    </div>
                  )}
                  {/* Play button */}
                  {canPlay && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className={`w-10 h-10 rounded-full ${canEmbed ? "bg-red-600/90" : "bg-[#38BDF8]/90"} flex items-center justify-center shadow-lg`}>
                        <Play className="w-5 h-5 text-white ml-0.5" />
                      </div>
                    </div>
                  )}
                </div>
                {clearButton}
                {nodeData.title && (
                  <p className="mt-1 text-[10px] text-muted-foreground truncate" title={nodeData.title}>
                    {nodeData.title}
                  </p>
                )}
              </div>
            )}

            {/* A recognised link with nothing to show yet (TikTok / Reels before the download lands) */}
            {nodeData.videoId && !displayThumbnail && (
              <div className="relative group">
                <div className="w-full rounded-md bg-muted/30 p-3 flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                    <PlatformIcon platform={platform} className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <p className="min-w-0 text-xs font-medium truncate">{nodeData.title || t("common.video")}</p>
                </div>
                {clearButton}
              </div>
            )}

            {/* Checking / choose a part / progress / failed / ready — shared with the panel */}
            <VideoLinkStatus nodeId={id} data={nodeData} variant="card" />

            {/* Audio download status indicator */}
            {nodeData.videoId && nodeData.audioDownloadStatus === "downloading" && (
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <Loader2 className="w-3 h-3 text-[#38BDF8] animate-spin" />
                <span className="text-[10px] text-muted-foreground">{t("cfgext.musicDownloadingAudio")}</span>
              </div>
            )}
            {nodeData.videoId && nodeData.audioDownloadStatus === "completed" && (
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                <span className="text-[10px] text-green-600 dark:text-green-400">{t("inputcfg.audioReady")}</span>
              </div>
            )}
            {nodeData.videoId && nodeData.audioDownloadStatus === "failed" && (
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <AlertCircle className="w-3 h-3 text-orange-500" />
                <span className="text-[10px] text-orange-500" title={nodeData.audioDownloadError}>{t("node.audioFailed")}</span>
              </div>
            )}

            {/* Empty state */}
            {!nodeData.videoId && (
              <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <Video className="w-5 h-5" />
              </div>
            )}
          </div>
        </BaseNode>
        <HandleWithPopover nodeId={id} nodeType="youtube-video" handleId="in"    type="target" position={Position.Left}  label="URL"   color={TEXT_HANDLE_COLOR} icon={<Video />} side="left"  top="calc(100% - 24px)" />
        <HandleWithPopover nodeId={id} nodeType="youtube-video" handleId="video" type="source" position={Position.Right} label="Video" color={HANDLE_COLORS.video} icon={<Film />}  side="right" top="24px" />
      </div>
      <VideoPlayerModal
        isOpen={playerOpen}
        onClose={() => setPlayerOpen(false)}
        videoId={nodeData.videoId || ""}
        platform={platform}
        downloadedVideoUrl={nodeData.downloadedVideoUrl}
      />
    </>
  )
}

export const YouTubeVideoNode = memo(YouTubeVideoNodeComponent)
