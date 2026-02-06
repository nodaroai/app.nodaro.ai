"use client"

import { memo, useState, useCallback, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Youtube, Link, X, Play } from "lucide-react"
import { createPortal } from "react-dom"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { fetchYouTubeOEmbed } from "@/lib/api"
import type { YouTubeVideoData } from "@/types/nodes"

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

function YouTubePlayerModal({
  isOpen,
  onClose,
  videoId,
}: {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly videoId: string
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

  const handleUrlChange = async (url: string) => {
    updateNodeData(id, { youtubeUrl: url })

    const videoId = extractVideoId(url)
    if (!videoId) {
      updateNodeData(id, { videoId: "", title: "", thumbnailUrl: "" })
      return
    }

    updateNodeData(id, { videoId })
    setLoading(true)

    try {
      const meta = await fetchYouTubeOEmbed(url)
      updateNodeData(id, {
        title: meta.title,
        thumbnailUrl: meta.thumbnail_url,
      })
    } catch {
      updateNodeData(id, {
        title: "",
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      })
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

  return (
    <>
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Youtube className="h-4 w-4" />}
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
              placeholder="Paste YouTube URL..."
              className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-[#ff0073] transition-colors placeholder:text-muted-foreground/30"
            />
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center h-16 rounded-md bg-muted/30">
              <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-[#ff0073] rounded-full animate-spin" />
            </div>
          )}

          {/* Thumbnail preview */}
          {!loading && nodeData.videoId && nodeData.thumbnailUrl && (
            <div className="relative group">
              <div
                className="w-full aspect-video rounded-md overflow-hidden bg-muted/30 relative cursor-pointer hover:opacity-90 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  setPlayerOpen(true)
                }}
              >
                <img
                  src={nodeData.thumbnailUrl}
                  alt={nodeData.title || "YouTube video"}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-red-600/90 flex items-center justify-center shadow-lg">
                    <Play className="w-5 h-5 text-white ml-0.5" />
                  </div>
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
              {nodeData.title && (
                <p className="mt-1 text-[10px] text-muted-foreground truncate" title={nodeData.title}>
                  {nodeData.title}
                </p>
              )}
            </div>
          )}

          {/* Empty state */}
          {!loading && !nodeData.videoId && (
            <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <Youtube className="w-5 h-5" />
            </div>
          )}
        </div>
      </BaseNode>
      <YouTubePlayerModal
        isOpen={playerOpen}
        onClose={() => setPlayerOpen(false)}
        videoId={nodeData.videoId || ""}
      />
    </>
  )
}

export const YouTubeVideoNode = memo(YouTubeVideoNodeComponent)
