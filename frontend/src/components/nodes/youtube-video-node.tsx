"use client"

import { memo, useState, useCallback, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Link, X, Play, Video, Film, Music2, Camera, Hash, Download, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { createPortal } from "react-dom"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { fetchYouTubeOEmbed, startVideoDownload, subscribeToDownloadProgress, downloadYouTubeAudio } from "@/lib/api"
import type { DownloadProgressEvent } from "@/lib/api"
import type { YouTubeVideoData } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { videoNodeSizing } from "./video-node-defaults"

type VideoPlatform = "youtube" | "facebook" | "tiktok" | "instagram" | "twitter" | "unknown"

function detectPlatform(url: string): VideoPlatform {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube"
  if (/facebook\.com|fb\.watch|fb\.com/.test(url)) return "facebook"
  if (/tiktok\.com/.test(url)) return "tiktok"
  if (/instagram\.com/.test(url)) return "instagram"
  if (/(?:twitter\.com|x\.com)/.test(url)) return "twitter"
  return "unknown"
}

function extractVideoId(url: string): string | null {
  // YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  )
  if (ytMatch) return ytMatch[1]

  // TikTok
  const tiktokMatch = url.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/)
  if (tiktokMatch) return tiktokMatch[1]

  // Instagram
  const igMatch = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
  if (igMatch) return igMatch[1]

  // Twitter/X
  const twMatch = url.match(/(?:twitter\.com|x\.com)\/[\w]+\/status\/(\d+)/)
  if (twMatch) return twMatch[1]

  // Facebook - multiple URL formats
  const fbMatch = url.match(/facebook\.com\/.*\/videos\/(\d+)/)
  if (fbMatch) return fbMatch[1]
  const fbShareMatch = url.match(/facebook\.com\/share\/(?:v|r)\/([A-Za-z0-9_-]+)/)
  if (fbShareMatch) return fbShareMatch[1]
  const fbReelMatch = url.match(/facebook\.com\/reel\/([A-Za-z0-9_-]+)/)
  if (fbReelMatch) return fbReelMatch[1]
  if (/fb\.watch/.test(url)) return url

  // Fallback for recognized non-YouTube platforms: use URL as ID (yt-dlp resolves internally)
  const platform = detectPlatform(url)
  if (platform !== "unknown" && platform !== "youtube") return url

  return null
}

