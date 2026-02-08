"use client"

import { memo, useState, useCallback, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Link, X, Play, Video, Music2, Camera, Hash } from "lucide-react"
import { createPortal } from "react-dom"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { fetchYouTubeOEmbed } from "@/lib/api"
import type { YouTubeVideoData } from "@/types/nodes"

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

  // Facebook
  const fbMatch = url.match(/facebook\.com\/.*\/videos\/(\d+)/)
  if (fbMatch) return fbMatch[1]
  if (/fb\.watch/.test(url)) return url

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
}: {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly videoId: string
  readonly platform: VideoPlatform
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

  // Only YouTube supports iframe embed
  if (platform !== "youtube") return null

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
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          className="w-full h-full rounded-lg"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="YouTube video player"
        />
      </div>
    </div>,
    document.body
  )
}

function YouTubeVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as YouTubeVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const platform = detectPlatform(nodeData.youtubeUrl || "")

  const handleUrlChange = async (url: string) => {
    updateNodeData(id, { youtubeUrl: url })

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
        // Non-YouTube platforms: no oEmbed, use platform name as title
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
  }

  const handleClear = () => {
    updateNodeData(id, {
      youtubeUrl: "",
      videoId: "",
      title: "",
      thumbnailUrl: "",
    })
  }

  const canEmbed = platform === "youtube"

  return (
    <>
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Video className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        handles={[
          { id: "video", type: "source", position: Position.Right, label: "Video" },
        ]}
      >
        <div className="flex flex-col gap-1.5">
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
              className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-[#ff0073] transition-colors placeholder:text-muted-foreground/30"
            />
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center h-16 rounded-md bg-muted/30">
              <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-[#ff0073] rounded-full animate-spin" />
            </div>
          )}

          {/* Thumbnail preview (all platforms) */}
          {!loading && nodeData.videoId && nodeData.thumbnailUrl && (
            <div className="relative group">
              <div
                className={`w-full aspect-video rounded-md overflow-hidden bg-muted/30 relative ${canEmbed ? "cursor-pointer hover:opacity-90" : ""} transition-opacity`}
                onClick={(e) => {
                  if (!canEmbed) return
                  e.stopPropagation()
                  setPlayerOpen(true)
                }}
              >
                <img
                  src={nodeData.thumbnailUrl}
                  alt={nodeData.title || "Video"}
                  className="w-full h-full object-cover"
                />
                {/* Platform badge (non-YouTube) */}
                {!canEmbed && (
                  <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1">
                    <PlatformIcon platform={platform} className="w-3 h-3" />
                    <span>{PLATFORM_LABELS[platform]}</span>
                  </div>
                )}
                {/* Play button (YouTube only) */}
                {canEmbed && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-red-600/90 flex items-center justify-center shadow-lg">
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

          {/* Video detected but no thumbnail yet */}
          {!loading && nodeData.videoId && !nodeData.thumbnailUrl && (
            <div className="relative group">
              <div className="w-full rounded-md bg-muted/30 p-3 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                  <PlatformIcon platform={platform} className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{nodeData.title || "Video"}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {platform === "youtube" ? "Loading thumbnail..." : "Thumbnail appears after extraction"}
                  </p>
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

          {/* Empty state */}
          {!loading && !nodeData.videoId && (
            <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <Video className="w-5 h-5" />
            </div>
          )}
        </div>
      </BaseNode>
      <VideoPlayerModal
        isOpen={playerOpen}
        onClose={() => setPlayerOpen(false)}
        videoId={nodeData.videoId || ""}
        platform={platform}
      />
    </>
  )
}

export const YouTubeVideoNode = memo(YouTubeVideoNodeComponent)