const PLATFORM_LABELS: Record<VideoPlatform, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "Twitter/X",
  unknown: "Video",
}

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

  // Non-YouTube with downloaded video: show video player
  const showDownloadedPlayer = platform !== "youtube" && downloadedVideoUrl
  // YouTube: show iframe embed
  const showYouTubeEmbed = platform === "youtube"

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
            title="YouTube video player"
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
  const nodeData = data as YouTubeVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const platform = detectPlatform(nodeData.youtubeUrl || "")
  const downloadStatus = nodeData.downloadStatus ?? "idle"
  const isDownloading = downloadStatus === "downloading"

  const handleDownloadVideo = async (url: string) => {
    updateNodeData(id, {
      downloadStatus: "downloading",
      downloadPercent: 0,
      downloadError: "",
      downloadedVideoUrl: "",
      downloadedThumbnailUrl: "",
    })

    try {
      const { downloadId } = await startVideoDownload(url)
      subscribeToDownloadProgress(downloadId, (event: DownloadProgressEvent) => {
        if (event.phase === "completed" && event.videoUrl) {
          updateNodeData(id, {
            downloadedVideoUrl: event.videoUrl,
            downloadedThumbnailUrl: event.thumbnailUrl ?? "",
            downloadStatus: "completed",
            downloadPercent: 100,
            thumbnailUrl: event.thumbnailUrl ?? nodeData.thumbnailUrl,
          })
        } else if (event.phase === "failed") {
          updateNodeData(id, {
            downloadStatus: "failed",
            downloadError: event.error ?? "Download failed",
            downloadPercent: 0,
          })
        } else {
          updateNodeData(id, { downloadPercent: event.percent, downloadPhase: event.phase })
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed"
      updateNodeData(id, {
        downloadStatus: "failed",
        downloadError: message,
        downloadPercent: 0,
      })
    }
  }

  const handleUrlChange = async (url: string) => {
    updateNodeData(id, {
      youtubeUrl: url,
      downloadedVideoUrl: "",
      downloadedThumbnailUrl: "",
      downloadStatus: "idle",
      downloadError: "",
      downloadPercent: 0,
    })

    const videoId = extractVideoId(url)
    if (!videoId) {
      updateNodeData(id, { videoId: "", title: "", thumbnailUrl: "" })
      return
    }

    const detectedPlatform = detectPlatform(url)
    updateNodeData(id, { videoId })
    setLoading(true)

    try {
      if (detectedPlatform === "youtube") {
        const meta = await fetchYouTubeOEmbed(url)
        updateNodeData(id, {
          title: meta.title,
          thumbnailUrl: meta.thumbnail_url,
        })
      } else {
        // Non-YouTube platforms: set title, user clicks Download button
        updateNodeData(id, {
          title: `${PLATFORM_LABELS[detectedPlatform]} Video`,
          thumbnailUrl: "",
        })
      }
    } catch {
      if (detectedPlatform === "youtube") {
        updateNodeData(id, {
          title: "",
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        })
      } else {
        updateNodeData(id, {
          title: `${PLATFORM_LABELS[detectedPlatform]} Video`,
          thumbnailUrl: "",
        })
      }
    } finally {
      setLoading(false)
    }

    // Auto-download audio for Suno Cover compatibility
    if (videoId && url) {
      updateNodeData(id, { audioDownloadStatus: "downloading", downloadedAudioUrl: "", audioDownloadError: "" })
      try {
        const result = await downloadYouTubeAudio(url)
        updateNodeData(id, { downloadedAudioUrl: result.url, audioDownloadStatus: "completed" })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Audio download failed"
        updateNodeData(id, { audioDownloadStatus: "failed", audioDownloadError: msg })
      }
    }
  }

  const handleClear = () => {
    updateNodeData(id, {
      youtubeUrl: "",
      videoId: "",
      title: "",
      thumbnailUrl: "",
      downloadedVideoUrl: "",
      downloadedThumbnailUrl: "",
      downloadStatus: "idle",
      downloadError: "",
      downloadPercent: 0,
      downloadedAudioUrl: "",
      audioDownloadStatus: "idle",
      audioDownloadError: "",
    })
  }

  const canEmbed = platform === "youtube"
  const needsDownload = !canEmbed && nodeData.videoId
  const canPlay = canEmbed || !!nodeData.downloadedVideoUrl
  const useFull = useFullResolution(id)
  const displayThumbnail = nodeData.downloadedThumbnailUrl || nodeData.thumbnailUrl

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
          {...videoNodeSizing(undefined)}
          hideHeader
          handles={HANDLES}
        >
          <div className="p-3 flex flex-col gap-1.5">
            {/* URL input */}
            <div className="flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              <input
                type="text"
                value={nodeData.youtubeUrl || ""}
                onChange={(e) => {
                  e.stopPropagation()
                  handleUrlChange(e.target.value)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="YouTube, Facebook, TikTok, Instagram, or X URL"
                className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-[#38BDF8] transition-colors placeholder:text-muted-foreground/30"
              />
            </div>

            {/* Loading metadata state */}
            {loading && (
              <div className="flex items-center justify-center h-16 rounded-md bg-muted/30">
                <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-[#38BDF8] rounded-full animate-spin" />
              </div>
            )}

            {/* Downloading video state (non-YouTube) with real progress */}
            {!loading && isDownloading && (
              <div className="flex flex-col items-center justify-center gap-1.5 h-20 rounded-md bg-muted/30 px-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-[#38BDF8] animate-spin" />
                  <span className="text-xs text-muted-foreground">
                    {nodeData.downloadPhase === "uploading" ? "Uploading..." : nodeData.downloadPhase === "processing" ? "Processing..." : "Downloading video..."}
                  </span>
                  <span className="text-xs font-mono text-[#38BDF8]">{nodeData.downloadPercent ?? 0}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden">
                  <div
                    className="h-full bg-[#38BDF8] rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${nodeData.downloadPercent ?? 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* Download failed state */}
            {!loading && !isDownloading && downloadStatus === "failed" && nodeData.videoId && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 p-2 rounded-md bg-red-500/5 text-red-500">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <p className="text-[10px] line-clamp-2" title={nodeData.downloadError}>
                    {nodeData.downloadError || "Download failed"}
                  </p>
                </div>
                <button
                  type="button"
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#38BDF8]/90 text-white text-xs font-medium transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownloadVideo(nodeData.youtubeUrl)
                  }}
                >
                  <Download className="w-3.5 h-3.5" />
                  Retry Download
                </button>
              </div>
            )}

            {/* Thumbnail preview with downloaded video (YouTube or downloaded non-YouTube) */}
            {!loading && !isDownloading && nodeData.videoId && displayThumbnail && downloadStatus !== "failed" && (
              <div className="relative group">
                <div
                  className={`w-full aspect-video rounded-md overflow-hidden bg-muted/30 relative ${canPlay ? "cursor-pointer hover:opacity-90" : ""} transition-opacity`}
                  onClick={(e) => {
                    if (!canPlay) return
                    e.stopPropagation()
                    setPlayerOpen(true)
                  }}
                >
                  <CachedImage
                    src={displayThumbnail}
                    alt={nodeData.title || "Video"}
                    className="w-full h-full object-cover"
                    thumbnail={!useFull}
                    thumbnailWidth={320}
                  />
                  {/* Platform badge (non-YouTube) */}
                  {!canEmbed && (
                    <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1">
                      <PlatformIcon platform={platform} className="w-3 h-3" />
                      <span>{PLATFORM_LABELS[platform]}</span>
                    </div>
                  )}
                  {/* Downloaded badge */}
                  {downloadStatus === "completed" && !canEmbed && (
                    <div className="absolute bottom-1.5 left-1.5 bg-green-600/80 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Ready</span>
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
                <button
                  type="button"
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleClear()
                  }}
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
                {nodeData.title && (
                  <p className="mt-1 text-[10px] text-muted-foreground truncate" title={nodeData.title}>
                    {nodeData.title}
                  </p>
                )}
              </div>
            )}

            {/* Non-YouTube: video detected but not downloaded yet - show Download button */}
            {!loading && !isDownloading && needsDownload && !displayThumbnail && downloadStatus !== "failed" && downloadStatus !== "completed" && (
              <div className="relative group">
                <div className="w-full rounded-md bg-muted/30 p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                      <PlatformIcon platform={platform} className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{nodeData.title || "Video"}</p>
                      <p className="text-[10px] text-orange-400 truncate">Not downloaded</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-[#38BDF8] hover:bg-[#38BDF8]/90 text-white text-xs font-medium transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDownloadVideo(nodeData.youtubeUrl)
                    }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Video
                  </button>
                </div>
                <button
                  type="button"
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleClear()
                  }}
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* YouTube: video detected but no thumbnail yet */}
            {!loading && !isDownloading && canEmbed && nodeData.videoId && !displayThumbnail && (
              <div className="relative group">
                <div className="w-full rounded-md bg-muted/30 p-3 flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                    <Video className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{nodeData.title || "Video"}</p>
                    <p className="text-[10px] text-muted-foreground truncate">Loading thumbnail...</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleClear()
                  }}
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Audio download status indicator */}
            {nodeData.videoId && nodeData.audioDownloadStatus === "downloading" && (
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <Loader2 className="w-3 h-3 text-[#38BDF8] animate-spin" />
                <span className="text-[10px] text-muted-foreground">Downloading audio...</span>
              </div>
            )}
            {nodeData.videoId && nodeData.audioDownloadStatus === "completed" && (
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                <span className="text-[10px] text-green-600 dark:text-green-400">Audio ready</span>
              </div>
            )}
            {nodeData.videoId && nodeData.audioDownloadStatus === "failed" && (
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <AlertCircle className="w-3 h-3 text-orange-500" />
                <span className="text-[10px] text-orange-500" title={nodeData.audioDownloadError}>Audio failed</span>
              </div>
            )}

            {/* Empty state */}
            {!loading && !isDownloading && !nodeData.videoId && (
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
